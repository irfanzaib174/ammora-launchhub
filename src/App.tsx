import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createPublicClient, createWalletClient, custom, defineChain, formatEther, http, parseEther,
  type Address, type Hex
} from "viem";
import { sepolia } from "viem/chains";
import { publicActionsL1, publicActionsL2, walletActionsL1, getL2TransactionHashes } from "viem/op-stack";
import {
  AmmoraDataApiClient,
  buildCreateAmmoraV4Launch,
  getAmmoraV4ConfigAtBlock,
  giwaSepoliaAutoRouteDeployment,
  parseAmmoraV4LaunchCreatedReceipt,
  verifyAmmoraV4CoreAtBlock,
  verifyAmmoraDeploymentRuntime,
  resolveAmmoraFinalizedHead,
  giwaSepoliaAutoRoute
} from "@ammora-protocol/sdk";
import runtimePinSnapshot from "./runtime-pins.giwa.json";
import "./style.css";

const CHAIN_ID = 91342;
const CHAIN_HEX = "0x1652e";
const DEPLOYMENT = giwaSepoliaAutoRouteDeployment;
const RPC_URL = DEPLOYMENT.chain.rpcUrls[0];
const chain = defineChain({
  id: CHAIN_ID,
  name: "GIWA Sepolia",
  nativeCurrency: DEPLOYMENT.chain.nativeCurrency,
  rpcUrls: { default: { http: [RPC_URL] } },
  contracts: {
    portal: {
      [sepolia.id]: { address: "0x956962C34687A954e611A83619ABaA37Ce6bC78A" }
    }
  }
});
const publicClient = createPublicClient({ chain, transport: http(RPC_URL, { retryCount: 1 }) });
const bridgeL1PublicClient = createPublicClient({ chain: sepolia, transport: http() }).extend(publicActionsL1());
const bridgeL2PublicClient = publicClient.extend(publicActionsL2());
const STORAGE_KEY = "ammora-launchhub:v2";
const DATA_API_URL = "https://ammora-giwa-sepolia-data.fly.dev";
declare global {
  interface Window { ethereum?: any }
}
type LaunchItem = {
  id: string;
  name: string;
  symbol: string;
  description: string;
  metadataURI: string;
  imageDataUrl?: string;
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
function liveField(item: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number") return String(value);
  }
  return "";
}
function toPublicUrl(value: string) {
  const uri = value.trim();
  if (uri.startsWith("ipfs://")) return "https://ipfs.io/ipfs/" + uri.slice(7).replace(/^ipfs\//, "");
  if (uri.startsWith("ar://")) return "https://arweave.net/" + uri.slice(5);
  return uri;
}
async function readTokenImage(metadataUri: string): Promise<string> {
  const response = await fetch(toPublicUrl(metadataUri), { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Metadata request failed");
  const metadata: unknown = await response.json();
  if (!metadata || typeof metadata !== "object") throw new Error("Invalid metadata JSON");
  const record = metadata as Record<string, unknown>;
  const image = [record.image, record.image_url, record.imageUrl, record.logo, record.logoURI]
    .find((value): value is string => typeof value === "string" && Boolean(value.trim()));
  return image ? toPublicUrl(image) : "";
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
  const [logoPreview, setLogoPreview] = useState("");
  const [configId, setConfigId] = useState("");
  const [config, setConfig] = useState<ConfigSummary | null>(null);
  const [configBusy, setConfigBusy] = useState(false);
  const [tokens, setTokens] = useState<LaunchItem[]>([]);
  const [notice, setNotice] = useState("Connect your wallet to begin.");
  const [busy, setBusy] = useState(false);
  const [configError, setConfigError] = useState("");
  const [deploymentStatus, setDeploymentStatus] = useState("SDK catalog loaded · GIWA Sepolia auto-route V4");
  const [runtimeVerified, setRuntimeVerified] = useState(false);
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [runtimeError, setRuntimeError] = useState("");
  const [liveLaunches, setLiveLaunches] = useState<Record<string, unknown>[]>([]);
  const [liveBusy, setLiveBusy] = useState(false);
  const [liveError, setLiveError] = useState("");
  const [liveLoaded, setLiveLoaded] = useState(false);
  const [tokenImages, setTokenImages] = useState<Record<string, string>>({});
  const [bridgeAmount, setBridgeAmount] = useState("0.01");
  const [bridgeBalance, setBridgeBalance] = useState("—");
  const [bridgeStatus, setBridgeStatus] = useState("Connect Rabby to check your Sepolia ETH balance.");
  const [bridgeBusy, setBridgeBusy] = useState(false);
  const [bridgeTx, setBridgeTx] = useState("");
  const [bridgeL2Tx, setBridgeL2Tx] = useState("");

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

  useEffect(() => {
    let cancelled = false;
    const sources = [
      ...tokens.map(item => item.metadataURI),
      ...liveLaunches.map(item => liveField(item, ["metadataURI", "metadataUri", "tokenURI", "tokenUri", "uri"]))
    ].filter((value): value is string => Boolean(value && /^(https:\/\/|ipfs:\/\/|ar:\/\/)/i.test(value)));
    const unique = [...new Set(sources)];
    void Promise.all(unique.map(async uri => {
      try { return [uri, await readTokenImage(uri)] as const; }
      catch { return [uri, ""] as const; }
    })).then(entries => {
      if (!cancelled) setTokenImages(current => ({ ...current, ...Object.fromEntries(entries.filter(([, image]) => image)) }));
    });
    return () => { cancelled = true; };
  }, [tokens, liveLaunches]);

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

  const refreshBridgeBalance = useCallback(async () => {
    if (!account) { setBridgeBalance("—"); return; }
    try {
      const value = await bridgeL1PublicClient.getBalance({ address: account });
      setBridgeBalance(formatEther(value) + " ETH");
    } catch {
      setBridgeBalance("Unavailable");
    }
  }, [account]);

  useEffect(() => { void refreshBridgeBalance(); }, [refreshBridgeBalance]);

  const bridgeETH = async () => {
    if (!window.ethereum || !account) {
      setBridgeStatus("Connect Rabby wallet first.");
      return;
    }
    if (!/^\d+(\.\d{1,18})?$/.test(bridgeAmount) || Number(bridgeAmount) <= 0) {
      setBridgeStatus("Enter a valid ETH amount greater than zero.");
      return;
    }
    if (bridgeBusy) return;
    setBridgeBusy(true);
    setBridgeTx("");
    setBridgeL2Tx("");
    try {
      const amount = parseEther(bridgeAmount);
      const balanceOnL1 = await bridgeL1PublicClient.getBalance({ address: account });
      const gasReserve = parseEther("0.002");
      if (balanceOnL1 <= amount || balanceOnL1 - amount < gasReserve) {
        throw new Error("Keep at least 0.002 Sepolia ETH for Ethereum network gas. Reduce the bridge amount.");
      }
      setBridgeStatus("Switching Rabby to Ethereum Sepolia…");
      const currentChain = Number.parseInt(await window.ethereum.request({ method: "eth_chainId" }), 16);
      if (currentChain !== 11155111) {
        await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xaa36a7" }] });
      }
      setWalletChain(11155111);
      setBridgeStatus("Preparing the official GIWA deposit transaction…");
      const depositArgs = await bridgeL2PublicClient.buildDepositTransaction({ mint: amount, to: account });
      const walletClient = createWalletClient({ account, chain: sepolia, transport: custom(window.ethereum) }).extend(walletActionsL1());
      setBridgeStatus("Please review and confirm the Sepolia deposit in Rabby.");
      const depositHash = await walletClient.depositTransaction(depositArgs);
      setBridgeTx(depositHash);
      setBridgeStatus("Sepolia transaction submitted. Waiting for L1 confirmation…");
      const receipt = await bridgeL1PublicClient.waitForTransactionReceipt({ hash: depositHash });
      const [l2Hash] = getL2TransactionHashes(receipt);
      if (!l2Hash) throw new Error("L1 deposit confirmed, but the GIWA transaction hash could not be derived. Keep the L1 transaction hash for tracking.");
      setBridgeL2Tx(l2Hash);
      setBridgeStatus("L1 confirmed. Waiting for GIWA Sepolia to credit your ETH (usually around 1–3 minutes)…");
      await publicClient.waitForTransactionReceipt({ hash: l2Hash, timeout: 300000, pollingInterval: 3000 });
      setBridgeStatus("Bridge complete! Your ETH is now on GIWA Sepolia.");
      await refreshBridgeBalance();
      try {
        await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_HEX }] });
        setWalletChain(CHAIN_ID);
      } catch {
        setBridgeStatus("Bridge complete! Switch Rabby back to GIWA Sepolia (Chain ID 91342) to use LaunchHub.");
      }
    } catch (error) {
      setBridgeStatus(getError(error));
    } finally {
      setBridgeBusy(false);
    }
  };

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

  const disconnect = async () => {
    if (window.ethereum) {
      try {
        await window.ethereum.request({
          method: "wallet_revokePermissions",
          params: [{ eth_accounts: {} }]
        });
      } catch {
        // Some wallets do not expose permission revocation; clear this app's connection state.
      }
    }
    setAccount("");
    setWalletChain(null);
    setBalance("—");
    setBalanceError("");
    setNotice("Wallet disconnected from this app.");
  };

  const verifyDeployment = async () => {
    setRuntimeBusy(true); setRuntimeVerified(false); setRuntimeError("");
    try {
      const snapshot = runtimePinSnapshot as unknown as { schemaVersion: number; chainId: string; deployments: Record<string, { slot: string; sourceCommit: string; runtimeCodeHashes: Record<string, Hex> }> };
      const profile = snapshot.deployments["auto-route"];
      if (snapshot.schemaVersion !== 1 || snapshot.chainId !== String(DEPLOYMENT.chain.id) || !profile || profile.slot !== DEPLOYMENT.slot || profile.sourceCommit !== DEPLOYMENT.sourceCommit) throw new Error("Reviewed runtime-pin snapshot does not match this SDK deployment.");
      const blockNumber = await resolveAmmoraFinalizedHead([publicClient], giwaSepoliaAutoRoute.finality);
      const result = await verifyAmmoraDeploymentRuntime(publicClient, DEPLOYMENT, blockNumber, profile.runtimeCodeHashes);
      await verifyAmmoraV4CoreAtBlock(publicClient, { configRegistry: DEPLOYMENT.contracts.launch.configRegistry, launchFactory: DEPLOYMENT.contracts.launch.factory, graduationAdapter: DEPLOYMENT.contracts.launch.graduationAdapter, feePolicy: DEPLOYMENT.contracts.launch.feePolicy }, blockNumber);
      setRuntimeVerified(true); setDeploymentStatus("Runtime verified · " + result.contracts.length + " contracts · finalized block " + blockNumber);
      setNotice("Official GIWA runtime pins and V4 core contracts verified at a finalized block."); return blockNumber;
    } catch (error) { setRuntimeVerified(false); setRuntimeError(getError(error)); throw error; }
    finally { setRuntimeBusy(false); }
  };

  const checkConfig = async () => {
    setConfigBusy(true);
    setConfig(null);
    setConfigError("");
    try {
      const id = configId.trim();
      if (!/^\d+$/.test(id)) throw new Error("Enter a numeric Config ID.");
      if (id === "6") throw new Error("Config #6 is quarantined for new launches. Do not use it. Obtain a separately reviewed and qualified Config ID from Ammora first.");
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
      imageDataUrl: logoPreview,
      creator: account || "Wallet not connected",
      status: "Draft · not deployed",
      createdAt: Date.now()
    };
    setTokens(current => [item, ...current]);
    setName("");
    setSymbol("");
    setDescription("");
    setMetadataURI("");
    setLogoPreview("");
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
    if (!runtimeVerified) { setNotice("Verify the official GIWA runtime pins before issuing."); return; }
    if (configId.trim() === "6") { setNotice("Config #6 is quarantined for new launches. Use a separately reviewed and qualified Config ID."); return; }
    if (!config || !config.enabled || config.id !== configId.trim()) {
      setNotice("Read and verify an enabled Config before issuing.");
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const currentBlock = await resolveAmmoraFinalizedHead([publicClient], giwaSepoliaAutoRoute.finality);
      await verifyAmmoraDeploymentRuntime(publicClient, DEPLOYMENT, currentBlock, runtimePinSnapshot.deployments["auto-route"].runtimeCodeHashes as Record<string, Hex>);
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

  const loadLiveLaunches = async () => {
    setLiveBusy(true);
    setLiveError("");
    try {
      const data = new AmmoraDataApiClient(DATA_API_URL);
      const response: unknown = await data.getLaunches({ chainId: BigInt(CHAIN_ID) });
      let records: unknown[] = [];
      if (Array.isArray(response)) records = response;
      else if (response && typeof response === "object") {
        const object = response as Record<string, unknown>;
        for (const key of ["launches", "items", "results", "data"]) {
          if (Array.isArray(object[key])) { records = object[key] as unknown[]; break; }
        }
      }
      setLiveLaunches(records.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))));
      setLiveLoaded(true);
      if (records.length === 0) setLiveError("The Data API returned no indexed launches for GIWA Sepolia yet.");
    } catch (error) {
      setLiveError(getError(error));
      setLiveLoaded(true);
    } finally {
      setLiveBusy(false);
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
        <nav><a href="#swap">Ammora Swap</a><a href="#bridge">Bridge ETH</a><a href="#launch">Launch</a><a href="#live-launches">Live launches</a><a href="#markets">My launches</a><a href="https://docs.ammora.org/guides/launchpad" target="_blank" rel="noreferrer">SDK docs ↗</a></nav>
        <div className="wallet-group"><button className="wallet" onClick={connect}>{account ? short(account) : "Connect wallet"}</button>{account && <button className="wallet-disconnect" onClick={() => void disconnect()} title="Disconnect wallet">Disconnect</button>}</div>
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

        <section className="workspace" id="swap">
          <div className="section-head"><div><div className="eyebrow">01 / TOKEN EXCHANGE</div><h2>Ammora Swap</h2><p>Open the official Ammora Season 2 swap to exchange GIWA Sepolia ETH for $tAMM.</p></div><span className="status">● GIWA SEPOLIA</span></div>
          <div className="swap-layout">
            <div className="panel swap-panel swap-embed-panel">
              <div className="swap-embed-heading"><div><small>OFFICIAL AMMORA SEASON 2</small><strong>Buy / Sell $tAMM</strong></div><span className="status">● GIWA SEPOLIA</span></div>
              <div className="swap-embed-frame">
                <iframe
                  title="Official Ammora Season 2 swap"
                  src="https://ammora.org/waitlist#swap"
                  loading="lazy"
                  allow="clipboard-read; clipboard-write; publickey-credentials-get; publickey-credentials-create"
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
              <div className="swap-wallet-note"><span className="swap-indicator"/><p>Official Ammora app is embedded here. Connect Rabby inside the embedded page and confirm that it shows GIWA Sepolia (Chain ID 91342) before swapping.</p></div>
              <a className="primary swap-open" href="https://ammora.org/waitlist#swap" target="_blank" rel="noreferrer">Open Ammora in a new tab <span>↗</span></a>
              <p className="swap-footnote">Swap quotes, token routing, slippage and wallet approvals are handled by Ammora’s official app. If the embedded page is blocked by browser security settings, use the new-tab link above. Never share your seed phrase or private key.</p>
            </div>
            <aside className="swap-aside"><div className="eyebrow">BEFORE YOU SWAP</div><h3>Quick checklist</h3><ol><li><b>Connect Rabby</b><span>Choose your wallet on Ammora’s official page.</span></li><li><b>Select GIWA Sepolia</b><span>Network ID must be 91342.</span></li><li><b>Open Swap</b><span>Choose ETH as From and $tAMM as To.</span></li><li><b>Review the quote</b><span>Check output, slippage and gas in Rabby before confirming.</span></li></ol><p className="swap-warning">$tAMM is a GIWA Sepolia testnet token. Ammora currently labels conversion to mainnet $AMM as planned—not available yet.</p><a href="https://docs.ammora.org/" target="_blank" rel="noreferrer">Ammora official documentation ↗</a></aside>
          </div>
        </section>

        <section className="workspace bridge-workspace" id="bridge">
          <div className="section-head"><div><div className="eyebrow">02 / CROSS-CHAIN</div><h2>Bridge ETH to GIWA</h2><p>Move Sepolia ETH to GIWA Sepolia using GIWA’s canonical OP Stack deposit flow.</p></div><span className="status">● NATIVE BRIDGE</span></div>
          <div className="bridge-layout">
            <div className="panel bridge-panel">
              <div className="bridge-route"><div className="bridge-network"><span className="network-mark">Ξ</span><span><small>FROM NETWORK</small><strong>Ethereum Sepolia</strong><em>Chain ID 11155111</em></span></div><div className="bridge-arrow">→</div><div className="bridge-network"><span className="network-mark giwa-mark">G</span><span><small>TO NETWORK</small><strong>GIWA Sepolia</strong><em>Chain ID 91342</em></span></div></div>
              <label className="bridge-amount-label">AMOUNT TO BRIDGE<input value={bridgeAmount} onChange={event => setBridgeAmount(event.target.value)} inputMode="decimal" placeholder="0.01" disabled={bridgeBusy}/><small>Available on Sepolia: <b>{bridgeBalance}</b></small></label>
              <div className="bridge-presets"><button type="button" onClick={() => setBridgeAmount("0.005")} disabled={bridgeBusy}>0.005 ETH</button><button type="button" onClick={() => setBridgeAmount("0.01")} disabled={bridgeBusy}>0.01 ETH</button><button type="button" onClick={() => setBridgeAmount("0.05")} disabled={bridgeBusy}>0.05 ETH</button><button type="button" onClick={() => void refreshBridgeBalance()} disabled={bridgeBusy}>Refresh balance</button></div>
              <button className="primary bridge-submit" onClick={() => void bridgeETH()} disabled={bridgeBusy || !account}>{bridgeBusy ? "Bridging…" : "Bridge ETH to GIWA"} <span>↗</span></button>
              <div className="bridge-status"><span className={bridgeBusy ? "bridge-pulse" : "bridge-dot"}/><p>{bridgeStatus}</p></div>
              {bridgeTx && <p className="bridge-hash">Sepolia transaction: <a href={`https://sepolia.etherscan.io/tx/${bridgeTx}`} target="_blank" rel="noreferrer">{short(bridgeTx)} · View on Etherscan ↗</a></p>}
              {bridgeL2Tx && <p className="bridge-hash">GIWA transaction: <a href={`https://sepolia-explorer.giwa.io/tx/${bridgeL2Tx}`} target="_blank" rel="noreferrer">{short(bridgeL2Tx)} · View on GIWA Explorer ↗</a></p>}
            </div>
            <aside className="bridge-aside"><div className="eyebrow">HOW IT WORKS</div><h3>Your ETH, across networks.</h3><ol><li><b>Connect Rabby</b><span>Use the same wallet address on both networks.</span></li><li><b>Enter an amount</b><span>Keep extra Sepolia ETH for the L1 gas fee.</span></li><li><b>Confirm in Rabby</b><span>The deposit is sent through GIWA’s official OP Stack bridge flow.</span></li><li><b>Receive on GIWA</b><span>Deposits usually arrive in around 1–3 minutes.</span></li></ol><div className="bridge-safety-note"><span className="bridge-safety-icon">!</span><div><strong>Bridge safety notice</strong><p>This bridge transfers ETH from Sepolia to GIWA Sepolia. It does not convert ETH into AMM tokens.</p><small>Never share your seed phrase or private key. Always test with a small amount first.</small></div></div><a href="https://sepolia-bridge.giwa.io/" target="_blank" rel="noreferrer">Open official GIWA bridge ↗</a></aside>
          </div>
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
              <div className="logo-upload-row">
                <div className="logo-upload-preview">{logoPreview ? <img src={logoPreview} alt="Token logo preview" /> : <span>+</span>}</div>
                <div className="logo-upload-controls">
                  <label className="logo-upload-label">Token logo <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    if (!file.type.startsWith("image/")) { setNotice("Choose a valid image file."); event.target.value = ""; return; }
                    if (file.size > 2 * 1024 * 1024) { setNotice("Token logo must be 2 MB or smaller."); event.target.value = ""; return; }
                    const reader = new FileReader();
                    reader.onload = () => setLogoPreview(typeof reader.result === "string" ? reader.result : "");
                    reader.onerror = () => setNotice("Could not read this image. Try another file.");
                    reader.readAsDataURL(file);
                  }} /></label>
                  <small className="field-help">Optional · PNG, JPG, WEBP or GIF · max 2 MB</small>
                  {logoPreview && <button type="button" className="logo-remove" onClick={() => setLogoPreview("")}>Remove image</button>}
                </div>
              </div>
              <label>Token metadata JSON URI<input value={metadataURI} onChange={event => setMetadataURI(event.target.value)} placeholder="ipfs://... or https://your-host/metadata.json" required /><small className="field-help">The public JSON must contain an image field, for example: {'{"name":"My Token","image":"ipfs://.../logo.png"}'}.</small></label>
              <div className="form-bottom"><span>Drafts are saved in this browser. Saving a draft does not deploy a token.</span><button className="primary" type="submit">Save launch draft <span>→</span></button></div>
            </form>
          </div>
        </section>

        <section className="workspace">
          <div className="section-head"><div><div className="eyebrow">02 / CONFIG REVIEW</div><h2>Ammora launch Config</h2><p>Read an enabled GIWA Sepolia Config before token issuance.</p></div><span className="count">CHAIN {CHAIN_ID}</span></div>
          <div className="panel config-panel">
            <div className="config-top"><strong>Deployment security check</strong><span className={runtimeVerified ? "good" : "draft"}>{runtimeVerified ? "VERIFIED" : "NOT VERIFIED"}</span></div>
            <p className="lead">{deploymentStatus}</p>
            <button className="secondary-button" disabled={runtimeBusy} onClick={() => void verifyDeployment().catch(error => setNotice(getError(error)))}>{runtimeBusy ? "Verifying official runtime pins…" : runtimeVerified ? "Re-verify deployment" : "Verify official deployment"}</button>
            {runtimeError && <p className="error">{runtimeError}</p>}
            <label>Config ID<input value={configId} onChange={event => { setConfigId(event.target.value); setConfig(null); setConfigError(""); }} inputMode="numeric" placeholder="Enter qualified Config ID (not 6)"/></label>
            <button className="secondary-button" disabled={configBusy} onClick={checkConfig}>{configBusy ? "Checking…" : "Read & verify Config"}</button>
            {configError && <p className="error">{configError}</p>}
            {config && <div className="config-result">
              <div className="config-top"><strong>Config #{config.id}</strong><span className={config.enabled ? "good" : "error"}>{config.enabled ? "Enabled" : "Disabled"}</span></div>
              <p><small>Config hash</small><code>{config.configHash}</code></p>
              <p><small>Config owner</small><code>{config.owner}</code></p>
              <p><small>Fee claimer in this Config</small><code>{config.feeClaimer}</code></p>
              <p><small>Token decimals</small><b>{config.tokenDecimals}</b></p>
              <p><small>Pool creation fee</small><b>{config.poolCreationFee} wei</b></p>
              {config.id === "6" && <p className="warning">Config #6 is quarantined for new launches. Do not use it.</p>}
            </div>}
          </div>
        </section>

        <section className="workspace" id="live-launches">
          <div className="section-head"><div><div className="eyebrow">03 / LIVE ECOSYSTEM</div><h2>Live GIWA launches</h2><p>Discover indexed launches from Ammora's official GIWA Sepolia Data API.</p></div><button className="secondary-button" disabled={liveBusy} onClick={() => void loadLiveLaunches()}>{liveBusy ? "Loading launches…" : liveLoaded ? "Refresh launches" : "Load live launches"}</button></div>
          {liveError && <div className="panel"><p className={liveLaunches.length ? "draft" : "error"}>{liveError}</p></div>}
          {liveLaunches.length > 0 && <div className="token-list">
            {liveLaunches.map((item, index) => {
              const title = liveField(item, ["name", "tokenName", "projectName"]) || "Indexed launch";
              const ticker = liveField(item, ["symbol", "tokenSymbol", "ticker"]);
              const address = liveField(item, ["tokenAddress", "token", "address"]);
              const creator = liveField(item, ["creator", "owner", "deployer"]);
              const created = liveField(item, ["createdAt", "timestamp", "blockNumber"]);
              return <div className="token" key={address || String(index)}>
                <div className="token-icon">{(() => { const uri = liveField(item, ["metadataURI", "metadataUri", "tokenURI", "tokenUri", "uri"]); const image = uri ? tokenImages[uri] : ""; return image ? <img src={image} alt={`${title} logo`} loading="lazy" /> : (ticker || title).slice(0, 1).toUpperCase(); })()}</div>
                <div className="token-info"><strong>{title} {ticker && <small>${ticker}</small>}</strong>
                  {address && <p><small>Token: </small><code>{address}</code></p>}
                  {creator && <p><small>Creator: </small><code>{creator}</code></p>}
                  {created && <p><small>Indexed data: </small><code>{created}</code></p>}
                </div>
                <span className="good">INDEXED</span>
              </div>;
            })}
          </div>}
          {!liveLoaded && <div className="empty"><div className="empty-icon">⌁</div><strong>Explore the live ecosystem</strong><p>Load launches to query the Ammora Data API. This is read-only and does not require a wallet transaction.</p></div>}
        </section>

        <section className="workspace" id="markets">
          <div className="section-head"><div><div className="eyebrow">04 / YOUR PROJECTS</div><h2>Launch workspace</h2><p>Saved locally and reconciled on-chain launches.</p></div><span className="count">{tokens.length.toString().padStart(2, "0")} ITEMS · {deployedCount} DEPLOYED</span></div>
          {tokens.length === 0 ? <div className="empty"><div className="empty-icon">◇</div><strong>No launches yet</strong><p>Your saved token drafts will appear here.</p></div> : <div className="token-list">
            {tokens.map(item => <div className="token" key={item.id}>
              <div className="token-icon">{item.imageDataUrl || tokenImages[item.metadataURI] ? <img src={item.imageDataUrl || tokenImages[item.metadataURI]} alt={`${item.name} logo`} loading="lazy" /> : item.symbol.slice(0, 1)}</div>
              <div className="token-info"><strong>{item.name} <small>${item.symbol}</small></strong><p>{item.description || "No description added"}</p><code>{item.creator}</code>
                {item.token && <p><small>Token: </small><code>{item.token}</code></p>}
                {item.curve && <p><small>Curve: </small><code>{item.curve}</code></p>}
                {item.txHash && <p><small>Tx: </small><a href={`https://sepolia-explorer.giwa.io/tx/${item.txHash}`} target="_blank" rel="noreferrer">View transaction ↗</a></p>}
              </div>
              <div className="token-actions"><span className={item.status === "Deployed" ? "good" : "draft"}>{item.status}</span>{item.status !== "Deployed" && <button disabled={busy || !walletReady || !config?.enabled || !runtimeVerified} onClick={() => issueToken(item)}>{busy ? "Working…" : runtimeVerified ? "Issue token" : "Verify deployment to unlock"}</button>}<button className="remove" onClick={() => removeDraft(item.id)}>Remove</button></div>
            </div>)}
          </div>}
        </section>

        <section className="notice">
          <div className="notice-icon">i</div>
          <div><strong>Transaction safety & important limits</strong>
            <p>The app uses the official SDK deployment catalog, discovers indexed launches through AmmoraDataApiClient, reads the selected Config, verifies the V4 core addresses, simulates the launch call, asks your wallet to sign, waits for 13 confirmations and checks the receipt, Config hash, token code and curve code. Never share your seed phrase or private key.</p>
            <p><b>Important:</b> Config #6 is quarantined for new launches and this app blocks it. Obtain a separately reviewed and qualified Config before issuing any token. This browser flow does not create or qualify Configs. Runtime-bytecode pin verification is available above. Run “Verify official deployment” first; token issuance stays locked until that check and an enabled Config review both pass.</p>
            <a href="https://docs.ammora.org/guides/launchpad" target="_blank" rel="noreferrer">Official launchpad guide ↗</a>
          </div>
        </section>
        <div className="toast">{notice}</div>
      </main>
      <footer><span>AMMORA LAUNCHHUB</span><span>Community-built interface · Not an official Ammora product</span><span>© 2026</span></footer>
    </div>
  );
}
