import type Logger from '../../Logger';
import { formatError } from '../../Utils';
import PendingEthereumTransactionRepository from '../../db/repositories/PendingEthereumTransactionRepository';
import type { NetworkDetails } from './EvmNetworks';
import type InjectedProvider from './InjectedProvider';

class EthereumTransactionTracker {
  constructor(
    private readonly logger: Logger,
    private readonly networkDetails: NetworkDetails,
    private readonly provider: InjectedProvider,
  ) {}

  public init = async (): Promise<void> => {
    this.logger.info(
      `Starting ${this.networkDetails.name} transaction tracker`,
    );
    await this.scanPendingTransactions();
  };

  /**
   * Scans pending transactions each block:
   *   - confirmed → remove from DB
   *   - not in mempool → rebroadcast raw hex
   *
   * No cancel logic: the SequentialSigner guarantees mempool visibility
   * before releasing the nonce, so stuck nonces should not occur.
   * Rebroadcasting handles the rare case of post-acceptance drops.
   */
  public scanPendingTransactions = async (): Promise<void> => {
    for (const transaction of await PendingEthereumTransactionRepository.getTransactions(
      this.networkDetails.name,
    )) {
      try {
        const receipt = await this.provider.getTransactionReceipt(
          transaction.hash,
        );

        if (receipt && (await receipt.confirmations()) > 0) {
          this.logger.silly(
            `Removing confirmed ${this.networkDetails.name} transaction: ${transaction.hash}`,
          );
          await transaction.destroy();
          continue;
        }

        const inMempool = await this.provider.getTransaction(
          transaction.hash,
        );
        if (inMempool !== null) {
          continue;
        }

        this.logger.warn(
          `${this.networkDetails.name} pending transaction ${transaction.hash} (nonce ${transaction.nonce}) not found by provider, re-broadcasting`,
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
      } catch (error) {
        this.logger.error(
          `Error scanning ${this.networkDetails.name} pending transaction ${transaction.hash}: ${formatError(error)}`,
        );
      }
    }
  };
}

export default EthereumTransactionTracker;
