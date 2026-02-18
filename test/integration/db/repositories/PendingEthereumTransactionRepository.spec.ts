import Logger from '../../../../lib/Logger';
import Database from '../../../../lib/db/Database';
import PendingEthereumTransaction from '../../../../lib/db/models/PendingEthereumTransaction';
import PendingEthereumTransactionRepository from '../../../../lib/db/repositories/PendingEthereumTransactionRepository';

describe('PendingEthereumTransactionRepository', () => {
  let database: Database;

  const chain = 'Ethereum';

  beforeAll(async () => {
    database = new Database(Logger.disabledLogger, Database.memoryDatabase);
    await database.init();
  });

  beforeEach(async () => {
    await PendingEthereumTransaction.truncate();
  });

  afterAll(async () => {
    await database.close();
  });

  describe('getHighestNonce', () => {
    test('should get highest nonce when there are no pending transactions', async () => {
      await expect(
        PendingEthereumTransactionRepository.getHighestNonce(chain),
      ).resolves.toEqual(undefined);
    });

    test('should get highest nonce when there are pending transactions', async () => {
      await PendingEthereumTransactionRepository.addTransaction(
        'txHash',
        chain,
        20,
        1n,
        '',
      );

      await expect(
        PendingEthereumTransactionRepository.getHighestNonce(chain),
      ).resolves.toEqual(21);
    });

    test('should only return highest nonce for the specified chain', async () => {
      await PendingEthereumTransactionRepository.addTransaction(
        'txHash1',
        'Ethereum',
        20,
        1n,
        '',
      );
      await PendingEthereumTransactionRepository.addTransaction(
        'txHash2',
        'Citrea',
        50,
        1n,
        '',
      );

      await expect(
        PendingEthereumTransactionRepository.getHighestNonce('Ethereum'),
      ).resolves.toEqual(21);
      await expect(
        PendingEthereumTransactionRepository.getHighestNonce('Citrea'),
      ).resolves.toEqual(51);
    });
  });

  describe('getTotalSent', () => {
    test('should get total sent when there are no pending transactions', async () => {
      await expect(
        PendingEthereumTransactionRepository.getTotalSent(chain),
      ).resolves.toEqual(BigInt(0));
    });

    test('should get total sent when there are pending transactions', async () => {
      await PendingEthereumTransactionRepository.addTransaction(
        'txHash',
        chain,
        20,
        21n,
        '',
      );
      await PendingEthereumTransactionRepository.addTransaction(
        'txHash2',
        chain,
        21,
        21n,
        '',
      );

      await expect(
        PendingEthereumTransactionRepository.getTotalSent(chain),
      ).resolves.toEqual(BigInt(42));
    });

    test('should only sum values for the specified chain', async () => {
      await PendingEthereumTransactionRepository.addTransaction(
        'txHash1',
        'Ethereum',
        20,
        100n,
        '',
      );
      await PendingEthereumTransactionRepository.addTransaction(
        'txHash2',
        'Citrea',
        20,
        200n,
        '',
      );

      await expect(
        PendingEthereumTransactionRepository.getTotalSent('Ethereum'),
      ).resolves.toEqual(BigInt(100));
      await expect(
        PendingEthereumTransactionRepository.getTotalSent('Citrea'),
      ).resolves.toEqual(BigInt(200));
    });
  });

  describe('getTransactions', () => {
    test('should only return transactions for the specified chain', async () => {
      await PendingEthereumTransactionRepository.addTransaction(
        'ethTx',
        'Ethereum',
        1,
        10n,
        'hex1',
      );
      await PendingEthereumTransactionRepository.addTransaction(
        'citreaTx',
        'Citrea',
        1,
        20n,
        'hex2',
      );

      const ethTxs =
        await PendingEthereumTransactionRepository.getTransactions('Ethereum');
      expect(ethTxs).toHaveLength(1);
      expect(ethTxs[0].hash).toEqual('ethTx');

      const citreaTxs =
        await PendingEthereumTransactionRepository.getTransactions('Citrea');
      expect(citreaTxs).toHaveLength(1);
      expect(citreaTxs[0].hash).toEqual('citreaTx');
    });
  });

  describe('getAllTransactions', () => {
    test('should return transactions from all chains', async () => {
      await PendingEthereumTransactionRepository.addTransaction(
        'ethTx',
        'Ethereum',
        1,
        10n,
        'hex1',
      );
      await PendingEthereumTransactionRepository.addTransaction(
        'citreaTx',
        'Citrea',
        1,
        20n,
        'hex2',
      );

      const allTxs =
        await PendingEthereumTransactionRepository.getAllTransactions();
      expect(allTxs).toHaveLength(2);
    });
  });

  describe('composite unique index', () => {
    test('should allow same nonce on different chains', async () => {
      await PendingEthereumTransactionRepository.addTransaction(
        'ethTx',
        'Ethereum',
        5,
        10n,
        'hex1',
      );
      await expect(
        PendingEthereumTransactionRepository.addTransaction(
          'citreaTx',
          'Citrea',
          5,
          20n,
          'hex2',
        ),
      ).resolves.toBeDefined();
    });
  });
});
