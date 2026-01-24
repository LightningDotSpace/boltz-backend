import type { WhereOptions } from 'sequelize';
import { Op } from 'sequelize';
import BalanceSnapshot, {
  type BalanceSnapshotType,
} from '../models/BalanceSnapshot';

class BalanceSnapshotRepository {
  public static addSnapshot = (
    data: Omit<BalanceSnapshotType, 'id'>,
  ): Promise<BalanceSnapshot> => {
    return BalanceSnapshot.create(data as BalanceSnapshotType);
  };

  public static getBySwapId = (
    swapId: string,
  ): Promise<BalanceSnapshot | null> => {
    return BalanceSnapshot.findOne({
      where: { swapId },
    });
  };

  public static getByTimeRange = (
    from: Date,
    to: Date,
  ): Promise<BalanceSnapshot[]> => {
    return BalanceSnapshot.findAll({
      where: {
        timestamp: {
          [Op.gte]: from,
          [Op.lte]: to,
        },
      },
      order: [['timestamp', 'ASC']],
    });
  };

  public static getLatest = (): Promise<BalanceSnapshot | null> => {
    return BalanceSnapshot.findOne({
      order: [['timestamp', 'DESC']],
    });
  };

  public static getSnapshots = (
    options?: WhereOptions,
    limit?: number,
  ): Promise<BalanceSnapshot[]> => {
    return BalanceSnapshot.findAll({
      where: options,
      order: [['timestamp', 'DESC']],
      limit,
    });
  };
}

export default BalanceSnapshotRepository;
