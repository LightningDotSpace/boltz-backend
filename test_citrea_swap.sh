#!/bin/bash

# Test Citrea Swap via API
preimage_hash=$(openssl rand -hex 32)

curl -X POST http://localhost:9001/v2/swap/reverse \
  -H "Content-Type: application/json" \
  -d "{
    \"from\": \"BTC\",
    \"to\": \"cBTC\",
    \"onchainAmount\": 10000,
    \"claimAddress\": \"0xcDc60aD5cEC976c6C04265692d5edAcCc44f95b7\",
    \"preimageHash\": \"$preimage_hash\",
    \"description\": \"Test Citrea Swap\"
  }" | jq '.'
