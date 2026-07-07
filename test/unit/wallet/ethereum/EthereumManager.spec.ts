import { MaxUint256 } from 'ethers';
import Logger from '../../../../lib/Logger';
import EthereumManager from '../../../../lib/wallet/ethereum/EthereumManager';
import { Ethereum } from '../../../../lib/wallet/ethereum/EvmNetworks';
import type Contracts from '../../../../lib/wallet/ethereum/contracts/Contracts';
import type ERC20WalletProvider from '../../../../lib/wallet/providers/ERC20WalletProvider';

// Mock the provider so constructing the manager does not open any RPC connection
jest.mock('../../../../lib/wallet/ethereum/InjectedProvider');

describe('EthereumManager', () => {
  const logger = Logger.disabledLogger;

  const newManager = () =>
    new EthereumManager(logger, Ethereum, {
      networkName: 'test',
      providerEndpoint: 'http://127.0.0.1:1',
      contracts: [{}],
      tokens: [],
    } as any);

  const newContract = (address: string) =>
    ({
      erc20Swap: {
        getAddress: jest.fn().mockResolvedValue(address),
      },
    }) as unknown as Contracts;

  const newWallet = (
    overrides: Partial<ERC20WalletProvider> = {},
  ): ERC20WalletProvider =>
    ({
      symbol: 'USDT',
      getAllowance: jest.fn().mockResolvedValue(0n),
      approve: jest.fn().mockResolvedValue({ transactionId: '0xtx' }),
      ...overrides,
    }) as unknown as ERC20WalletProvider;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('setErc20Allowances', () => {
    test('should set the allowance for every contract with an incrementing nonce', async () => {
      const manager = newManager();
      manager['signer'] = { getNonce: jest.fn().mockResolvedValue(21) } as any;
      manager['contracts'] = [newContract('0xaaa'), newContract('0xbbb')];

      const wallet = newWallet();
      await manager['setErc20Allowances'](wallet);

      expect(wallet.approve).toHaveBeenCalledTimes(2);
      expect(wallet.approve).toHaveBeenNthCalledWith(
        1,
        '0xaaa',
        MaxUint256,
        21,
      );
      expect(wallet.approve).toHaveBeenNthCalledWith(
        2,
        '0xbbb',
        MaxUint256,
        22,
      );
    });

    test('should not send an approval when the allowance is already set', async () => {
      const manager = newManager();
      manager['signer'] = { getNonce: jest.fn().mockResolvedValue(5) } as any;
      manager['contracts'] = [newContract('0xaaa')];

      const warn = jest.spyOn(logger, 'warn');
      const wallet = newWallet({
        getAllowance: jest.fn().mockResolvedValue(1n),
      } as any);

      await manager['setErc20Allowances'](wallet);

      expect(wallet.approve).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    });

    test('should keep booting and warn when the approval fails (unfunded wallet)', async () => {
      const manager = newManager();
      manager['signer'] = { getNonce: jest.fn().mockResolvedValue(7) } as any;
      manager['contracts'] = [newContract('0xaaa'), newContract('0xbbb')];

      const warn = jest.spyOn(logger, 'warn');
      const wallet = newWallet({
        approve: jest.fn().mockRejectedValue(new Error('missing revert data')),
      } as any);

      await expect(
        manager['setErc20Allowances'](wallet),
      ).resolves.toBeUndefined();

      // The approval is attempted for both contracts and, because the failed
      // approval must not consume a nonce, both use the same (not incremented) nonce
      expect(wallet.approve).toHaveBeenCalledTimes(2);
      expect(wallet.approve).toHaveBeenNthCalledWith(1, '0xaaa', MaxUint256, 7);
      expect(wallet.approve).toHaveBeenNthCalledWith(2, '0xbbb', MaxUint256, 7);

      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('USDT'));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('0xaaa'));
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('missing revert data'),
      );
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('funded'));
    });
  });
});
