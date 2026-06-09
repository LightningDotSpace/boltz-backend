import type { Overrides, Provider } from 'ethers';
import { formatError, getHexBuffer } from '../../Utils';

/**
 * Removes the 0x prefix of the Ethereum bytes
 */
export const parseBuffer = (input: string): Buffer => {
  return getHexBuffer(input.slice(2));
};

/**
 * Known transient EVM RPC error conditions that are expected to recover on the
 * next poll/rescan. These are common on Citrea where the configured RPC
 * providers are briefly out of sync with each other or with the chain head:
 *
 *  - "block range extends beyond current ..." the node rejects an `eth_getLogs`
 *    whose `toBlock` is (briefly) ahead of the head it has indexed
 *  - "could not coalesce error" ethers could not reconcile the responses of the
 *    batched/underlying RPC calls
 *  - "requests to all providers failed" our own wrapper error when every
 *    configured provider rejected a single request
 *
 * Matching is intentionally narrow: only these well-known transient conditions
 * are treated as non-fatal. Anything else is considered a genuine error.
 */
export const isTransientRpcError = (error: unknown): boolean => {
  const message = (formatError(error) ?? '').toLowerCase();

  return (
    message.includes('block range extends beyond current') ||
    message.includes('could not coalesce error') ||
    message.includes('requests to all providers failed')
  );
};

export const getGasPrices = async (provider: Provider): Promise<Overrides> => {
  const feeData = await provider.getFeeData();

  // Legacy pre EIP-1559 provider
  if (feeData.maxFeePerGas === null || feeData.maxFeePerGas === undefined) {
    return {
      type: 0,
      gasPrice: (feeData.gasPrice! * 125n) / 100n,
    };
  }

  return {
    type: 2,
    maxFeePerGas: (feeData.maxFeePerGas * 125n) / 100n,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
  };
};
