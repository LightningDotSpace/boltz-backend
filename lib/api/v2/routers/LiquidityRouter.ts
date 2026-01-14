import type { Request, Response } from 'express';
import { Router } from 'express';
import type Logger from '../../../Logger';
import type Service from '../../../service/Service';
import { successResponse } from '../../Utils';
import RouterBase from './RouterBase';

type TokenInfo = {
  contract: string;
  decimals: number;
  balance: string;
};

type ChainLiquidity = {
  chainId: number;
  name: string;
  wallet: string;
  tokens: Record<string, TokenInfo>;
};

class LiquidityRouter extends RouterBase {
  constructor(
    logger: Logger,
    private readonly service: Service,
  ) {
    super(logger, 'liquidity');
  }

  public getRouter = () => {
    /**
     * @openapi
     * tags:
     *   name: Liquidity
     *   description: Liquidity wallet information
     */

    const router = Router();

    /**
     * @openapi
     * /liquidity:
     *   get:
     *     description: Get liquidity wallet addresses and balances for all EVM chains
     *     tags: [Liquidity]
     *     responses:
     *       '200':
     *         description: Liquidity information per chain
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               additionalProperties:
     *                 type: object
     *                 properties:
     *                   chainId:
     *                     type: integer
     *                   name:
     *                     type: string
     *                   wallet:
     *                     type: string
     *                   tokens:
     *                     type: object
     *                     additionalProperties:
     *                       type: object
     *                       properties:
     *                         contract:
     *                           type: string
     *                         decimals:
     *                           type: integer
     *                         balance:
     *                           type: string
     */
    router.get('/', this.handleError(this.getLiquidity));

    return router;
  };

  private getLiquidity = async (_req: Request, res: Response) => {
    const result: Record<string, ChainLiquidity> = {};

    for (const manager of this.service.walletManager.ethereumManagers) {
      const chainKey = manager.networkDetails.symbol.toLowerCase();

      const tokens: Record<string, TokenInfo> = {};

      // Get token balances
      for (const [symbol, tokenAddress] of manager.tokenAddresses) {
        const wallet = this.service.walletManager.wallets.get(symbol);
        let balance = '0';
        let decimals = 18;

        if (wallet) {
          try {
            const balanceInfo = await wallet.getBalance();
            balance = balanceInfo.confirmed.toString();
          } catch {
            // Ignore balance errors
          }

          // Get decimals from config
          const tokenConfig = this.service.walletManager.ethereumManagers
            .flatMap((m) =>
              (m as any).config?.tokens?.filter(
                (t: any) => t.symbol === symbol,
              ) || [],
            )
            .find((t: any) => t.decimals);

          if (tokenConfig) {
            decimals = tokenConfig.decimals;
          }
        }

        tokens[symbol] = {
          contract: tokenAddress,
          decimals,
          balance,
        };
      }

      // Also add native token (ETH, cBTC, etc.)
      const nativeWallet = this.service.walletManager.wallets.get(
        manager.networkDetails.symbol,
      );
      if (nativeWallet) {
        try {
          const balanceInfo = await nativeWallet.getBalance();
          tokens[manager.networkDetails.symbol] = {
            contract: 'native',
            decimals: Number(manager.networkDetails.decimals),
            balance: balanceInfo.confirmed.toString(),
          };
        } catch {
          // Ignore balance errors
        }
      }

      result[chainKey] = {
        chainId: Number(manager.network.chainId),
        name: manager.network.name,
        wallet: manager.address,
        tokens,
      };
    }

    successResponse(res, result);
  };
}

export default LiquidityRouter;
