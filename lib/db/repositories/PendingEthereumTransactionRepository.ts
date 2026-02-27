import PendingEthereumTransaction from '../models/PendingEthereumTransaction';

class PendingEthereumTransactionRepository {
  public static getTransactions = (
    chainIdentifier: string,
  ): Promise<PendingEthereumTransaction[]> => {
    return PendingEthereumTransaction.findAll({
      where: { chainIdentifier },
    });
  };

  public static getAllTransactions = (): Promise<
    PendingEthereumTransaction[]
  > => {
    return PendingEthereumTransaction.findAll();
  };

  public static getTransaction = (
    hash: string,
    chainIdentifier: string,
  ): Promise<PendingEthereumTransaction | null> => {
    return PendingEthereumTransaction.findOne({
      where: { hash, chainIdentifier },
    });
  };

  public static getHighestNonce = async (
    chainIdentifier: string,
  ): Promise<number | undefined> => {
    const nonce = await PendingEthereumTransaction.max<
      number,
      PendingEthereumTransaction
    >('nonce', {
      where: { chainIdentifier },
    });
    if (nonce === null || nonce === undefined) {
      return undefined;
    }

    return nonce + 1;
  };

  public static getTotalSent = async (
    chainIdentifier: string,
  ): Promise<bigint> => {
    return BigInt(
      (await PendingEthereumTransaction.sum<number, PendingEthereumTransaction>(
        'etherAmount',
        { where: { chainIdentifier } },
      )) ?? 0,
    );
  };

  public static addTransaction = (
    hash: string,
    chainIdentifier: string,
    nonce: number,
    etherAmount: bigint,
    hex: string,
  ): Promise<PendingEthereumTransaction> => {
    return PendingEthereumTransaction.create({
      hash,
      chainIdentifier,
      nonce,
      etherAmount,
      hex,
    });
  };
}

export default PendingEthereumTransactionRepository;
