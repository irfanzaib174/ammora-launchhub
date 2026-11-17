# Ammora LaunchHub — upgraded starter

Community-built testnet launchpad for **GIWA Sepolia (chain ID 91342)** using `@ammora-protocol/sdk@0.3.9`.

## Improvements

- Correct GIWA Sepolia chain ID switch (`0x1652e`).
- Uses the SDK deployment catalog RPC rather than the old hard-coded RPC URL.
- Reads native ETH balance from the GIWA public RPC.
- Saves launch drafts and verified launch records in browser `localStorage`.
- Reads an enabled V4 Config using SDK `getAmmoraV4ConfigAtBlock`.
- Checks the selected chain and V4 core contract addresses.
- Builds the launch transaction using `buildCreateAmmoraV4Launch`.
- Simulates before asking the connected wallet to sign.
- Waits for 13 confirmations and reconciles Config hash, token code and curve code.
- Never stores private keys.

## Install and build

Requires Node.js 22 or 24.

```bash
npm install
npm run build
npm run dev
```

## Important deployment and Config limitations

This is a **testnet starter**, not an official Ammora product.

- The app currently uses an existing Config ID supplied in the UI (default `6`, the documented example template). The Config's immutable fee claimer is not automatically changed to the connected wallet.
- To operate your own launchpad economics and fee recipients, create and review a new immutable Config from a suitable template using the official SDK workflow before issuing tokens. This frontend does not yet implement the full Config-authoring form.
- The frontend verifies the SDK catalog chain and V4 core addresses and contains the SDK launch transaction/simulation/receipt flow, but **does not yet perform the full SDK runtime-bytecode pin verification** described by Ammora's deployment guide. For safety, the Issue Token button is intentionally locked until the official GIWA auto-route runtime-pin snapshot is added and verified. Do not use real funds or production mainnet.
- The metadata URI is a placeholder URL. Before public token issuance, replace it with a real, immutable token metadata URI (for example, a properly hosted JSON file).
- Browser localStorage is device/browser-specific. It is not cloud backup. Clearing browser data removes saved drafts; deployed tokens remain on-chain and can be recovered from transaction receipts.

## Official references

- https://docs.ammora.org/guides/sdk-quickstart
- https://docs.ammora.org/guides/launchpad
- https://docs.ammora.org/examples
