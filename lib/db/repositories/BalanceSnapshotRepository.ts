import { Op } from 'sequelize';
import BalanceSnapshot, {
  type BalanceData,
  type SnapshotType,
} from '../models/BalanceSnapshot';

class BalanceSnapshotRepository {
  public static addSnapshot = async (data: {
    snapshotType: SnapshotType;
    swapId?: string;
    swapType?: string;
    timestamp: Date;
    balances: BalanceData;
  }): Promise<BalanceSnapshot> => {
    return BalanceSnapshot.create({
      snapshotType: data.snapshotType,
      swapId: data.swapId ?? null,
      swapType: data.swapType ?? null,
      timestamp: data.timestamp,
      balances: data.balances,
    });
  };

  public static getBySwapId = async (
    swapId: string,
  ): Promise<BalanceSnapshot | null> => {
    return BalanceSnapshot.findOne({
      where: { swapId },
    });
  };

  public static getByTimeRange = async (
    from: Date,
    to: Date,
    snapshotType?: SnapshotType,
  ): Promise<BalanceSnapshot[]> => {
    const where: any = {
      timestamp: {
        [Op.between]: [from, to],
      },
    };

    if (snapshotType) {
      where.snapshotType = snapshotType;
    }

    return BalanceSnapshot.findAll({
      where,
      order: [['timestamp', 'ASC']],
    });
  };

  public static getLatest = async (
    snapshotType?: SnapshotType,
  ): Promise<BalanceSnapshot | null> => {
    const where: any = {};

    if (snapshotType) {
      where.snapshotType = snapshotType;
    }

    return BalanceSnapshot.findOne({
      where,
      order: [['timestamp', 'DESC']],
    });
  };

  public static getSnapshots = async (
    limit: number,
    offset: number = 0,
    snapshotType?: SnapshotType,
  ): Promise<{ rows: BalanceSnapshot[]; count: number }> => {
    const where: any = {};

    if (snapshotType) {
      where.snapshotType = snapshotType;
    }

    return BalanceSnapshot.findAndCountAll({
      where,
      limit,
      offset,
      order: [['timestamp', 'DESC']],
    });
  };
}

export default BalanceSnapshotRepository;
