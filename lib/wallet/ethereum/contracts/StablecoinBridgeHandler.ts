import type { ContractTransactionResponse, Provider, Signer } from 'ethers';
import { Contract } from 'ethers';
import type Logger from '../../../Logger';
import TransactionLabelRepository from '../../../db/repositories/TransactionLabelRepository';
import { getGasPrices } from '../EthereumUtils';

const StablecoinBridgeABI = [
  'function mint(uint256 amount) external',
  'function mintTo(address target, uint256 amount) public',
  'function burn(uint256 amount) external',
  'function burnAndSend(address target, uint256 amount) external',
  'function minted() public view returns (uint256)',
  'function limit() public view returns (uint256)',
  'function horizon() public view returns (uint256)',
  'function stopped() public view returns (bool)',
  'function usd() public view returns (address)',
  'function JUSD() public view returns (address)',
];

interface StablecoinBridgeContract {
  mint(amount: bigint, overrides?: object): Promise<ContractTransactionResponse>;
  mintTo(
    target: string,
    amount: bigint,
    overrides?: object,
  ): Promise<ContractTransactionResponse>;
  burn(amount: bigint, overrides?: object): Promise<ContractTransactionResponse>;
  burnAndSend(
    target: string,
    amount: bigint,
    overrides?: object,
  ): Promise<ContractTransactionResponse>;
  minted(): Promise<bigint>;
  limit(): Promise<bigint>;
  horizon(): Promise<bigint>;
  stopped(): Promise<boolean>;
  usd(): Promise<string>;
  JUSD(): Promise<string>;
  getAddress(): Promise<string>;
}

/**
 * Handles interactions with the JuiceDollar StablecoinBridge contract.
 * Converts between JUSD (18 decimals) and USDT.e (6 decimals) at 1:1 rate.
 *
 * The bridge's burn() converts JUSD → USDT.e (for locking USDT.e in swaps).
 * The bridge's mint() converts USDT.e → JUSD (for replenishing JUSD liquidity).
 */
class StablecoinBridgeHandler {
  private bridge!: StablecoinBridgeContract;
  private provider!: Provider;

  constructor(
    private readonly logger: Logger,
    private readonly bridgeAddress: string,
  ) {}

  public init = (provider: Provider, signer: Signer): void => {
    this.provider = provider;
    this.bridge = new Contract(
      this.bridgeAddress,
      StablecoinBridgeABI,
      signer,
    ) as unknown as StablecoinBridgeContract;

    this.logger.info(
      `Initialized StablecoinBridge at ${this.bridgeAddress}`,
    );
  };

  public getAddress = (): Promise<string> => this.bridge.getAddress();

  /**
   * Convert JUSD → USDT.e via StablecoinBridge.burn().
   * The bridge handles decimal conversion internally (18 → 6).
   *
   * @param jusdAmount Amount of JUSD in 18-decimal format
   * @param label Transaction label for tracking
   * @returns The bridge burn transaction
   */
  public burnJusdToUsdte = async (
    jusdAmount: bigint,
    label: string,
  ): Promise<ContractTransactionResponse> => {
    await this.ensureBridgeActive();

    this.logger.verbose(
      `StablecoinBridge: burning ${jusdAmount} JUSD → USDT.e`,
    );

    const tx = await this.bridge.burn(jusdAmount, {
      ...(await getGasPrices(this.provider)),
    });

    await TransactionLabelRepository.addLabel(
      tx.hash,
      'StablecoinBridge',
      label,
    );

    this.logger.info(
      `StablecoinBridge burn tx: ${tx.hash}`,
    );

    return tx;
  };

  /**
   * Convert USDT.e → JUSD via StablecoinBridge.mint().
   * The bridge handles decimal conversion internally (6 → 18).
   *
   * @param usdteAmount Amount of USDT.e in 6-decimal format
   * @param label Transaction label for tracking
   * @returns The bridge mint transaction
   */
  public mintUsdteToJusd = async (
    usdteAmount: bigint,
    label: string,
  ): Promise<ContractTransactionResponse> => {
    await this.ensureBridgeActive();

    this.logger.verbose(
      `StablecoinBridge: minting ${usdteAmount} USDT.e → JUSD`,
    );

    const tx = await this.bridge.mint(usdteAmount, {
      ...(await getGasPrices(this.provider)),
    });

    await TransactionLabelRepository.addLabel(
      tx.hash,
      'StablecoinBridge',
      label,
    );

    this.logger.info(
      `StablecoinBridge mint tx: ${tx.hash}`,
    );

    return tx;
  };

  /**
   * Check remaining capacity of the bridge (limit - minted).
   */
  public getRemainingCapacity = async (): Promise<bigint> => {
    const [minted, limit] = await Promise.all([
      this.bridge.minted(),
      this.bridge.limit(),
    ]);
    return limit - minted;
  };

  /**
   * Check if the bridge is still active (not stopped, not expired).
   */
  private ensureBridgeActive = async (): Promise<void> => {
    const stopped = await this.bridge.stopped();
    if (stopped) {
      throw new Error('StablecoinBridge has been emergency-stopped');
    }

    const horizon = await this.bridge.horizon();
    const block = await this.provider.getBlock('latest');
    if (block && BigInt(block.timestamp) > horizon) {
      throw new Error('StablecoinBridge has expired');
    }
  };
}

export default StablecoinBridgeHandler;
