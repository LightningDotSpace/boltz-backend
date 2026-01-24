import type { Sequelize } from 'sequelize';
import { DataTypes, Model } from 'sequelize';

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
  id?: number;
  swapId: string;
  swapType: string;
  timestamp: Date;
  balances: BalanceData;
};

class BalanceSnapshot extends Model implements BalanceSnapshotType {
  public id!: number;
  public swapId!: string;
  public swapType!: string;
  public timestamp!: Date;
  public balances!: BalanceData;

  public createdAt!: Date;
  public updatedAt!: Date;

  public static load = (sequelize: Sequelize): void => {
    BalanceSnapshot.init(
      {
        id: {
          type: DataTypes.BIGINT,
          primaryKey: true,
          autoIncrement: true,
        },
        swapId: {
          type: new DataTypes.STRING(255),
          allowNull: false,
        },
        swapType: {
          type: new DataTypes.STRING(20),
          allowNull: false,
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
        indexes: [
          {
            unique: false,
            fields: ['swapId'],
          },
          {
            unique: false,
            fields: ['timestamp'],
          },
        ],
      },
    );
  };
}

export default BalanceSnapshot;
export {
  BalanceSnapshotType,
  BalanceData,
  WalletBalanceEntry,
  LightningBalanceEntry,
};
