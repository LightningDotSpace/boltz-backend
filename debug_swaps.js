#!/usr/bin/env node
/**
 * Debug-Skript für Swap-Timeouts
 */

const { Sequelize, DataTypes } = require('sequelize');

// Datenbank-Verbindung
const sequelize = new Sequelize('boltz', 'boltz', 'boltz', {
  host: 'localhost',
  dialect: 'postgres',
  logging: false,
});

// ReverseSwap Model (vereinfacht)
const ReverseSwap = sequelize.define('reverseSwaps', {
  id: { type: DataTypes.STRING, primaryKey: true },
  status: DataTypes.STRING,
  pair: DataTypes.STRING,
  timeoutBlockHeight: DataTypes.INTEGER,
  transactionId: DataTypes.STRING,
  failureReason: DataTypes.STRING,
  invoice: DataTypes.STRING,
  createdAt: DataTypes.DATE,
  updatedAt: DataTypes.DATE,
}, {
  tableName: 'reverseSwaps',
  timestamps: true,
});

async function debugSwaps() {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to PostgreSQL database\n');

    // Hole die letzten 5 Swaps
    const swaps = await ReverseSwap.findAll({
      order: [['createdAt', 'DESC']],
      limit: 5,
    });

    console.log('📊 Last 5 Reverse Swaps:\n');
    console.log('─'.repeat(120));

    for (const swap of swaps) {
      console.log(`ID: ${swap.id}`);
      console.log(`  Status: ${swap.status}`);
      console.log(`  Pair: ${swap.pair}`);
      console.log(`  Timeout Block Height: ${swap.timeoutBlockHeight}`);
      console.log(`  Transaction ID: ${swap.transactionId || 'NULL'}`);
      console.log(`  Failure Reason: ${swap.failureReason || 'None'}`);
      console.log(`  Created: ${swap.createdAt}`);
      console.log(`  Updated: ${swap.updatedAt}`);
      console.log('─'.repeat(120));
    }

    // Hole aktuellen Block Height von Providern
    console.log('\n🔗 Checking current block heights...\n');

    const https = require('https');

    // Chain-Konfiguration
    const chains = {
      'BTC/RBTC': {
        name: 'RSK',
        url: 'https://rootstock-mainnet.g.alchemy.com/v2/GEcs0OPJCkuWGvBLu5L6q',
        blockTime: 0.5, // 30 Sekunden = 0.5 Minuten
      },
      'BTC/cBTC': {
        name: 'Citrea',
        url: 'https://rpc.testnet.citrea.xyz',
        blockTime: 0.0333, // 2 Sekunden = 0.0333 Minuten
      },
    };

    const postData = JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_blockNumber',
      params: [],
      id: 1,
    });

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': postData.length,
      },
    };

    // Gruppiere Swaps nach Chain
    const swapsByChain = {};
    for (const swap of swaps) {
      const chain = chains[swap.pair];
      if (chain) {
        if (!swapsByChain[swap.pair]) {
          swapsByChain[swap.pair] = [];
        }
        swapsByChain[swap.pair].push(swap);
      }
    }

    // Prüfe jede Chain
    const chainPromises = Object.keys(swapsByChain).map((pair) => {
      return new Promise((resolve) => {
        const chain = chains[pair];
        const chainSwaps = swapsByChain[pair];

        const req = https.request(chain.url, options, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              const result = JSON.parse(data);
              const currentBlock = parseInt(result.result, 16);
              console.log(`Current ${chain.name} Block Height: ${currentBlock}`);

              // Vergleiche mit Swap Timeouts
              console.log(`\n⏰ Timeout Analysis for ${chain.name} (${pair}):\n`);
              console.log('─'.repeat(120));

              for (const swap of chainSwaps) {
                const blockDiff = swap.timeoutBlockHeight - currentBlock;
                const minutesLeft = blockDiff * chain.blockTime;
                const hoursLeft = minutesLeft / 60;

                console.log(`Swap ${swap.id}:`);
                console.log(`  Timeout Block: ${swap.timeoutBlockHeight}`);
                console.log(`  Current Block: ${currentBlock}`);
                console.log(`  Blocks Until Timeout: ${blockDiff}`);
                console.log(`  Time Until Timeout: ${hoursLeft.toFixed(2)} hours (${minutesLeft.toFixed(0)} minutes)`);

                if (blockDiff < 0) {
                  console.log(`  ⚠️  EXPIRED! (${Math.abs(blockDiff)} blocks ago)`);
                } else if (blockDiff < 10) {
                  console.log(`  ⚠️  EXPIRING SOON! (${blockDiff} blocks left)`);
                } else {
                  console.log(`  ✅ Still valid`);
                }
                console.log('─'.repeat(120));
              }

              resolve();
            } catch (err) {
              console.error(`Error parsing ${chain.name} response:`, err);
              resolve();
            }
          });
        });

        req.on('error', (error) => {
          console.error(`Error fetching ${chain.name} block:`, error);
          resolve();
        });

        req.write(postData);
        req.end();
      });
    });

    // Warte bis alle Chains geprüft sind
    Promise.all(chainPromises).then(() => {
      sequelize.close();
    });

  } catch (error) {
    console.error('Error:', error);
    await sequelize.close();
    process.exit(1);
  }
}

debugSwaps();
