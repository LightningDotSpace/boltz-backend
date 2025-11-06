#!/usr/bin/env node
/**
 * Check wallet balances on all chains
 */

const https = require('https');

const address = '0xcDc60aD5cEC976c6C04265692d5edAcCc44f95b7';

const chains = [
  {
    name: 'RSK (RBTC)',
    url: 'https://rootstock-mainnet.g.alchemy.com/v2/GEcs0OPJCkuWGvBLu5L6q',
  },
  {
    name: 'Citrea (cBTC)',
    url: 'https://rpc.testnet.citrea.xyz',
  },
];

console.log(`📊 Wallet Balances for: ${address}\n`);
console.log('─'.repeat(80));

const checkBalance = (chain) => {
  return new Promise((resolve) => {
    const postData = JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_getBalance',
      params: [address, 'latest'],
      id: 1,
    });

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': postData.length,
      },
    };

    const req = https.request(chain.url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          const balanceWei = BigInt(result.result);
          const balance = Number(balanceWei) / 1e18;
          console.log(`${chain.name.padEnd(20)} → ${balance.toFixed(8)}`);
          console.log(`${''.padEnd(20)} → ${balanceWei.toString()} wei`);
          resolve();
        } catch (err) {
          console.error(`Error parsing ${chain.name} response:`, err);
          resolve();
        }
      });
    });

    req.on('error', (error) => {
      console.error(`Error fetching ${chain.name} balance:`, error.message);
      resolve();
    });

    req.write(postData);
    req.end();
  });
};

Promise.all(chains.map(checkBalance)).then(() => {
  console.log('─'.repeat(80));
});
