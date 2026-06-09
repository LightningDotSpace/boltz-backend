import type { Provider } from 'ethers';
import { getHexBuffer } from '../../../../lib/Utils';
import {
  getGasPrices,
  isTransientRpcError,
  parseBuffer,
} from '../../../../lib/wallet/ethereum/EthereumUtils';

let mockGetFeeDataResult: any;
const mockGetFeeData = jest
  .fn()
  .mockImplementation(async () => mockGetFeeDataResult);

const MockedProvider = <jest.Mock<Provider>>(
  (<any>jest.fn().mockImplementation(() => ({
    getFeeData: mockGetFeeData,
  })))
);

describe('EthereumUtils', () => {
  const provider = new MockedProvider();

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should parse buffers', () => {
    const data =
      '40fee37b911579bdd107e57add77c9351ace6692cd01dee36fd7879c6a7cf9fe';

    expect(parseBuffer(`0x${data}`)).toEqual(getHexBuffer(data));
  });

  test.each`
    name                          | expected                                                         | feeData
    ${'EIP-1559'}                 | ${{ type: 2, maxFeePerGas: 2904431n, maxPriorityFeePerGas: 1n }} | ${{ maxFeePerGas: 2323545n, maxPriorityFeePerGas: 1n }}
    ${'sanitized EIP-1559'}       | ${{ type: 2, maxFeePerGas: 2904431n, maxPriorityFeePerGas: 1n }} | ${{ maxFeePerGas: 2323545n, maxPriorityFeePerGas: 1n, some: 'shenanigans' }}
    ${'legacy'}                   | ${{ type: 0, gasPrice: 153n }}                                   | ${{ gasPrice: 123n }}
    ${'legacy null maxFeePerGas'} | ${{ type: 0, gasPrice: 153n }}                                   | ${{ gasPrice: 123n, maxFeePerGas: null }}
    ${'sanitized legacy'}         | ${{ type: 0, gasPrice: 153n }}                                   | ${{ gasPrice: 123n, other: 'data', maxPriorityFeePerGas: 42n }}
  `('should get $name gas prices', async ({ expected, feeData }) => {
    mockGetFeeDataResult = feeData;
    expect(await getGasPrices(provider)).toEqual(expected);

    expect(mockGetFeeData).toHaveBeenCalledTimes(1);
  });

  test.each`
    name                              | error                                                                                                                     | expected
    ${'block range beyond head'}      | ${new Error('could not coalesce error (error={ "code": -32000, "message": "block range extends beyond current head" })')} | ${true}
    ${'plain block range message'}    | ${'block range extends beyond current finalized block'}                                                                   | ${true}
    ${'coalesce error'}               | ${new Error('could not coalesce error')}                                                                                  | ${true}
    ${'all providers failed'}         | ${new Error('requests to all providers failed:\n - timeout')}                                                             | ${true}
    ${'boltz providers error object'} | ${{ message: 'requests to all providers failed:\n - timeout', code: 'ETH.4' }}                                            | ${true}
    ${'uppercase message'}            | ${new Error('Could Not Coalesce Error')}                                                                                  | ${true}
    ${'genuine error'}                | ${new Error('execution reverted: bad swap')}                                                                              | ${false}
    ${'nonce too low'}                | ${new Error('nonce too low')}                                                                                             | ${false}
    ${'undefined'}                    | ${undefined}                                                                                                              | ${false}
    ${'random string'}                | ${'something went wrong'}                                                                                                 | ${false}
  `('should classify transient RPC error: $name', ({ error, expected }) => {
    expect(isTransientRpcError(error)).toEqual(expected);
  });
});
