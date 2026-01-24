import type Logger from '../Logger';
import { type SwapType, swapTypeToPrettyString } from '../consts/Enums';
import type {
  BalanceData,
  LightningBalanceEntry,
  WalletBalanceEntry,
} from '../db/models/BalanceSnapshot';
import BalanceSnapshotRepository from '../db/repositories/BalanceSnapshotRepository';
import type Service from './Service';

class BalanceSnapshotService {
  constructor(
    private readonly logger: Logger,
    private readonly service: Service,
  ) {
    this.logger.info('Initialized BalanceSnapshotService');
  }

  public captureSnapshot = async (
    swapId: string,
    swapType: SwapType,
  ): Promise<void> => {
    const swapTypeString = swapTypeToPrettyString(swapType);
    try {
      const balanceResponse = await this.service.getBalance();
      const balanceMap = balanceResponse.getBalancesMap();

      const wallets: WalletBalanceEntry[] = [];
      const lightning: LightningBalanceEntry[] = [];

      balanceMap.forEach((balances, symbol) => {
        // Extract wallet balances
        balances.getWalletsMap().forEach((walletBalance, serviceName) => {
          wallets.push({
            symbol,
            service: serviceName,
            confirmed: walletBalance.getConfirmed(),
            unconfirmed: walletBalance.getUnconfirmed(),
          });
        });

        // Extract lightning balances
        balances.getLightningMap().forEach((lightningBalance, serviceName) => {
          lightning.push({
            symbol,
            service: serviceName,
            local: lightningBalance.getLocal(),
            remote: lightningBalance.getRemote(),
          });
        });
      });

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
        `Captured balance snapshot for ${swapTypeString} swap ${swapId}`,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to capture balance snapshot for swap ${swapId}: ${error}`,
      );
    }
  };
}

export default BalanceSnapshotService;
