# Ammora LaunchHub

Community-built testnet launchpad for **GIWA Sepolia (chain ID 91342)** using `@ammora-protocol/sdk@0.3.9`.

## Features

- Rabby / injected-wallet connection and GIWA Sepolia network switching.
- Ammora ETH → $tAMM swap entry linking to the official Ammora swap experience.
- Native **Ethereum Sepolia → GIWA Sepolia ETH bridge** using GIWA's canonical OP Stack deposit flow.
- Sepolia balance lookup, amount presets, wallet confirmation, L1 and L2 transaction tracking.
- Token launch drafts with public metadata JSON URI and token logo display from metadata.
- Live GIWA Sepolia launches from Ammora's Data API.
- Ammora V4 Config review and runtime bytecode verification before token issuance.
- Launch simulation, wallet signing, confirmation and receipt reconciliation.
- No private keys or seed phrases are requested or stored.

## Bridge route

- From: Ethereum Sepolia, chain ID `11155111`
- To: GIWA Sepolia, chain ID `91342`
- Uses GIWA's documented OP Stack deposit flow via viem `^2.51.0`.
- The bridge transfers ETH between testnets. It does **not** swap ETH into $tAMM.
- Keep additional Sepolia ETH for L1 gas and test with a small amount first.
- Official bridge fallback: https://sepolia-bridge.giwa.io/

## Launch safety

- Config #6 is quarantined for new launches and is blocked by the UI. Do not use it.
- A separately reviewed and qualified Config ID must be obtained from Ammora before issuing.
- The app does not create or qualify Configs.
- Runtime pin verification and enabled Config review are required before issuance.
- This is a community-built testnet interface, not an official Ammora product. Do not use real funds or production mainnet.
- Token metadata must be hosted at a public HTTPS or IPFS URI. The JSON should include an `image` field for the token logo.

## Install and build

Requires Node.js 22 or 24.

```bash
npm install
npm run build
npm run dev
```

## Official references

- https://docs.giwa.io/giwa-chain/en/get-started/bridging/eth
- https://docs.ammora.org/guides/launchpad
- https://docs.ammora.org/guides/sdk-quickstart
