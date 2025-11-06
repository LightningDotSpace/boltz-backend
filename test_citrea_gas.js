#!/usr/bin/env node
const { ethers } = require('ethers');

async function testGasPrice() {
  const provider = new ethers.JsonRpcProvider('https://rpc.testnet.citrea.xyz');

  console.log('Testing Citrea Testnet Gas Price...\n');

  try {
    const feeData = await provider.getFeeData();
    console.log('Fee Data:');
    console.log('  gasPrice:', feeData.gasPrice ? feeData.gasPrice.toString() : 'null');
    console.log('  maxFeePerGas:', feeData.maxFeePerGas ? feeData.maxFeePerGas.toString() : 'null');
    console.log('  maxPriorityFeePerGas:', feeData.maxPriorityFeePerGas ? feeData.maxPriorityFeePerGas.toString() : 'null');

    if (!feeData.gasPrice && !feeData.maxFeePerGas) {
      console.log('\n❌ Problem: Citrea returns NO gas prices!');
      console.log('This is why minerFees are null.');
    } else {
      console.log('\n✅ Gas prices available');
    }
  } catch (error) {
    console.error('Error:', error.message);
  }

  // Test RSK for comparison
  console.log('\n\nTesting RSK for comparison...\n');
  const rskProvider = new ethers.JsonRpcProvider('https://rootstock-mainnet.g.alchemy.com/v2/GEcs0OPJCkuWGvBLu5L6q');

  try {
    const rskFeeData = await rskProvider.getFeeData();
    console.log('RSK Fee Data:');
    console.log('  gasPrice:', rskFeeData.gasPrice ? rskFeeData.gasPrice.toString() : 'null');
    console.log('  maxFeePerGas:', rskFeeData.maxFeePerGas ? rskFeeData.maxFeePerGas.toString() : 'null');
    console.log('  maxPriorityFeePerGas:', rskFeeData.maxPriorityFeePerGas ? rskFeeData.maxPriorityFeePerGas.toString() : 'null');
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testGasPrice();
