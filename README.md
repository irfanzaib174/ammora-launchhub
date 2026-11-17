# Ammora LaunchHub

A community-built launchpad starter for **GIWA Sepolia (chain ID 91342)** using the official `@ammora-protocol/sdk` dependency (pinned to 0.3.9).

## Run locally

Requirements: Node.js 22 or 24.

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
npm run preview
```

## Current functionality

- Responsive launchpad UI
- MetaMask / Rabby injected-wallet connection
- Prompts wallet to switch to GIWA Sepolia
- Reads connected wallet's native balance
- Saves token launch drafts locally in page state
- Links to official Ammora SDK docs

## Important: draft vs on-chain launch

This starter deliberately does **not** claim that a saved draft is a deployed token. The official launch flow requires a reviewed Config, live deployment verification, current chain state, SDK-generated transaction plans, simulation, explicit wallet approval, and receipt reconciliation. The official guide describes Config creation, token issuance, ALC curve trading, graduation and post-graduation liquidity.

Before enabling issuance:
1. Read https://docs.ammora.org/guides/launchpad and https://docs.ammora.org/guides/sdk-quickstart
2. Verify GIWA Sepolia deployment generation `auto-route`, chain ID 91342 and current runtime pins.
3. Implement Config selection/preview and obtain actual Config ID/hash from chain.
4. Use official SDK 0.3.9 launch builders/clients and a connected wallet; never put private keys in frontend code.
5. Simulate and display recipients, approvals, amounts and deadlines before the user signs.
6. Verify successful canonical receipts and store actual token/curve addresses.

No real funds or production mainnet are supported by this starter. The SDK is testnet software; review its current security and deployment status before use.

## Deploy to GitHub Pages

1. Create a GitHub repository and upload this project.
2. In repository Settings → Pages, choose GitHub Actions.
3. Add a workflow that installs dependencies, runs `npm run build`, and publishes `dist/`.
4. The Vite `base: './'` setting supports a project subpath.
