import type { Signer } from 'ethers';
import { Transaction } from 'ethers';
import type Logger from '../../Logger';
import { formatError } from '../../Utils';
import PendingEthereumTransactionRepository from '../../db/repositories/PendingEthereumTransactionRepository';
import type { NetworkDetails } from './EvmNetworks';
import type InjectedProvider from './InjectedProvider';

class EthereumTransactionTracker {
  private static readonly maxRebroadcastAttempts = 5;
  private static readonly gasBumpPercent = 10n;

  private readonly rebroadcastCounts = new Map<string, number>();

  constructor(
    private readonly logger: Logger,
    private readonly networkDetails: NetworkDetails,
    private readonly provider: InjectedProvider,
    private readonly wallet: Signer,
  ) {}

  public init = async (): Promise<void> => {
    this.logger.info(
      `Starting ${
        this.networkDetails.name
      } transaction tracker for address: ${await this.wallet.getAddress()}`,
    );

    await this.scanPendingTransactions();
  };

  /**
   * Scans a block and removes pending transactions from the database in case they were confirmed.
   * Re-broadcasts transactions that are not found by the provider, and after exhausting retries,
   * sends a cancel (replacement) transaction to unblock the nonce.
   * This method is public and gets called from "EthereumManager" because there is a block subscription
   * in that class already.
   */
  public scanPendingTransactions = async (): Promise<void> => {
    for (const transaction of await PendingEthereumTransactionRepository.getTransactions(
      this.networkDetails.name,
    )) {
      const receipt = await this.provider.getTransactionReceipt(
        transaction.hash,
      );

      if (receipt && (await receipt.confirmations()) > 0) {
        this.logger.silly(
          `Removing confirmed ${this.networkDetails.name} transaction: ${transaction.hash}`,
        );
        this.rebroadcastCounts.delete(transaction.hash);
        await transaction.destroy();
        continue;
      }

      const inMempool = await this.provider.getTransaction(transaction.hash);
      if (inMempool !== null) {
        if (this.rebroadcastCounts.has(transaction.hash)) {
          this.logger.info(
            `${this.networkDetails.name} transaction ${transaction.hash} (nonce ${transaction.nonce}) found in mempool after ${this.rebroadcastCounts.get(transaction.hash)} re-broadcast attempt(s)`,
          );
          this.rebroadcastCounts.delete(transaction.hash);
        }
        continue;
      }

      const attempts =
        (this.rebroadcastCounts.get(transaction.hash) ?? 0) + 1;
      this.rebroadcastCounts.set(transaction.hash, attempts);

      if (attempts > EthereumTransactionTracker.maxRebroadcastAttempts) {
        this.logger.warn(
          `${this.networkDetails.name} transaction ${transaction.hash} (nonce ${transaction.nonce}) not found after ${attempts - 1} re-broadcast attempts, sending cancel transaction`,
        );

        try {
          await this.sendCancelTransaction(
            transaction.nonce,
            transaction.hex,
          );
          this.rebroadcastCounts.delete(transaction.hash);
          await transaction.destroy();
        } catch (error) {
          this.logger.error(
            `Failed to send cancel transaction for ${this.networkDetails.name} nonce ${transaction.nonce}: ${formatError(error)}`,
          );
        }

        continue;
      }

      this.logger.warn(
        `${this.networkDetails.name} pending transaction ${transaction.hash} (nonce ${transaction.nonce}) not found by provider, re-broadcasting (attempt ${attempts}/${EthereumTransactionTracker.maxRebroadcastAttempts})`,
      );

      try {
        const succeeded = await this.provider.rebroadcastRawTransaction(
          transaction.hex,
        );

        if (succeeded) {
          this.logger.info(
            `Re-broadcast ${this.networkDetails.name} transaction ${transaction.hash} (nonce ${transaction.nonce})`,
          );
        } else {
          this.logger.warn(
            `Could not re-broadcast ${this.networkDetails.name} transaction ${transaction.hash} (nonce ${transaction.nonce})`,
          );
        }
      } catch (error) {
        this.logger.warn(
          `Error re-broadcasting ${this.networkDetails.name} transaction ${transaction.hash}: ${formatError(error)}`,
        );
      }
    }
  };

  private sendCancelTransaction = async (
    nonce: number,
    originalHex: string,
  ): Promise<void> => {
    const address = await this.wallet.getAddress();
    const [feeData, originalTx] = await Promise.all([
      this.provider.getFeeData(),
      Promise.resolve(Transaction.from(originalHex)),
    ]);

    const bumpMultiplier =
      100n + EthereumTransactionTracker.gasBumpPercent;

    const originalMaxFee =
      originalTx.maxFeePerGas ?? originalTx.gasPrice ?? 0n;
    const originalPriorityFee = originalTx.maxPriorityFeePerGas ?? 0n;

    const maxFeePerGas =
      (originalMaxFee * bumpMultiplier) / 100n > (feeData.maxFeePerGas ?? 0n)
        ? (originalMaxFee * bumpMultiplier) / 100n
        : feeData.maxFeePerGas;

    const maxPriorityFeePerGas =
      (originalPriorityFee * bumpMultiplier) / 100n >
      (feeData.maxPriorityFeePerGas ?? 0n)
        ? (originalPriorityFee * bumpMultiplier) / 100n
        : feeData.maxPriorityFeePerGas;

    this.logger.info(
      `Sending ${this.networkDetails.name} cancel transaction for nonce ${nonce} (maxFeePerGas: ${maxFeePerGas}, maxPriorityFeePerGas: ${maxPriorityFeePerGas})`,
    );

    await this.wallet.sendTransaction({
      to: address,
      value: 0,
      nonce,
      maxFeePerGas,
      maxPriorityFeePerGas,
    });
  };
}

export default EthereumTransactionTracker;
