import type Logger from '../Logger';
import { PercentageFeeType, SwapType, SwapVersion } from '../consts/Enums';
import type { ChainSwapInfo } from '../db/repositories/ChainSwapRepository';
import ChainSwapRepository from '../db/repositories/ChainSwapRepository';
import ExtraFeeRepository from '../db/repositories/ExtraFeeRepository';
import ReferralRepository from '../db/repositories/ReferralRepository';
import type { ChainSwapMinerFees } from '../rates/FeeProvider';
import FeeProvider from '../rates/FeeProvider';
import type RateProvider from '../rates/RateProvider';
import type BalanceCheck from '../service/BalanceCheck';
import TimeoutDeltaProvider from '../service/TimeoutDeltaProvider';
import type { Currency } from '../wallet/WalletManager';

export type AutoAdjustResult =
  | { adjusted: true }
  | { adjusted: false; reason: string };

class ChainSwapAutoAdjuster {
  private static readonly minimumLeftUntilExpiryMinutes = 60;

  constructor(
    private readonly logger: Logger,
    private readonly currencies: Map<string, Currency>,
    private readonly rateProvider: RateProvider,
    private readonly balanceCheck: BalanceCheck,
    private readonly enabled: boolean,
  ) {}

  public isEnabled = (): boolean => this.enabled;

  public attemptAdjust = async (
    swap: ChainSwapInfo,
    actualUserLockAmount: number,
  ): Promise<AutoAdjustResult> => {
    if (!this.enabled) {
      return { adjusted: false, reason: 'auto-renegotiate disabled' };
    }

    if (swap.createdRefundSignature) {
      return { adjusted: false, reason: 'refund signature already created' };
    }

    const receivingCurrency = this.currencies.get(swap.receivingData.symbol);
    if (receivingCurrency === undefined) {
      return {
        adjusted: false,
        reason: `currency not found: ${swap.receivingData.symbol}`,
      };
    }

    const minutesLeft = await this.minutesUntilExpiry(swap, receivingCurrency);
    if (minutesLeft <= ChainSwapAutoAdjuster.minimumLeftUntilExpiryMinutes) {
      return {
        adjusted: false,
        reason: `time until expiry too short: ${minutesLeft}min`,
      };
    }

    const referral =
      swap.chainSwap.referral === null || swap.chainSwap.referral === undefined
        ? null
        : await ReferralRepository.getReferralById(swap.chainSwap.referral);

    const pair = this.rateProvider.providers[SwapVersion.Taproot]
      .getChainPairs(referral)
      .get(swap.receivingData.symbol)
      ?.get(swap.sendingData.symbol);
    if (pair === undefined) {
      return { adjusted: false, reason: `pair not found: ${swap.pair}` };
    }

    if (actualUserLockAmount > pair.limits.maximal) {
      return {
        adjusted: false,
        reason: `amount ${actualUserLockAmount} exceeds maximum ${pair.limits.maximal}`,
      };
    }
    if (actualUserLockAmount < pair.limits.minimal) {
      return {
        adjusted: false,
        reason: `amount ${actualUserLockAmount} below minimum ${pair.limits.minimal}`,
      };
    }

    const baseFee =
      this.rateProvider.feeProvider.getSwapBaseFees<ChainSwapMinerFees>(
        swap.pair,
        swap.orderSide,
        SwapType.Chain,
        SwapVersion.Taproot,
      ).server;
    const feePercent = this.rateProvider.feeProvider.getPercentageFee(
      swap.pair,
      swap.orderSide,
      SwapType.Chain,
      PercentageFeeType.Calculation,
      referral,
    );

    const quote = this.calculateServerLockAmount(
      pair.rate,
      actualUserLockAmount,
      feePercent,
      baseFee,
    );

    let extraFee: number | undefined = undefined;
    const extraFees = await ExtraFeeRepository.get(swap.id);
    if (extraFees !== undefined && extraFees !== null) {
      const withExtra = this.calculateServerLockAmount(
        pair.rate,
        actualUserLockAmount,
        FeeProvider.calculateTotalPercentageFeeCalculation(
          feePercent,
          extraFees.percentage,
        ),
        baseFee,
      );
      extraFee = Math.round(
        quote.serverLockAmount - withExtra.serverLockAmount,
      );
      quote.serverLockAmount = withExtra.serverLockAmount;
    }

    if (quote.serverLockAmount <= 0) {
      return {
        adjusted: false,
        reason: `server lock amount non-positive: ${quote.serverLockAmount}`,
      };
    }

    try {
      await this.balanceCheck.checkBalance(
        swap.sendingData.symbol,
        quote.serverLockAmount,
      );
    } catch {
      return {
        adjusted: false,
        reason: `insufficient liquidity for ${quote.serverLockAmount} ${swap.sendingData.symbol}`,
      };
    }

    if (extraFee !== undefined) {
      await ExtraFeeRepository.setFee(swap.id, extraFee);
    }

    await ChainSwapRepository.setExpectedAmounts(
      swap,
      quote.percentageFee,
      actualUserLockAmount,
      quote.serverLockAmount,
    );

    this.logger.info(
      `Auto-adjusted Chain Swap ${swap.id}: user lock ${actualUserLockAmount} ${swap.receivingData.symbol}, server lock ${quote.serverLockAmount} ${swap.sendingData.symbol}`,
    );

    return { adjusted: true };
  };

  private calculateServerLockAmount = (
    rate: number,
    userLockAmount: number,
    feePercent: number,
    baseFee: number,
  ) => {
    const serverLockAmount = userLockAmount * rate;
    const percentageFee = Math.ceil(feePercent * serverLockAmount);
    return {
      percentageFee,
      serverLockAmount: Math.floor(
        serverLockAmount - (percentageFee + baseFee),
      ),
    };
  };

  private minutesUntilExpiry = async (
    swap: ChainSwapInfo,
    receivingCurrency: Currency,
  ): Promise<number> => {
    const blockHeight = await this.getBlockHeight(receivingCurrency);
    const blocksLeft = swap.receivingData.timeoutBlockHeight - blockHeight;
    return Math.floor(
      blocksLeft *
        (TimeoutDeltaProvider.blockTimes.get(receivingCurrency.symbol) || 0),
    );
  };

  private getBlockHeight = async (currency: Currency): Promise<number> => {
    if (currency.chainClient !== undefined) {
      return (await currency.chainClient.getBlockchainInfo()).blocks;
    }
    if (currency.provider !== undefined) {
      return await currency.provider.getBlockNumber();
    }
    throw new Error(`cannot get block height for ${currency.symbol}`);
  };
}

export default ChainSwapAutoAdjuster;
