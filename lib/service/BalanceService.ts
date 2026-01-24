import type {
  BaseCurrencyConfig,
  PreferredWallet,
  TokenConfig,
} from '../Config';
import { satoshisToSatcomma } from '../DenominationConverter';
import type Logger from '../Logger';
import { splitPairId } from '../Utils';
import { SwapType, swapTypeToPrettyString } from '../consts/Enums';
import { liquidSymbol } from '../consts/LiquidTypes';
import type {
  BalanceData,
  LightningBalanceEntry,
  WalletBalanceEntry,
} from '../db/models/BalanceSnapshot';
import { SnapshotType } from '../db/models/BalanceSnapshot';
import BalanceSnapshotRepository from '../db/repositories/BalanceSnapshotRepository';
import type LndClient from '../lightning/LndClient';
import type ClnClient from '../lightning/cln/ClnClient';
import { Emojis } from '../notifications/Markup';
import type NotificationClient from '../notifications/NotificationClient';
import type { Currency } from '../wallet/WalletManager';
import type WalletManager from '../wallet/WalletManager';

enum BalanceType {
  Wallet,
  ChannelLocal,
  ChannelRemote,
}

type CurrencyThresholds = {
  symbol: string;
  preferredWallet?: PreferredWallet;
  minWalletBalance: number;
  maxWalletBalance?: number;
  maxUnusedWalletBalance?: number;
  minLocalBalance?: number;
  minRemoteBalance?: number;
};

class BalanceService {
  private currencies: Map<string, Currency>;
  private thresholds: CurrencyThresholds[] = [];

  // Track which symbols have out-of-bounds alerts active
  private walletBalanceAlerts = new Set<string>();
  private localBalanceAlerts = new Set<string>();
  private remoteBalanceAlerts = new Set<string>();

  constructor(
    private readonly logger: Logger,
    private readonly walletManager: WalletManager,
    currencies: Map<string, Currency>,
    currencyConfigs: (BaseCurrencyConfig | undefined)[],
    tokenConfigs: TokenConfig[],
    private readonly notificationClient?: NotificationClient,
  ) {
    this.currencies = currencies;

    // Build thresholds from configs
    currencyConfigs
      .filter((config): config is BaseCurrencyConfig => config !== undefined)
      .filter((config) => config.minWalletBalance !== undefined)
      .forEach((config) =>
        this.thresholds.push({
          ...config,
          symbol: config.symbol || liquidSymbol,
        }),
      );
    tokenConfigs.forEach((config) => this.thresholds.push(config));

    this.logger.info('Initialized BalanceService');
  }

  /**
   * Fetch balances for specific currencies or all if not specified
   */
  public getBalances = async (
    symbols?: string[],
    includeLightning: boolean = true,
  ): Promise<BalanceData> => {
    const wallets: WalletBalanceEntry[] = [];
    const lightning: LightningBalanceEntry[] = [];

    const symbolsToQuery =
      symbols ?? Array.from(this.walletManager.wallets.keys());

    await Promise.all(
      symbolsToQuery.map(async (symbol) => {
        // Get wallet balance
        const wallet = this.walletManager.wallets.get(symbol);
        if (wallet) {
          try {
            const balance = await wallet.getBalance();
            wallets.push({
              symbol,
              service: wallet.serviceName(),
              confirmed: balance.confirmedBalance,
              unconfirmed: balance.unconfirmedBalance,
            });
          } catch (error) {
            this.logger.warn(
              `Failed to get wallet balance for ${symbol}: ${error}`,
            );
          }
        }

        // Get Lightning balances if requested
        if (includeLightning) {
          const currency = this.currencies.get(symbol);
          if (currency) {
            const lightningClients = [
              currency.lndClient,
              currency.clnClient,
            ].filter(
              (client): client is LndClient | ClnClient => client !== undefined,
            );

            await Promise.all(
              lightningClients.map(async (client) => {
                try {
                  const channelsList = await client.listChannels();

                  let localBalance = 0n;
                  let remoteBalance = 0n;

                  channelsList.forEach((channel) => {
                    localBalance += BigInt(channel.localBalance);
                    remoteBalance += BigInt(channel.remoteBalance);
                  });

                  lightning.push({
                    symbol,
                    service: client.serviceName(),
                    local: Number(localBalance),
                    remote: Number(remoteBalance),
                  });
                } catch (error) {
                  this.logger.warn(
                    `Failed to get Lightning balance for ${symbol} ${client.serviceName()}: ${error}`,
                  );
                }
              }),
            );
          }
        }
      }),
    );

    return { wallets, lightning };
  };

  /**
   * Capture a periodic snapshot of all balances and check thresholds
   */
  public capturePeriodicSnapshot = async (): Promise<void> => {
    try {
      const balances = await this.getBalances();

      await BalanceSnapshotRepository.addSnapshot({
        snapshotType: SnapshotType.Periodic,
        timestamp: new Date(),
        balances,
      });

      this.logger.verbose('Captured periodic balance snapshot');

      // Check thresholds and send alerts
      await this.checkThresholds(balances);
    } catch (error) {
      this.logger.warn(`Failed to capture periodic snapshot: ${error}`);
    }
  };

  /**
   * Capture a snapshot for a specific swap (only relevant currencies)
   */
  public captureSwapSnapshot = async (
    swapId: string,
    swapType: SwapType,
    pair: string,
  ): Promise<void> => {
    try {
      const { base, quote } = splitPairId(pair);
      const relevantSymbols = [base, quote];

      // Only include Lightning for Submarine/Reverse swaps
      const includeLightning =
        swapType === SwapType.Submarine ||
        swapType === SwapType.ReverseSubmarine;

      const balances = await this.getBalances(
        relevantSymbols,
        includeLightning,
      );
      const swapTypeString = swapTypeToPrettyString(swapType);

      await BalanceSnapshotRepository.addSnapshot({
        snapshotType: SnapshotType.Swap,
        swapId,
        swapType: swapTypeString,
        timestamp: new Date(),
        balances,
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

  /**
   * Check balance thresholds and send alerts
   */
  private checkThresholds = async (balances: BalanceData): Promise<void> => {
    if (!this.notificationClient) {
      return;
    }

    for (const threshold of this.thresholds) {
      // Check wallet balances
      const walletEntries = balances.wallets.filter(
        (w) => w.symbol === threshold.symbol,
      );

      for (const wallet of walletEntries) {
        const totalBalance = wallet.confirmed + wallet.unconfirmed;
        const isOnlyWallet = walletEntries.length === 1;

        await this.checkBalance(
          threshold,
          wallet.service,
          BalanceType.Wallet,
          totalBalance,
          isOnlyWallet,
        );
      }

      // Check Lightning balances
      const lightningEntries = balances.lightning.filter(
        (l) => l.symbol === threshold.symbol,
      );

      for (const ln of lightningEntries) {
        if (threshold.minLocalBalance !== undefined) {
          await this.checkBalance(
            threshold,
            ln.service,
            BalanceType.ChannelLocal,
            ln.local,
          );
        }

        if (threshold.minRemoteBalance !== undefined) {
          await this.checkBalance(
            threshold,
            ln.service,
            BalanceType.ChannelRemote,
            ln.remote,
          );
        }
      }
    }
  };

  private checkBalance = async (
    currency: CurrencyThresholds,
    service: string,
    type: BalanceType,
    balance: number,
    isOnlyWallet?: boolean,
  ): Promise<void> => {
    let isInBounds: boolean;
    let isMainWallet = false;
    let notificationSet: Set<string>;

    if (type === BalanceType.Wallet) {
      notificationSet = this.walletBalanceAlerts;

      const {
        preferredWallet,
        minWalletBalance,
        maxWalletBalance,
        maxUnusedWalletBalance,
      } = currency;

      if (
        isOnlyWallet ||
        (preferredWallet || 'lnd') === service.toLowerCase()
      ) {
        isMainWallet = true;
        isInBounds =
          minWalletBalance <= balance &&
          balance <= (maxWalletBalance || Number.MAX_SAFE_INTEGER);
      } else if (maxUnusedWalletBalance !== undefined) {
        isInBounds = balance <= maxUnusedWalletBalance;
      } else {
        return;
      }
    } else {
      notificationSet =
        type === BalanceType.ChannelLocal
          ? this.localBalanceAlerts
          : this.remoteBalanceAlerts;

      const minThreshold =
        type === BalanceType.ChannelLocal
          ? currency.minLocalBalance
          : currency.minRemoteBalance;

      isInBounds = minThreshold! <= balance;
    }

    const ident = `${currency.symbol}${service}`;

    if (!notificationSet.has(ident) && !isInBounds) {
      notificationSet.add(ident);
      await this.sendAlert(
        currency,
        type,
        service,
        isInBounds,
        isMainWallet,
        balance,
      );
    } else if (notificationSet.has(ident) && isInBounds) {
      notificationSet.delete(ident);
      await this.sendAlert(
        currency,
        type,
        service,
        isInBounds,
        isMainWallet,
        balance,
      );
    }
  };

  private sendAlert = async (
    currency: CurrencyThresholds,
    type: BalanceType,
    service: string,
    isInBounds: boolean,
    isMainWallet: boolean,
    balance: number,
  ): Promise<void> => {
    if (!this.notificationClient) {
      return;
    }

    const name = `${currency.symbol} ${service}`;
    let message: string;

    if (isInBounds) {
      if (type === BalanceType.Wallet) {
        message = `${
          Emojis.Checkmark
        } ${name} wallet balance of ${satoshisToSatcomma(
          balance,
        )} is in bounds again ${Emojis.Checkmark}`;
      } else {
        message =
          `${Emojis.Checkmark} ${name} ${
            type === BalanceType.ChannelLocal ? 'local' : 'remote'
          } channel balance ` +
          `of ${satoshisToSatcomma(balance)} is more than expected ` +
          `${satoshisToSatcomma(
            type === BalanceType.ChannelLocal
              ? currency.minLocalBalance!
              : currency.minRemoteBalance!,
          )} again ${Emojis.Checkmark}`;
      }
    } else {
      if (type === BalanceType.Wallet) {
        const limits = isMainWallet
          ? `${
              currency.maxWalletBalance
                ? `    Max: ${satoshisToSatcomma(currency.maxWalletBalance)}\n`
                : ''
            }` + `    Min: ${satoshisToSatcomma(currency.minWalletBalance)}`
          : `    Max: ${satoshisToSatcomma(currency.maxUnusedWalletBalance!)}`;
        message =
          `${Emojis.RotatingLight} **${name} wallet balance is out of bounds** ${Emojis.RotatingLight}\n` +
          `  Balance: ${satoshisToSatcomma(balance)}\n` +
          limits;
      } else {
        message =
          `${Emojis.RotatingLight} **${name} ${
            type === BalanceType.ChannelLocal ? 'local' : 'remote'
          } channel balance ` +
          `of ${satoshisToSatcomma(balance)} is less than expected ` +
          `${satoshisToSatcomma(
            type === BalanceType.ChannelLocal
              ? currency.minLocalBalance!
              : currency.minRemoteBalance!,
          )}** ${Emojis.RotatingLight}`;
      }
    }

    this.logger.warn(`Balance warning: ${message}`);
    await this.notificationClient.sendMessage(message, true, !isInBounds);
  };
}

export default BalanceService;
export { BalanceType };
