import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createPublicClient, createWalletClient, custom, defineChain, formatEther, http,
  type Address, type Hex
} from "viem";
import {
  buildCreateAmmoraV4Launch,
  getAmmoraV4ConfigAtBlock,
  giwaSepoliaAutoRouteDeployment,
  parseAmmoraV4LaunchCreatedReceipt,
  verifyAmmoraV4CoreAtBlock
} from "@ammora-protocol/sdk";
import "./style.css";

const CHAIN_ID = 91342;
const CHAIN_HEX = "0x1652e";
const DEPLOYMENT = giwaSepoliaAutoRouteDeployment;
const RPC_URL = DEPLOYMENT.chain.rpcUrls[0];
const RUNTIME_PIN_VERIFICATION_ENABLED = false; // Enable only after adding and verifying the official GIWA auto-route runtime-pin snapshot.
const chain = defineChain({
  id: CHAIN_ID,
  name: "GIWA Sepolia",
  nativeCurrency: DEPLOYMENT.chain.nativeCurrency,
  rpcUrls: { default: { http: [RPC_URL] } }
});
const publicClient = createPublicClient({ chain, transport: http(RPC_URL, { retryCount: 1 }) });
const STORAGE_KEY = "ammora-launchhub:v2";
declare global {
  interface Window { ethereum?: any }
}
type LaunchItem = {
  id: string;
  name: string;
  symbol: string;
  description: string;
  metadataURI: string;
  creator: string;
  status: "Draft · not deployed" | "Deployed";
  configId?: string;
  token?: string;
  curve?: string;
  txHash?: string;
  createdAt: number;
};
type ConfigSummary = {
  id: string;
  enabled: boolean;
  configHash: string;
  owner: string;
  feeClaimer: string;
  tokenDecimals: number;
  poolCreationFee: string;
};

function short(value: string) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "—";
}
function getError(error: unknown) {
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}

export default function App() {
  const [account, setAccount] = useState<Address | "">("");
  const [walletChain, setWalletChain] = useState<number | null>(null);
  const [balance, setBalance] = useState("—");
  const [balanceError, setBalanceError] = useState("");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [metadataURI, setMetadataURI] = useState("");
  const [configId, setConfigId] = useState("6");
  const [config, setConfig] = useState<ConfigSummary | null>(null);
  const [configBusy, setConfigBusy] = useState(false);
  const [tokens, setTokens] = useState<LaunchItem[]>([]);
  const [notice, setNotice] = useState("Connect your wallet to begin.");
  const [busy, setBusy] = useState(false);
  const [configError, setConfigError] = useState("");
  const [deploymentStatus, setDeploymentStatus] = useState("SDK catalog loaded · GIWA Sepolia auto-route V4");

  const walletReady = Boolean(account && walletChain === CHAIN_ID);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setTokens(parsed);
      }
    } catch {
      setNotice("Saved drafts could not be read from this browser.");
    }
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens)); }
    catch { setNotice("Browser storage is full; export your launch records before clearing browser data."); }
  }, [tokens]);

  const refreshWallet = useCallback(async () => {
    if (!window.ethereum) return;
    try {
      const accounts = await window.ethereum.request({ method: "eth_accounts" }) as string[];
      const chainHex = await window.ethereum.request({ method: "eth_chainId" }) as string;
      setAccount((accounts[0] as Address) || "");
      setWalletChain(Number.parseInt(chainHex, 16));
    } catch {
      setWalletChain(null);
    }
  }, []);

  useEffect(() => {
    void refreshWallet();
    if (!window.ethereum?.on) return;
    const onAccounts = (accounts: string[]) => setAccount((accounts[0] as Address) || "");
    const onChain = (hex: string) => setWalletChain(Number.parseInt(hex, 16));
    window.ethereum.on("accountsChanged", onAccounts);
    window.ethereum.on("chainChanged", onChain);
    return () => {
      window.ethereum?.removeListener?.("accountsChanged", onAccounts);
      window.ethereum?.removeListener?.("chainChanged", onChain);
    };
  }, [refreshWallet]);

  useEffect(() => {
    let cancelled = false;
    if (!account) { setBalance("—"); setBalanceError(""); return; }
    setBalance("Loading…");
    setBalanceError("");
    publicClient.getBalance({ address: account })
      .then(value => { if (!cancelled) setBalance(`${Number(formatEther(value)).toFixed(6)} ETH`); })
      .catch(error => {
        if (!cancelled) {
          setBalance("Unavailable");
          setBalanceError(getError(error));
        }
      });
    return () => { cancelled = true; };
  }, [account]);

  const connect = async () => {
    try {
      if (!window.ethereum) {
        setNotice("Install Rabby or MetaMask to connect your wallet.");
        return;
      }
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" }) as string[];
      if (!accounts[0]) throw new Error("No wallet account was returned.");
      setAccount(accounts[0] as Address);
      let currentChain = Number.parseInt(await window.ethereum.request({ method: "eth_chainId" }), 16);
      if (currentChain !== CHAIN_ID) {
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: CHAIN_HEX }]
          });
        } catch (switchError: any) {
          if (switchError?.code === 4902) {
            await window.ethereum.request({
              method: "wallet_addEthereumChain",
              params: [{
                chainId: CHAIN_HEX,
                chainName: "GIWA Sepolia",
                nativeCurrency: DEPLOYMENT.chain.nativeCurrency,
                rpcUrls: [RPC_URL],
                blockExplorerUrls: ["https://sepolia-explorer.giwa.io"]
              }]
            });
          } else {
            throw new Error("Please switch your wallet to GIWA Sepolia (Chain ID 91342).");
          }
        }
        currentChain = Number.parseInt(await window.ethereum.request({ method: "eth_chainId" }), 16);
      }
      setWalletChain(currentChain);
      if (currentChain !== CHAIN_ID) throw new Error("Wallet is not on GIWA Sepolia.");
      setNotice("Wallet connected on GIWA Sepolia.");
    } catch (error) {
      setNotice(getError(error));
    }
  };

  const checkConfig = async () => {
    setConfigBusy(true);
    setConfig(null);
    setConfigError("");
    try {
      const id = configId.trim();
      if (!/^\d+$/.test(id)) throw new Error("Enter a numeric Config ID.");
      const chainId = await publicClient.getChainId();
      if (chainId !== CHAIN_ID) throw new Error(`The selected RPC returned chain ${chainId}, not ${CHAIN_ID}.`);
      const blockNumber = await publicClient.getBlockNumber();
      const contracts = DEPLOYMENT.contracts.launch;
      await verifyAmmoraV4CoreAtBlock(publicClient, {
        configRegistry: contracts.configRegistry,
        launchFactory: contracts.factory,
        graduationAdapter: contracts.graduationAdapter,
        feePolicy: contracts.feePolicy
      }, blockNumber);
      const result = await getAmmoraV4ConfigAtBlock(
        publicClient, contracts.configRegistry, BigInt(id), blockNumber
      );
      const summary: ConfigSummary = {
        id,
        enabled: result.enabled,
        configHash: result.configHash,
        owner: result.identity.owner,
        feeClaimer: result.identity.feeClaimer,
        tokenDecimals: result.config.tokenDecimals,
        poolCreationFee: result.config.poolCreationFee.toString()
      };
      setConfig(summary);
      if (!result.enabled) throw new Error(`Config #${id} is disabled.`);
      setNotice(`Config #${id} read successfully. Review its owner and fee claimer before issuance.`);
    } catch (error) {
      setConfigError(getError(error));
      setNotice(`Config check failed: ${getError(error)}`);
    } finally {
      setConfigBusy(false);
    }
  };

  const addDraft = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !symbol.trim()) return;
    if (!/^[A-Za-z0-9]{2,10}$/.test(symbol.trim())) {
      setNotice("Token symbol must contain 2–10 letters or numbers.");
      return;
    }
    if (!/^(https:\/\/|ipfs:\/\/).+/i.test(metadataURI.trim())) {
      setNotice("Add a real HTTPS or IPFS metadata JSON URI before saving this launch.");
      return;
    }
    const item: LaunchItem = {
      id: crypto.randomUUID(),
      name: name.trim(),
      symbol: symbol.trim().toUpperCase(),
      description: description.trim(),
      metadataURI: metadataURI.trim(),
      creator: account || "Wallet not connected",
      status: "Draft · not deployed",
      createdAt: Date.now()
    };
    setTokens(current => [item, ...current]);
    setName("");
    setSymbol("");
    setDescription("");
    setMetadataURI("");
    setNotice("Draft saved in this browser. No blockchain transaction was sent.");
  };

  const issueToken = async (draft: LaunchItem) => {
    if (!window.ethereum || !account) {
      setNotice("Connect your wallet first.");
      return;
    }
    if (walletChain !== CHAIN_ID) {
      setNotice("Switch to GIWA Sepolia before issuing.");
      return;
    }
    if (!config || !config.enabled || config.id !== configId.trim()) {
      setNotice("Read and verify an enabled Config before issuing.");
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const currentBlock = await publicClient.getBlockNumber();
      const contracts = DEPLOYMENT.contracts.launch;
      await verifyAmmoraV4CoreAtBlock(publicClient, {
        configRegistry: contracts.configRegistry,
        launchFactory: contracts.factory,
        graduationAdapter: contracts.graduationAdapter,
        feePolicy: contracts.feePolicy
      }, currentBlock);

      const selected = await getAmmoraV4ConfigAtBlock(
        publicClient, contracts.configRegistry, BigInt(config.id), currentBlock
      );
      if (!selected.enabled) throw new Error("This Config is no longer enabled.");
      if (selected.configHash.toLowerCase() !== config.configHash.toLowerCase()) {
        throw new Error("Config changed since review. Read it again before signing.");
      }
      const transaction = buildCreateAmmoraV4Launch({
        name: draft.name,
        symbol: draft.symbol,
        metadataURI: draft.metadataURI,
        creatorMetadataURI: draft.metadataURI,
        tokenDecimals: selected.config.tokenDecimals
      }, BigInt(config.id), selected.config.poolCreationFee);

      const simulation = await publicClient.call({
        account,
        to: contracts.factory,
        data: transaction.data as Hex,
        value: transaction.value
      });
      if (!simulation) throw new Error("The launch simulation returned no result. Nothing was sent.");

      const walletClient = createWalletClient({
        account,
        chain,
        transport: custom(window.ethereum)
      });
      setNotice("Simulation passed. Review the transaction in your wallet.");
      const hash = await walletClient.sendTransaction({
        account,
        chain,
        to: contracts.factory,
        data: transaction.data as Hex,
        value: transaction.value
      });
      setNotice(`Transaction submitted: ${hash}. Waiting for confirmation…`);
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 13,
        pollingInterval: 6000,
        timeout: 180000
      });
      if (receipt.status !== "success") throw new Error(`Launch transaction reverted: ${hash}`);

      const created = parseAmmoraV4LaunchCreatedReceipt(receipt, contracts.factory);
      const confirmedConfig = await getAmmoraV4ConfigAtBlock(
        publicClient, contracts.configRegistry, BigInt(config.id), receipt.blockNumber
      );
      const [tokenCode, curveCode] = await Promise.all([
        publicClient.getCode({ address: created.token, blockNumber: receipt.blockNumber }),
        publicClient.getCode({ address: created.curve, blockNumber: receipt.blockNumber })
      ]);
      if (
        created.configId !== BigInt(config.id) ||
        created.configHash.toLowerCase() !== selected.configHash.toLowerCase() ||
        confirmedConfig.configHash.toLowerCase() !== selected.configHash.toLowerCase() ||
        !tokenCode || tokenCode === "0x" || !curveCode || curveCode === "0x"
      ) {
        throw new Error(`Receipt reconciliation failed. Save transaction hash for manual review: ${hash}`);
      }
      setTokens(current => current.map(item => item.id === draft.id ? {
        ...item,
        status: "Deployed",
        configId: created.configId.toString(),
        token: created.token,
        curve: created.curve,
        txHash: hash
      } : item));
      setNotice(`Token deployed and verified: ${created.token}`);
    } catch (error) {
      setNotice(getError(error));
    } finally {
      setBusy(false);
    }
  };

  const removeDraft = (id: string) => {
    setTokens(current => current.filter(item => item.id !== id));
    setNotice("Launch record removed from this browser only.");
  };

  const deployedCount = useMemo(() => tokens.filter(item => item.status === "Deployed").length, [tokens]);

  return (
    <div className="app">
      <header>
        <a className="brand" href="#"><span className="logo">A</span><span>AMMORA<span className="muted"> / LAUNCHHUB</span></span></a>
        <nav><a href="#launch">Launch</a><a href="#markets">My launches</a><a href="https://docs.ammora.org/guides/launchpad" target="_blank" rel="noreferrer">SDK docs ↗</a></nav>
        <button className="wallet" onClick={connect}>{account ? short(account) : "Connect wallet"}</button>
      </header>

      <main>
        <section className="hero">
          <div className="eyebrow"><i/> BUILT FOR GIWA SEPOLIA <span className="pill">SDK 0.3.9 · AUTO-ROUTE V4</span></div>
          <h1>Launch tokens.<br/><em>Build real markets.</em></h1>
          <p className="lead">A community-built launchpad for creating token drafts, reviewing Ammora Configs and issuing tokens on GIWA Sepolia with wallet-controlled signing.</p>
          <div className="hero-actions"><a className="primary" href="#launch">Create a launch <span>↗</span></a><a className="secondary" href="https://docs.ammora.org/guides/launchpad" target="_blank" rel="noreferrer">Explore Ammora SDK</a></div>
          <div className="hero-foot"><span>◎ GIWA Sepolia · Chain 91342</span><span>Wallet-controlled signing</span><span>No private keys stored</span></div>
        </section>

        <section className="stats">
          <div><small>NETWORK</small><strong>GIWA <b>TESTNET</b></strong></div>
          <div><small>SDK PACKAGE</small><strong>@ammora-protocol/sdk</strong></div>
          <div><small>SDK VERSION</small><strong>0.3.9</strong></div>
          <div><small>YOUR BALANCE</small><strong>{balance}</strong>{balanceError && <small className="error">{balanceError}</small>}</div>
        </section>

        <section className="workspace" id="launch">
          <div className="section-head"><div><div className="eyebrow">01 / TOKEN ISSUANCE</div><h2>Create your launch</h2><p>Save a draft with a real metadata URI, review a Config, then issue a token.</p></div><span className="status">● TESTNET MODE</span></div>
          <div className="panel">
            <form onSubmit={addDraft}>
              <div className="field-row">
                <label>Token name<input value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Ammora LaunchHub" required maxLength={32}/></label>
                <label>Token symbol<input value={symbol} onChange={event => setSymbol(event.target.value)} placeholder="e.g. AMORA" required maxLength={10}/></label>
              </div>
              <label>Description<textarea value={description} onChange={event => setDescription(event.target.value)} placeholder="What is your project about?" rows={3} maxLength={240}/></label>
              <label>Token metadata JSON URI<input value={metadataURI} onChange={event => setMetadataURI(event.target.value)} placeholder="ipfs://... or https://your-host/metadata.json" required /></label>
              <div className="form-bottom"><span>Drafts are saved in this browser. Saving a draft does not deploy a token.</span><button className="primary" type="submit">Save launch draft <span>→</span></button></div>
            </form>
          </div>
        </section>

        <section className="workspace">
          <div className="section-head"><div><div className="eyebrow">02 / CONFIG REVIEW</div><h2>Ammora launch Config</h2><p>Read an enabled GIWA Sepolia Config before token issuance.</p></div><span className="count">CHAIN {CHAIN_ID}</span></div>
          <div className="panel config-panel">
            <label>Config ID<input value={configId} onChange={event => { setConfigId(event.target.value); setConfig(null); setConfigError(""); }} inputMode="numeric" placeholder="e.g. 6"/></label>
            <button className="secondary-button" disabled={configBusy} onClick={checkConfig}>{configBusy ? "Checking…" : "Read & verify Config"}</button>
            {configError && <p className="error">{configError}</p>}
            {config && <div className="config-result">
              <div className="config-top"><strong>Config #{config.id}</strong><span className={config.enabled ? "good" : "error"}>{config.enabled ? "Enabled" : "Disabled"}</span></div>
              <p><small>Config hash</small><code>{config.configHash}</code></p>
              <p><small>Config owner</small><code>{config.owner}</code></p>
              <p><small>Fee claimer in this Config</small><code>{config.feeClaimer}</code></p>
              <p><small>Token decimals</small><b>{config.tokenDecimals}</b></p>
              <p><small>Pool creation fee</small><b>{config.poolCreationFee} wei</b></p>
              {config.id === "6" && <p className="warning">Config #6 is the documented example template. Its fee claimer is defined by that Config and may not be your wallet. Review it before using it.</p>}
            </div>}
          </div>
        </section>

        <section className="workspace" id="markets">
          <div className="section-head"><div><div className="eyebrow">03 / YOUR PROJECTS</div><h2>Launch workspace</h2><p>Saved locally and reconciled on-chain launches.</p></div><span className="count">{tokens.length.toString().padStart(2, "0")} ITEMS · {deployedCount} DEPLOYED</span></div>
          {tokens.length === 0 ? <div className="empty"><div className="empty-icon">◇</div><strong>No launches yet</strong><p>Your saved token drafts will appear here.</p></div> : <div className="token-list">
            {tokens.map(item => <div className="token" key={item.id}>
              <div className="token-icon">{item.symbol.slice(0, 1)}</div>
              <div className="token-info"><strong>{item.name} <small>${item.symbol}</small></strong><p>{item.description || "No description added"}</p><code>{item.creator}</code>
                {item.token && <p><small>Token: </small><code>{item.token}</code></p>}
                {item.curve && <p><small>Curve: </small><code>{item.curve}</code></p>}
                {item.txHash && <p><small>Tx: </small><a href={`https://sepolia-explorer.giwa.io/tx/${item.txHash}`} target="_blank" rel="noreferrer">View transaction ↗</a></p>}
              </div>
              <div className="token-actions"><span className={item.status === "Deployed" ? "good" : "draft"}>{item.status}</span>{item.status !== "Deployed" && <button disabled={busy || !walletReady || !config?.enabled || !RUNTIME_PIN_VERIFICATION_ENABLED} onClick={() => issueToken(item)}>{busy ? "Working…" : RUNTIME_PIN_VERIFICATION_ENABLED ? "Issue token" : "Issuance locked · security check pending"}</button>}<button className="remove" onClick={() => removeDraft(item.id)}>Remove</button></div>
            </div>)}
          </div>}
        </section>

        <section className="notice">
          <div className="notice-icon">i</div>
          <div><strong>Transaction safety & important limits</strong>
            <p>The app uses the official SDK deployment catalog, reads the selected Config, verifies the V4 core addresses, simulates the launch call, asks your wallet to sign, waits for 13 confirmations and checks the receipt, Config hash, token code and curve code. Never share your seed phrase or private key.</p>
            <p><b>Important:</b> Config #6 is a documented template, not a personal launchpad Config. Its fee recipient is fixed by that Config. For a platform-owned Config, first create a new immutable Config with reviewed recipients and economics. The browser flow here does not create a new Config. Runtime-bytecode pin verification is not yet included; the Issue Token control is intentionally locked until the official GIWA auto-route runtime-pin snapshot is added and verified.</p>
            <a href="https://docs.ammora.org/guides/launchpad" target="_blank" rel="noreferrer">Official launchpad guide ↗</a>
          </div>
        </section>
        <div className="toast">{notice}</div>
      </main>
      <footer><span>AMMORA LAUNCHHUB</span><span>Community-built interface · Not an official Ammora product</span><span>© 2026</span></footer>
    </div>
  );
}
