import type Logger from '../Logger';
import { type SwapType, swapTypeToPrettyString } from '../consts/Enums';
import type {
  BalanceData,
  LightningBalanceEntry,
  WalletBalanceEntry,
} from '../db/models/BalanceSnapshot';
import BalanceSnapshotRepository from '../db/repositories/BalanceSnapshotRepository';
import { splitPairId } from '../Utils';
import type { Currency } from '../wallet/WalletManager';
import type WalletManager from '../wallet/WalletManager';

class BalanceSnapshotService {
  constructor(
    private readonly logger: Logger,
    private readonly walletManager: WalletManager,
    private readonly currencies: Map<string, Currency>,
  ) {
    this.logger.info('Initialized BalanceSnapshotService');
  }

  public captureSnapshot = async (
    swapId: string,
    swapType: SwapType,
    pair: string,
  ): Promise<void> => {
    const swapTypeString = swapTypeToPrettyString(swapType);

    try {
      const { base, quote } = splitPairId(pair);
      const relevantSymbols = [base, quote];

      const wallets: WalletBalanceEntry[] = [];
      const lightning: LightningBalanceEntry[] = [];

      await Promise.all(
        relevantSymbols.map(async (symbol) => {
          const wallet = this.walletManager.wallets.get(symbol);
          if (wallet) {
            const balance = await wallet.getBalance();
            wallets.push({
              symbol,
              service: wallet.serviceName(),
              confirmed: balance.confirmedBalance,
              unconfirmed: balance.unconfirmedBalance,
            });
          }

          const currency = this.currencies.get(symbol);
          if (currency) {
            const lightningClients = [currency.lndClient, currency.clnClient].filter(
              (client) => client !== undefined,
            );

            await Promise.all(
              lightningClients.map(async (client) => {
                const channelsList = await client!.listChannels();

                let localBalance = 0n;
                let remoteBalance = 0n;

                channelsList.forEach((channel) => {
                  localBalance += BigInt(channel.localBalance);
                  remoteBalance += BigInt(channel.remoteBalance);
                });

                lightning.push({
                  symbol,
                  service: client!.serviceName(),
                  local: Number(localBalance),
                  remote: Number(remoteBalance),
                });
              }),
            );
          }
        }),
      );

      const balanceData: BalanceData = {
        wallets,
        lightning,
      };

      await BalanceSnapshotRepository.addSnapshot({
        swapId,
        swapType: swapTypeString,
        timestamp: new Date(),
        balances: balanceData,
      });

      this.logger.verbose(
        `Captured balance snapshot for ${swapTypeString} swap ${swapId} (${pair})`,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to capture balance snapshot for swap ${swapId}: ${error}`,
      );
    }
  };
}

export default BalanceSnapshotService;
