import { DataTypes, Model, type Sequelize } from 'sequelize';

enum SnapshotType {
  Periodic = 'periodic',
  Swap = 'swap',
}

type WalletBalanceEntry = {
  symbol: string;
  service: string;
  confirmed: number;
  unconfirmed: number;
};

type LightningBalanceEntry = {
  symbol: string;
  service: string;
  local: number;
  remote: number;
};

type BalanceData = {
  wallets: WalletBalanceEntry[];
  lightning: LightningBalanceEntry[];
};

type BalanceSnapshotType = {
  id: number;
  snapshotType: SnapshotType;
  swapId: string | null;
  swapType: string | null;
  timestamp: Date;
  balances: BalanceData;
};

class BalanceSnapshot extends Model implements BalanceSnapshotType {
  public id!: number;
  public snapshotType!: SnapshotType;
  public swapId!: string | null;
  public swapType!: string | null;
  public timestamp!: Date;
  public balances!: BalanceData;

  public static load = (sequelize: Sequelize): void => {
    BalanceSnapshot.init(
      {
        id: {
          type: new DataTypes.BIGINT(),
          primaryKey: true,
          autoIncrement: true,
        },
        snapshotType: {
          type: new DataTypes.STRING(20),
          allowNull: false,
        },
        swapId: {
          type: new DataTypes.STRING(255),
          allowNull: true,
        },
        swapType: {
          type: new DataTypes.STRING(20),
          allowNull: true,
        },
        timestamp: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        balances: {
          type: DataTypes.JSONB,
          allowNull: false,
        },
      },
      {
        sequelize,
        tableName: 'balanceSnapshots',
        timestamps: false,
        indexes: [
          {
            fields: ['swapId'],
          },
          {
            fields: ['snapshotType'],
          },
          {
            fields: ['timestamp'],
          },
        ],
      },
    );
  };
}

export default BalanceSnapshot;
export {
  SnapshotType,
  BalanceData,
  BalanceSnapshotType,
  WalletBalanceEntry,
  LightningBalanceEntry,
};
