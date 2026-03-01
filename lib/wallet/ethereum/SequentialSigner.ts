import { SpanKind, SpanStatusCode, context, trace } from '@opentelemetry/api';
import AsyncLock from 'async-lock';
import type {
  Provider,
  Signer,
  TransactionResponse,
  TransactionRequest,
  TypedDataDomain,
  TypedDataField,
} from 'ethers';
import { AbstractSigner, Transaction } from 'ethers';
import type Logger from '../../Logger';
import Tracing from '../../Tracing';
import { formatError } from '../../Utils';
import PendingEthereumTransactionRepository from '../../db/repositories/PendingEthereumTransactionRepository';

class SequentialSigner extends AbstractSigner {
  private static readonly txLock = 'txLock';
  private static readonly mempoolPollIntervalMs = 2_000;
  private static readonly mempoolMaxAttempts = 10;

  private readonly lock = new AsyncLock();

  constructor(
    private readonly logger: Logger,
    private readonly symbol: string,
    private readonly chainIdentifier: string,
    private signer: AbstractSigner,
  ) {
    super(signer.provider);
  }

  public getAddress = (): Promise<string> => this.signer.getAddress();

  public connect = (provider: null | Provider): Signer => {
    return new SequentialSigner(
      this.logger,
      this.symbol,
      this.chainIdentifier,
      this.signer.connect(provider),
    );
  };

  public signTransaction = async (
    tx: TransactionRequest,
  ): Promise<string> => this.signer.signTransaction(tx);

  public signMessage = (message: string | Uint8Array): Promise<string> =>
    this.signer.signMessage(message);

  public signTypedData = (
    domain: TypedDataDomain,
    types: Record<string, Array<TypedDataField>>,
    value: Record<string, any>,
  ): Promise<string> => this.signer.signTypedData(domain, types, value);

  /**
   * Queued transaction sender. Acquires an exclusive lock so only one
   * transaction is processed at a time:
   *   assign nonce → populate → balance check → sign → record in DB →
   *   broadcast → poll mempool visibility → release lock
   */
  public sendTransaction = async (
    tx: TransactionRequest,
  ): Promise<TransactionResponse> => {
    const span = Tracing.tracer.startSpan(
      `Sending ${this.symbol} transaction`,
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          value: tx.value?.toString(),
        },
      },
    );
    const ctx = trace.setSpan(context.active(), span);

    try {
      return await this.lock.acquire(SequentialSigner.txLock, async () =>
        context.with(ctx, async () => {
          const nonce = await this.getNextNonce();

          span.setAttribute('nonce', nonce);

          const populated = await this.signer.populateTransaction({
            ...tx,
            nonce,
          });

          if (populated.value && BigInt(populated.value) > 0n) {
            const [balance, pendingValue] = await Promise.all([
              this.signer.provider!.getBalance(await this.getAddress()),
              PendingEthereumTransactionRepository.getTotalSent(
                this.chainIdentifier,
              ),
            ]);
            if (balance - pendingValue < BigInt(populated.value)) {
              throw new Error('insufficient balance');
            }
          }

          const signed = await this.signer.signTransaction(populated);
          const parsedTx = Transaction.from(signed);

          await PendingEthereumTransactionRepository.addTransaction(
            parsedTx.hash!,
            this.chainIdentifier,
            parsedTx.nonce,
            parsedTx.value,
            signed,
          );

          let response: TransactionResponse;
          try {
            response = await this.provider!.broadcastTransaction(signed);
          } catch (e) {
            await PendingEthereumTransactionRepository.removeTransaction(
              parsedTx.hash!,
            );
            throw e;
          }

          await this.waitForMempoolVisibility(parsedTx.hash!, signed);

          return response;
        }),
      );
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: formatError(error),
      });
      throw error;
    } finally {
      span.end();
    }
  };

  private getNextNonce = async (): Promise<number> => {
    const dbNonce =
      await PendingEthereumTransactionRepository.getHighestNonce(
        this.chainIdentifier,
      );
    if (dbNonce !== undefined) return dbNonce;

    return this.signer.provider!.getTransactionCount(
      await this.getAddress(),
      'pending',
    );
  };

  private waitForMempoolVisibility = async (
    txHash: string,
    signedHex: string,
  ): Promise<void> => {
    const provider = this.provider!;

    for (
      let attempt = 1;
      attempt <= SequentialSigner.mempoolMaxAttempts;
      attempt++
    ) {
      await new Promise((r) =>
        setTimeout(r, SequentialSigner.mempoolPollIntervalMs),
      );

      try {
        const found = await provider.getTransaction(txHash);
        if (found !== null) return;
      } catch {
        // Provider failure during poll — continue retrying
      }

      this.logger.warn(
        `${this.symbol} tx ${txHash} not in mempool (attempt ${attempt}/${SequentialSigner.mempoolMaxAttempts}), rebroadcasting`,
      );

      if ('rebroadcastRawTransaction' in provider) {
        await (provider as any)
          .rebroadcastRawTransaction(signedHex)
          .catch(() => {});
      } else {
        await provider.broadcastTransaction(signedHex).catch(() => {});
      }
    }

    this.logger.error(
      `${this.symbol} tx ${txHash} never appeared in mempool after ${SequentialSigner.mempoolMaxAttempts} attempts, destroying record`,
    );
    await PendingEthereumTransactionRepository.removeTransaction(txHash);
    throw new Error(
      `transaction ${txHash} not visible in mempool after ${(SequentialSigner.mempoolMaxAttempts * SequentialSigner.mempoolPollIntervalMs) / 1_000}s`,
    );
  };
}

export default SequentialSigner;
