# Robinhood Chain – RWA Lending + Portfolio

DeFi app on Robinhood Chain Testnet with **RWA Lending** (deposit TSLA, borrow ETH), portfolio tracking, and on-chain feed.

## Features

1. **RWA Lending Vault** – Deposit TSLA as collateral, borrow ETH up to 50% LTV
2. **Portfolio** – View ETH + tokenized stocks (TSLA, AMZN, PLTR, NFLX, AMD)
3. **Send stocks** – Transfer tokens to any address
4. **On-chain feed** – Post messages with portfolio-backed identity

## Contracts

| Contract | Address |
|----------|---------|
| Guestbook | See `src/config/deployed.json` |
| RWALendingVault (V2) | Oracle + liquidation | See `src/config/deployed.json` |

## Quick start

### 1. Deploy (if needed)

```bash
npm run deploy          # Guestbook
npm run deploy:vault    # RWA Lending Vault V1 (basic)
npm run deploy:vault-v2 # RWA Lending Vault V2 (oracle + liquidation)
```

### 2. Fund the lending pool (owner only)

```bash
npm run fund:vault 0.01   # Fund with 0.01 ETH (or any amount)
```

### 3. Get testnet ETH

1. Add [Robinhood Chain Testnet](https://docs.robinhood.com/chain/add-network-to-wallet) to your wallet
2. Get testnet ETH from the [faucet](https://faucet.testnet.chain.robinhood.com)

### 4. Run the app

```bash
npm run dev
```

Open http://localhost:5173 — connect your wallet and post messages on-chain.

## Project structure

```
├── contracts/
│   └── Guestbook.sol      # On-chain guestbook contract
├── scripts/
│   └── deploy.ts         # Compile + deploy (solc + viem)
├── src/
│   ├── config/
│   │   ├── chains.ts     # Robinhood Chain config
│   │   ├── deployed.json # Contract address (written by deploy)
│   │   └── guestbookAbi.ts
│   └── App.tsx           # Guestbook UI
```

## Network

| Property | Value |
|----------|-------|
| Chain ID | 46630 |
| RPC | https://rpc.testnet.chain.robinhood.com |
| Explorer | https://explorer.testnet.chain.robinhood.com |
| Faucet | https://faucet.testnet.chain.robinhood.com |

## Vault V2: Oracle + Liquidation

V2 adds production-ready features:

- **Optional Chainlink oracle**: Pass `address(0)` for testnet (1:1 pricing). For mainnet, use TSLA/USD feed (e.g. Arbitrum: `0x3609baAa0a9b1f0FE4d6CC01884585d0e191C3E3`)
- **Health factor**: Position becomes liquidatable when collateral value drops below 125% of debt
- **Automated liquidation**: Anyone can liquidate underwater loans; liquidator receives 5% bonus
- **Configurable params**: `liquidationThreshold` (default 125), `liquidationBonus` (default 5)

## Docs

- [Robinhood Chain](https://docs.robinhood.com/chain)
- [Deploy Smart Contracts](https://docs.robinhood.com/chain/deploy-smart-contracts)
- [Chainlink Price Feeds](https://docs.chain.link/data-feeds/price-feeds)
