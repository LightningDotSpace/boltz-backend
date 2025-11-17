import { etherDecimals } from '../../consts/Consts';

type NetworkDetails = {
  name: string;
  symbol: string;
  decimals: bigint;
};

const Ethereum: NetworkDetails = {
  name: 'Ethereum',
  symbol: 'ETH',
  decimals: etherDecimals,
};

const Rsk: NetworkDetails = {
  name: 'RSK',
  symbol: 'RBTC',
  decimals: etherDecimals,
};

const Citrea: NetworkDetails = {
  name: 'Citrea',
  symbol: 'cBTC',
  decimals: etherDecimals,
};

export { NetworkDetails, Ethereum, Rsk, Citrea };
