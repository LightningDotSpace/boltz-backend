#!/usr/bin/env node
/**
 * Debug minerFees for all currencies
 */

const http = require('http');

const url = 'http://localhost:9001';

// Check all swap endpoints
const endpoints = [
  '/v2/swap/submarine',
  '/v2/swap/reverse',
];

console.log('🔍 Debugging minerFees for all currencies\n');
console.log('═'.repeat(80));

endpoints.forEach(endpoint => {
  http.get(`${url}${endpoint}`, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      try {
        const response = JSON.parse(data);
        console.log(`\n📊 ${endpoint}:\n`);

        Object.keys(response).forEach(currency => {
          Object.keys(response[currency]).forEach(pair => {
            const config = response[currency][pair];
            console.log(`  ${currency}/${pair}:`);
            console.log(`    minerFees: ${JSON.stringify(config.fees.minerFees)}`);
          });
        });
      } catch (err) {
        console.error(`Error parsing response from ${endpoint}:`, err.message);
      }
    });
  }).on('error', (err) => {
    console.error(`Error fetching ${endpoint}:`, err.message);
  });
});

setTimeout(() => {
  console.log('\n' + '═'.repeat(80));
}, 2000);
