import Logger from '../../../lib/Logger';
import { OrderSide, SwapType, SwapVersion } from '../../../lib/consts/Enums';
import ChainSwapRepository from '../../../lib/db/repositories/ChainSwapRepository';
import ExtraFeeRepository from '../../../lib/db/repositories/ExtraFeeRepository';
import ReferralRepository from '../../../lib/db/repositories/ReferralRepository';
import type RateProvider from '../../../lib/rates/RateProvider';
import type BalanceCheck from '../../../lib/service/BalanceCheck';
import TimeoutDeltaProvider from '../../../lib/service/TimeoutDeltaProvider';
import ChainSwapAutoAdjuster from '../../../lib/swap/ChainSwapAutoAdjuster';

jest.mock('../../../lib/db/repositories/ChainSwapRepository');
jest.mock('../../../lib/db/repositories/ExtraFeeRepository');
jest.mock('../../../lib/db/repositories/ReferralRepository');

describe('ChainSwapAutoAdjuster', () => {
  const ChainSwapRepoMock = ChainSwapRepository as jest.Mocked<
    typeof ChainSwapRepository
  >;
  const ExtraFeeRepoMock = ExtraFeeRepository as jest.Mocked<
    typeof ExtraFeeRepository
  >;
  const ReferralRepoMock = ReferralRepository as jest.Mocked<
    typeof ReferralRepository
  >;

  const buildSwap = (overrides: any = {}) => ({
    id: 'swap-1',
    pair: 'BTC/cBTC',
    type: SwapType.Chain,
    orderSide: OrderSide.BUY,
    createdRefundSignature: false,
    chainSwap: { referral: null, ...overrides.chainSwap },
    receivingData: {
      symbol: 'BTC',
      timeoutBlockHeight: 1000,
      ...overrides.receivingData,
    },
    sendingData: {
      symbol: 'cBTC',
      ...overrides.sendingData,
    },
    ...overrides,
  });

  const buildPair = (limits = { minimal: 1_000, maximal: 10_000_000 }) => ({
    rate: 1,
    limits,
  });

  const buildAdjuster = (opts?: {
    enabled?: boolean;
    blockHeight?: number;
    pair?: ReturnType<typeof buildPair>;
    noPair?: boolean;
    balanceFails?: boolean;
    feePercent?: number;
    baseFee?: number;
  }) => {
    const enabled = opts?.enabled ?? true;
    const pair = opts?.noPair ? undefined : (opts?.pair ?? buildPair());

    const chainClient = {
      getBlockchainInfo: jest
        .fn()
        .mockResolvedValue({ blocks: opts?.blockHeight ?? 0 }),
    };
    const currencies = new Map<string, any>([
      ['BTC', { symbol: 'BTC', chainClient }],
      ['cBTC', { symbol: 'cBTC' }],
    ]);

    const rateProvider = {
      providers: {
        [SwapVersion.Taproot]: {
          getChainPairs: jest
            .fn()
            .mockReturnValue(new Map([['BTC', new Map([['cBTC', pair]])]])),
        },
      },
      feeProvider: {
        getSwapBaseFees: jest
          .fn()
          .mockReturnValue({ server: opts?.baseFee ?? 0 }),
        getPercentageFee: jest.fn().mockReturnValue(opts?.feePercent ?? 0),
      },
    } as unknown as RateProvider;

    const balanceCheck = {
      checkBalance: opts?.balanceFails
        ? jest.fn().mockRejectedValue(new Error('insufficient'))
        : jest.fn().mockResolvedValue(undefined),
    } as unknown as BalanceCheck;

    return new ChainSwapAutoAdjuster(
      Logger.disabledLogger,
      currencies,
      rateProvider,
      balanceCheck,
      enabled,
    );
  };

  beforeAll(() => {
    TimeoutDeltaProvider.blockTimes = new Map([
      ['BTC', 10],
      ['cBTC', 0.034],
    ]);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    ReferralRepoMock.getReferralById = jest.fn().mockResolvedValue(null);
    ExtraFeeRepoMock.get = jest.fn().mockResolvedValue(null);
    ExtraFeeRepoMock.setFee = jest.fn().mockResolvedValue(undefined);
    ChainSwapRepoMock.setExpectedAmounts = jest
      .fn()
      .mockImplementation(async (swap: any) => swap);
  });

  test('returns disabled when feature flag is off', async () => {
    const adjuster = buildAdjuster({ enabled: false });
    const result = await adjuster.attemptAdjust(buildSwap() as any, 20_001);
    expect(result).toEqual({
      adjusted: false,
      reason: 'auto-renegotiate disabled',
    });
  });

  test('rejects when refund signature was already created', async () => {
    const adjuster = buildAdjuster();
    const swap = buildSwap({ createdRefundSignature: true });
    const result = await adjuster.attemptAdjust(swap as any, 20_001);
    expect(result.adjusted).toBe(false);
    expect((result as any).reason).toMatch(/refund signature/);
  });

  test('rejects when receiving currency is unknown', async () => {
    const adjuster = buildAdjuster();
    const swap = buildSwap({ receivingData: { symbol: 'UNKNOWN' } });
    const result = await adjuster.attemptAdjust(swap as any, 20_001);
    expect(result.adjusted).toBe(false);
    expect((result as any).reason).toMatch(/currency not found/);
  });

  test('rejects when time until expiry is below 60 minutes', async () => {
    // BTC blockTime=10min, 5 blocks left -> 50 minutes
    const adjuster = buildAdjuster({ blockHeight: 995 });
    const result = await adjuster.attemptAdjust(buildSwap() as any, 20_001);
    expect(result.adjusted).toBe(false);
    expect((result as any).reason).toMatch(/time until expiry/);
  });

  test('rejects when pair is not found', async () => {
    const adjuster = buildAdjuster({ noPair: true });
    const result = await adjuster.attemptAdjust(buildSwap() as any, 20_001);
    expect(result.adjusted).toBe(false);
    expect((result as any).reason).toMatch(/pair not found/);
  });

  test('rejects when amount exceeds maximum', async () => {
    const adjuster = buildAdjuster({
      pair: buildPair({ minimal: 1_000, maximal: 10_000 }),
    });
    const result = await adjuster.attemptAdjust(buildSwap() as any, 20_001);
    expect(result.adjusted).toBe(false);
    expect((result as any).reason).toMatch(/exceeds maximum/);
  });

  test('rejects when amount below minimum', async () => {
    const adjuster = buildAdjuster({
      pair: buildPair({ minimal: 25_000, maximal: 10_000_000 }),
    });
    const result = await adjuster.attemptAdjust(buildSwap() as any, 20_001);
    expect(result.adjusted).toBe(false);
    expect((result as any).reason).toMatch(/below minimum/);
  });

  test('rejects when liquidity check fails', async () => {
    const adjuster = buildAdjuster({ balanceFails: true });
    const result = await adjuster.attemptAdjust(buildSwap() as any, 20_001);
    expect(result.adjusted).toBe(false);
    expect((result as any).reason).toMatch(/insufficient liquidity/);
  });

  test('happy path: adjusts overpay with rate=1 and zero fees', async () => {
    const adjuster = buildAdjuster();
    const swap = buildSwap();
    const result = await adjuster.attemptAdjust(swap as any, 20_001);
    expect(result).toEqual({ adjusted: true });
    expect(ChainSwapRepoMock.setExpectedAmounts).toHaveBeenCalledTimes(1);
    expect(ChainSwapRepoMock.setExpectedAmounts).toHaveBeenCalledWith(
      swap,
      0,
      20_001,
      20_001,
    );
  });

  test('happy path: adjusts underpay', async () => {
    const adjuster = buildAdjuster();
    const swap = buildSwap();
    const result = await adjuster.attemptAdjust(swap as any, 19_500);
    expect(result).toEqual({ adjusted: true });
    expect(ChainSwapRepoMock.setExpectedAmounts).toHaveBeenCalledWith(
      swap,
      0,
      19_500,
      19_500,
    );
  });

  test('happy path: server lock amount accounts for fees', async () => {
    const adjuster = buildAdjuster({ feePercent: 0.01, baseFee: 100 });
    const swap = buildSwap();
    const result = await adjuster.attemptAdjust(swap as any, 20_001);
    expect(result).toEqual({ adjusted: true });
    // serverLockAmount = floor(20001 - (ceil(0.01 * 20001) + 100))
    //                  = floor(20001 - (201 + 100)) = 19700
    expect(ChainSwapRepoMock.setExpectedAmounts).toHaveBeenCalledWith(
      swap,
      201,
      20_001,
      19_700,
    );
  });

  test('rejects when computed server lock amount is non-positive', async () => {
    const adjuster = buildAdjuster({ baseFee: 50_000 });
    const result = await adjuster.attemptAdjust(buildSwap() as any, 20_001);
    expect(result.adjusted).toBe(false);
    expect((result as any).reason).toMatch(/non-positive/);
  });
});
