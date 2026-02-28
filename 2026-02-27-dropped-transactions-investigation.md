# Dropped EVM Transactions Investigation

**Date:** 2026-02-27
**Environment:** LDS Production (`vm-lds-btc-prd`)
**Affected pairs:** JUSD_CITREA/USDT_ETH, BTC/cBTC (any EVM-based chain swap)

## Problem Summary

When multiple chain swaps are created in rapid succession (~6 swaps within 20-30 seconds), some server-side lockup transactions are either dropped from the EVM mempool or fail with nonce collisions. This causes swaps to be marked as `transaction.failed` even though, in some cases, the lockup transaction actually lands on-chain and the swap completes successfully from the user's perspective.

## Reproduction

Creating 6 JUSD_CITREA -> USDT_ETH chain swaps in quick succession reliably triggers the issue. Of the 6 swaps, typically the first 3-4 succeed while the remaining ones fail.

## Test 1 - Ethereum lockups (JUSD_CITREA -> USDT_ETH)

**Swaps created between 12:22:27 and 12:23:15 UTC:**

| Swap ID | Nonce | Lockup Sent | Outcome |
|---------|-------|-------------|---------|
| gTsxNa1zUP8o | 307 | 12:23:23 | Succeeded |
| 9ZPDRSRI9QnR | 308 | 12:23:24 | Succeeded |
| xfFcpCvy5Scw | 309 | 12:23:25 | Succeeded |
| ARxyxYWNhQVB | 310 | 12:23:27 | Succeeded |
| bq8ekcNBSqVV | 311 | 12:23:28 | **Marked failed** - tx dropped from mempool |
| EkgFGvskkYhh | 312 | 12:23:30 | **Marked failed** - tx dropped from mempool |

Last confirmed on-chain nonce: 310. Nonces 311 and 312 were left orphaned in the `pendingEthereumTransactions` database table.

The drop detection mechanism (`checkDroppedLockupTransactions` in `EthereumNursery`) polled `getTransaction()` on every block. After just 2 blocks (~24 seconds) of `getTransaction` returning `null`, it declared the transactions dropped and marked the swaps as `transaction.failed`.

## Test 2 - After deploying additional diagnostic logging

**7 swaps created between 15:54:15 and 15:54:37 UTC, all JUSD_CITREA -> USDT_ETH:**

| Swap ID | Nonce | Outcome | Final result |
|---------|-------|---------|-------------|
| UzaKyop1kGdd | 313 | Succeeded | Claimed 15:56:15 |
| MqUtYPhdwmLu | 314 | Succeeded | Claimed 15:55:50 |
| QzuA8hQe592u | **315** | Marked failed (dropped) | **Actually succeeded** - claimed 16:00:01 |
| y2e2UTEfRVVo | **316** | Marked failed (dropped) | **Actually succeeded** - claimed 15:59:53 |
| VqTDEcBRN2US | **317** | Marked failed (dropped) | **Actually succeeded** - claimed 15:59:38 |
| Nd4WD97rmPa3 | 318 | "not found (1/2)" then OK | Claimed 15:56:49 |
| g7uILg4L8XME | — | Created but no lockup observed | — |

Three swaps (nonces 315, 316, 317) were **falsely identified as dropped**. The lockup transactions were still propagating through the network and eventually confirmed on-chain. The users saw a brief `transaction.failed` state in the frontend before the swap completed successfully.

## Test 3 - Citrea lockup (BTC -> cBTC)

**Swap Wgy24WqshhCy at 16:18:50 UTC:**

The BTC lockup from the user confirmed at 16:29:44. The server then attempted to lock up 2,679 cBTC on Citrea but failed with:

```
nonce too low: next nonce 1128, tx nonce 1127
```

The server tried to send a transaction with nonce 1127, but the Citrea node reported the next expected nonce was 1128. This means nonce 1127 was already consumed by a concurrent transaction from the same wallet. The lockup was attempted twice with the same stale nonce and failed both times.

## Two distinct problems identified

### Problem 1: False-positive drop detection

The `checkDroppedLockupTransactions` mechanism in `EthereumNursery` ran on every new block and called `getTransaction(txHash)` for all swaps in `TransactionServerMempool` status. If `getTransaction` returned `null` on 2 consecutive checks (~24 seconds), it declared the transaction dropped from the mempool and set the swap to `transaction.failed`.

In practice, `getTransaction` can return `null` for pending transactions that are still valid - particularly when the RPC node is under load, between blocks, or when transactions with higher nonces are queued behind earlier ones that haven't been mined yet. The 2-check threshold was too aggressive.

This mechanism also conflicted with `listenContractTransaction`, which watches the same transactions via ethers' `transaction.wait(1)`. The drop detection could mark a swap as failed before `wait(1)` had a chance to resolve with the confirmation.

### Problem 2: Nonce collision under concurrent transaction sending

The `SequentialSigner` wraps ethers' `AbstractSigner` and uses an `AsyncLock` to serialize transaction signing. However, the lock only covers `signTransaction`. In ethers v6, the actual flow in `AbstractSigner.sendTransaction` is:

1. `populateTransaction(tx)` - calls `getNonce("pending")` which calls `provider.getTransactionCount()` - **NOT locked**
2. `signTransaction(tx)` - **locked by SequentialSigner**
3. `provider.broadcastTransaction(signed)` - **NOT locked**

When multiple swap lockups are triggered concurrently, two or more calls can execute step 1 simultaneously, both receiving the same nonce from `getTransactionCount`. By the time each reaches step 2, the nonce is already baked into the transaction request. The lock serializes signing but cannot fix the already-duplicated nonce. The second transaction to be broadcast gets rejected by the node with `nonce too low`.

The `InjectedProvider.getTransactionCount` implementation does check the `pendingEthereumTransactions` database table to account for in-flight transactions. However, the database record is only written in `broadcastTransaction` (step 3), which happens after the nonce has already been assigned. During the window between steps 1 and 3, concurrent callers see the same state and produce the same nonce.
