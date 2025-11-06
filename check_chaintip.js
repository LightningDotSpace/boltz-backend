#!/usr/bin/env node
/**
 * Check ChainTip in database
 */

const { Sequelize, DataTypes } = require('sequelize');

const sequelize = new Sequelize('boltz', 'boltz', 'boltz', {
  host: 'localhost',
  dialect: 'postgres',
  logging: false,
});

const ChainTip = sequelize.define('chainTips', {
  symbol: { type: DataTypes.STRING, primaryKey: true },
  height: DataTypes.INTEGER,
}, {
  tableName: 'chainTips',
  timestamps: false,
});

async function checkChainTips() {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to PostgreSQL database\n');

    const tips = await ChainTip.findAll();

    console.log('📊 ChainTip Heights in Database:\n');
    console.log('─'.repeat(80));

    for (const tip of tips) {
      console.log(`${tip.symbol.padEnd(10)} → Block Height: ${tip.height}`);
    }

    console.log('─'.repeat(80));

    // Get current blocks from providers
    console.log('\n🌐 Current Block Heights from Providers:\n');

    const https = require('https');

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

    // RSK
    const rskUrl = 'https://rootstock-mainnet.g.alchemy.com/v2/GEcs0OPJCkuWGvBLu5L6q';
    const rskReq = https.request(rskUrl, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          const rskBlock = parseInt(result.result, 16);
          console.log(`RBTC (RSK)     → Current Block: ${rskBlock}`);

          const rskTip = tips.find(t => t.symbol === 'RBTC');
          if (rskTip) {
            const diff = rskBlock - rskTip.height;
            console.log(`               → Difference: ${diff} blocks`);
            if (Math.abs(diff) > 100) {
              console.log(`               ⚠️  ChainTip is ${Math.abs(diff)} blocks ${diff > 0 ? 'behind' : 'ahead'}!`);
            }
          }
        } catch (err) {
          console.error('Error:', err);
        }
      });
    });

    rskReq.on('error', (error) => {
      console.error('Error fetching RSK block:', error);
    });

    rskReq.write(postData);
    rskReq.end();

    // Citrea
    const citreaUrl = 'https://rpc.testnet.citrea.xyz';
    const citreaReq = https.request(citreaUrl, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          const citreaBlock = parseInt(result.result, 16);
          console.log(`cBTC (Citrea)  → Current Block: ${citreaBlock}`);

          const citreaTip = tips.find(t => t.symbol === 'cBTC');
          if (citreaTip) {
            const diff = citreaBlock - citreaTip.height;
            console.log(`               → Difference: ${diff} blocks`);
            if (Math.abs(diff) > 100) {
              console.log(`               ⚠️  ChainTip is ${Math.abs(diff)} blocks ${diff > 0 ? 'behind' : 'ahead'}!`);
            }
          }

          sequelize.close();
        } catch (err) {
          console.error('Error:', err);
          sequelize.close();
        }
      });
    });

    citreaReq.on('error', (error) => {
      console.error('Error fetching Citrea block:', error);
      sequelize.close();
    });

    citreaReq.write(postData);
    citreaReq.end();

  } catch (error) {
    console.error('Error:', error);
    await sequelize.close();
    process.exit(1);
  }
}

checkChainTips();
