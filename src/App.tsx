import { useState, useEffect, useRef } from 'react'
import {
  useAccount,
  useBalance,
  useConnect,
  useDisconnect,
  useSwitchChain,
  useReadContract,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi'
import { formatUnits, parseUnits } from 'viem'
import { erc20Abi } from 'viem'
import {
  robinhoodChain,
  ROBINHOOD_NETWORK_PARAMS,
  FAUCET_URL,
  EXPLORER_URL,
} from './config/chains'
import { STOCK_TOKENS } from './config/tokens'
import { guestbookAbi } from './config/guestbookAbi'
import { vaultAbi } from './config/vaultAbi'
import deployed from './config/deployed.json'

const VAULT_V2 = deployed.vaultVersion === 2
import './App.css'

const GUESTBOOK_ADDRESS = (deployed.guestbookAddress || '') as `0x${string}`
const VAULT_ADDRESS = (deployed.vaultAddress || '') as `0x${string}`
const TSLA_ADDRESS = STOCK_TOKENS.find((t) => t.symbol === 'TSLA')!.address

function AuthorPortfolio({ address }: { address: `0x${string}` }) {
  const { data: ethBal } = useBalance({ address })
  const { data: stockBalances } = useReadContracts({
    contracts: STOCK_TOKENS.map((t) => ({
      address: t.address,
      abi: erc20Abi,
      functionName: 'balanceOf' as const,
      args: [address],
    })),
  })
  const hasEth = ethBal && ethBal.value > 0n
  const hasStocks = stockBalances?.some((r) => r.result && r.result > 0n)
  if (!hasEth && !hasStocks) return null
  return (
    <div className="author-portfolio">
      {hasEth && <span>{(Number(ethBal!.value) / 1e18).toFixed(2)} ETH</span>}
      {STOCK_TOKENS.map((t, i) => {
        const bal = stockBalances?.[i]?.result as bigint | undefined
        if (!bal || bal === 0n) return null
        const n = parseFloat(formatUnits(bal, 18))
        return (
          <span key={t.symbol}>{(n >= 1 ? n.toFixed(0) : n.toFixed(2))} {t.symbol}</span>
        )
      })}
    </div>
  )
}

function MessageItem({ id }: { id: number }) {
  const { data } = useReadContract({
    address: GUESTBOOK_ADDRESS || undefined,
    abi: guestbookAbi,
    functionName: 'getMessage',
    args: [BigInt(id)],
  })
  if (!data) return null
  const [author, content, timestamp] = data
  const date = new Date(Number(timestamp) * 1000).toLocaleString()
  return (
    <div className="message-item">
      <p className="message-content">{content}</p>
      <div className="message-meta">
        <span>{author.slice(0, 10)}…{author.slice(-6)} · {date}</span>
        <AuthorPortfolio address={author} />
      </div>
    </div>
  )
}

function TokenBalanceRow({ address, symbol }: { address: `0x${string}`; symbol: string }) {
  const { address: userAddress } = useAccount()
  const { data } = useReadContract({
    address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: userAddress ? [userAddress] : undefined,
  })
  const n = data ? parseFloat(formatUnits(data, 18)) : 0
  return (
    <div className="token-row">
      <span className="token-symbol">{symbol}</span>
      <span className="token-balance">{n >= 0.0001 ? (n >= 1 ? n.toFixed(2) : n.toFixed(4)) : '0'}</span>
    </div>
  )
}

function LendingVaultCard() {
  const { address } = useAccount()
  const { data: poolBal } = useReadContract({
    address: VAULT_ADDRESS || undefined,
    abi: vaultAbi,
    functionName: 'poolBalance',
  })
  const { data: collateral } = useReadContract({
    address: VAULT_ADDRESS || undefined,
    abi: vaultAbi,
    functionName: 'collateralBalances',
    args: address ? [address] : undefined,
  })
  const { data: loanDetails } = useReadContract({
    address: VAULT_ADDRESS || undefined,
    abi: vaultAbi,
    functionName: 'getLoanDetails',
    args: address ? [address] : undefined,
  })
  const { data: maxBorrow } = useReadContract({
    address: VAULT_ADDRESS || undefined,
    abi: vaultAbi,
    functionName: 'getMaxBorrow',
    args: address ? [address] : undefined,
  })
  const { data: healthFactor } = useReadContract({
    address: VAULT_ADDRESS && VAULT_V2 ? VAULT_ADDRESS : undefined,
    abi: vaultAbi,
    functionName: 'getHealthFactor' as never,
    args: address ? [address] : undefined,
  })
  const { data: vaultOwner } = useReadContract({
    address: VAULT_ADDRESS || undefined,
    abi: vaultAbi,
    functionName: 'owner' as never,
  })
  const { data: tslaAllowance } = useReadContract({
    address: TSLA_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && VAULT_ADDRESS ? [address, VAULT_ADDRESS] : undefined,
  })
  const [depositAmt, setDepositAmt] = useState('')
  const [borrowAmt, setBorrowAmt] = useState('')
  const [repayAmt, setRepayAmt] = useState('')
  const [withdrawAmt, setWithdrawAmt] = useState('')
  const [fundAmt, setFundAmt] = useState('')
  const { writeContract, isPending, error, data: writeTxHash } = useWriteContract()
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash: writeTxHash })

  const coll = collateral !== undefined ? Number(collateral) : 0
  const loan = loanDetails ? Number(loanDetails[0]) : 0
  const hasLoan = loanDetails?.[2] === true
  const max = maxBorrow !== undefined ? Number(maxBorrow) : 0
  const needsApproval = depositAmt && parseFloat(depositAmt) > 0 && tslaAllowance !== undefined && parseUnits(depositAmt, 18) > tslaAllowance

  const handleApprove = () => {
    if (!depositAmt || parseFloat(depositAmt) <= 0) return
    writeContract({
      address: TSLA_ADDRESS,
      abi: erc20Abi,
      functionName: 'approve',
      args: [VAULT_ADDRESS, parseUnits(depositAmt, 18)],
    })
  }
  const handleDeposit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!depositAmt || parseFloat(depositAmt) <= 0) return
    writeContract({
      address: VAULT_ADDRESS,
      abi: vaultAbi,
      functionName: 'depositCollateral',
      args: [parseUnits(depositAmt, 18)],
    })
    setDepositAmt('')
  }
  const handleBorrow = (e: React.FormEvent) => {
    e.preventDefault()
    if (!borrowAmt || parseFloat(borrowAmt) <= 0) return
    writeContract({
      address: VAULT_ADDRESS,
      abi: vaultAbi,
      functionName: 'takeLoan',
      args: [parseUnits(borrowAmt, 18)],
    })
    setBorrowAmt('')
  }
  const handleRepay = (e: React.FormEvent) => {
    e.preventDefault()
    if (!repayAmt || parseFloat(repayAmt) <= 0) return
    writeContract({
      address: VAULT_ADDRESS,
      abi: vaultAbi,
      functionName: 'repayLoan',
      value: parseUnits(repayAmt, 18),
    })
    setRepayAmt('')
  }
  const handleFundPool = (e: React.FormEvent) => {
    e.preventDefault()
    if (!fundAmt || parseFloat(fundAmt) <= 0) return
    writeContract({
      address: VAULT_ADDRESS,
      abi: vaultAbi,
      functionName: 'depositLendingPool',
      value: parseUnits(fundAmt, 18),
    })
    setFundAmt('')
  }
  const handleWithdraw = (e: React.FormEvent) => {
    e.preventDefault()
    if (!withdrawAmt || parseFloat(withdrawAmt) <= 0) return
    writeContract({
      address: VAULT_ADDRESS,
      abi: vaultAbi,
      functionName: 'withdrawCollateral',
      args: [parseUnits(withdrawAmt, 18)],
    })
    setWithdrawAmt('')
  }

  if (!VAULT_ADDRESS) return null
  return (
    <section className="card lending-card">
      <h2>RWA Lending</h2>
      <p className="hint">Deposit TSLA as collateral, borrow ETH (50% LTV)</p>
      {vaultOwner && address?.toLowerCase() === (vaultOwner as string).toLowerCase() && (
        <form onSubmit={handleFundPool} className="lending-form fund-form">
          <label>Fund pool (owner only)</label>
          <input
            type="number"
            placeholder="ETH amount"
            value={fundAmt}
            onChange={(e) => setFundAmt(e.target.value)}
            step="any"
          />
          <button type="submit" className="btn btn-primary" disabled={isPending || isConfirming || !fundAmt}>
            Deposit ETH to pool
          </button>
        </form>
      )}
      <div className="lending-stats">
        <p>Pool: {poolBal ? formatUnits(poolBal, 18).slice(0, 8) : '0'} ETH</p>
        <p>Your collateral: {coll / 1e18} TSLA</p>
        {hasLoan && <p className="loan-amt">Your loan: {loan / 1e18} ETH</p>}
        {hasLoan && healthFactor !== undefined && (
          <p className={Number(healthFactor) < 100 ? 'health-danger' : 'health-ok'}>
            Health: {Number(healthFactor) >= 100 ? 'Healthy (' + (Number(healthFactor) / 100).toFixed(0) + '%)' : '⚠️ LIQUIDATABLE'}
          </p>
        )}
        <p>Max borrow: {max / 1e18} ETH</p>
      </div>
      <form onSubmit={handleDeposit} className="lending-form">
        <label>Deposit TSLA</label>
        <input
          type="number"
          placeholder="Amount"
          value={depositAmt}
          onChange={(e) => setDepositAmt(e.target.value)}
          step="any"
        />
        {needsApproval ? (
          <button type="button" className="btn btn-secondary" onClick={handleApprove} disabled={isPending}>
            Approve TSLA
          </button>
        ) : (
          <button type="submit" className="btn btn-primary" disabled={isPending || isConfirming || !depositAmt}>
            Deposit
          </button>
        )}
      </form>
      <form onSubmit={handleBorrow} className="lending-form">
        <label>Borrow ETH</label>
        <input
          type="number"
          placeholder="Amount"
          value={borrowAmt}
          onChange={(e) => setBorrowAmt(e.target.value)}
          step="any"
        />
        <button type="submit" className="btn btn-primary" disabled={isPending || isConfirming || !borrowAmt || hasLoan}>
          Borrow
        </button>
      </form>
      {hasLoan && (
        <form onSubmit={handleRepay} className="lending-form">
          <label>Repay loan</label>
          <input
            type="number"
            placeholder="ETH amount"
            value={repayAmt}
            onChange={(e) => setRepayAmt(e.target.value)}
            step="any"
          />
          <button type="submit" className="btn btn-secondary" disabled={isPending || isConfirming || !repayAmt}>
            Repay
          </button>
        </form>
      )}
      {coll > 0 && !hasLoan && (
        <form onSubmit={handleWithdraw} className="lending-form">
          <label>Withdraw collateral</label>
          <input
            type="number"
            placeholder="TSLA amount"
            value={withdrawAmt}
            onChange={(e) => setWithdrawAmt(e.target.value)}
            step="any"
          />
          <button type="submit" className="btn btn-secondary" disabled={isPending || isConfirming || !withdrawAmt}>
            Withdraw
          </button>
        </form>
      )}
      {error && <p className="error">{String(error.message)}</p>}
    </section>
  )
}

function TransferPanel({ onClose }: { onClose: () => void }) {
  const [token, setToken] = useState<(typeof STOCK_TOKENS)[number]>(STOCK_TOKENS[0])
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const { writeContract, isPending, error, data: txHash } = useWriteContract()
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash: txHash })

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault()
    if (!to || !amount || parseFloat(amount) <= 0) return
    try {
      writeContract({
        address: token.address,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [to as `0x${string}`, parseUnits(amount, 18)],
      })
      setAmount('')
    } catch {}
  }

  return (
    <div className="transfer-panel">
      <h3>Transfer stock tokens</h3>
      <form onSubmit={handleSend}>
        <select value={token.symbol} onChange={(e) => {
          const t = STOCK_TOKENS.find((x) => x.symbol === e.target.value)
          if (t) setToken(t)
        }}>
          {STOCK_TOKENS.map((t) => (
            <option key={t.symbol} value={t.symbol}>{t.symbol}</option>
          ))}
        </select>
        <input
          placeholder="Recipient address (0x...)"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          required
        />
        <input
          type="number"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          step="any"
          min="0"
          required
        />
        <div className="transfer-actions">
          <button type="submit" className="btn btn-primary" disabled={isPending || isConfirming}>
            {isPending || isConfirming ? 'Sending…' : 'Send'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </form>
      {error && <p className="error">{String(error.message)}</p>}
      {txHash && (
        <a href={`https://explorer.testnet.chain.robinhood.com/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="tx-link">
          View tx →
        </a>
      )}
    </div>
  )
}

function App() {
  const { address, isConnected, chain } = useAccount()
  const { connect, connectors, isPending } = useConnect()
  const { disconnect } = useDisconnect()
  const { switchChain } = useSwitchChain()
  const { data: ethBalance } = useBalance({ address })
  const [message, setMessage] = useState('')
  const [showTransfer, setShowTransfer] = useState(false)

  const { data: totalMessages, refetch: refetchTotal } = useReadContract({
    address: GUESTBOOK_ADDRESS || undefined,
    abi: guestbookAbi,
    functionName: 'getTotalMessages',
  })

  const {
    writeContract,
    data: txHash,
    isPending: isWritePending,
    error: writeError,
  } = useWriteContract()

  const { isLoading: isConfirming, status } = useWaitForTransactionReceipt({ hash: txHash })
  const lastTxRef = useRef<string | null>(null)
  useEffect(() => {
    if (status === 'success' && txHash && lastTxRef.current !== txHash) {
      lastTxRef.current = txHash
      refetchTotal()
    }
  }, [status, txHash, refetchTotal])

  const isOnRobinhood = chain?.id === robinhoodChain.id

  const addNetwork = async () => {
    const provider = (window as unknown as { ethereum?: { request: (args: unknown) => Promise<unknown> } }).ethereum
    if (!provider) {
      alert('Please install MetaMask or another Web3 wallet')
      return
    }
    try {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [ROBINHOOD_NETWORK_PARAMS],
      })
    } catch (err) {
      console.error(err)
      alert('Failed to add network. You may have already added it.')
    }
  }

  const metaMaskConnector = connectors.find((c) => c.id === 'metaMask')
  const phantomConnector = connectors.find((c) => c.id === 'phantom')

  const handlePost = (e: React.FormEvent) => {
    e.preventDefault()
    if (!message.trim() || !GUESTBOOK_ADDRESS) return
    if (message.length > 280) {
      alert('Max 280 characters')
      return
    }
    writeContract({
      address: GUESTBOOK_ADDRESS,
      abi: guestbookAbi,
      functionName: 'post',
      args: [message.trim()],
    })
    setMessage('')
  }

  const total = totalMessages !== undefined ? Number(totalMessages) : 0

  return (
    <div className="app">
      <header className="header">
        <h1>Robinhood Chain</h1>
        <p className="subtitle">RWA Lending · Portfolio · Tokenized stocks</p>
      </header>

      <nav className="links">
        <a href={FAUCET_URL} target="_blank" rel="noopener noreferrer">
          Faucet
        </a>
        <a href={EXPLORER_URL} target="_blank" rel="noopener noreferrer">
          Explorer
        </a>
        <a href="https://docs.robinhood.com/chain" target="_blank" rel="noopener noreferrer">
          Docs
        </a>
      </nav>

      <main className="main">
        {!GUESTBOOK_ADDRESS ? (
          <section className="card deploy-card">
            <h2>Deploy the contract first</h2>
            <p>Run this in your terminal (you need testnet ETH from the faucet):</p>
            <pre className="code">
{`1. Add Robinhood Chain to your wallet
2. Get testnet ETH: faucet.testnet.chain.robinhood.com
3. Create .env with: PRIVATE_KEY=0xYourPrivateKey
4. Run: npm run deploy`}
            </pre>
          </section>
        ) : !isConnected ? (
          <section className="card connect-card">
            <h2>Get Started</h2>
            <p>Connect your wallet to post on-chain messages</p>
            <div className="actions">
              <button onClick={addNetwork} className="btn btn-secondary">
                Add Robinhood Chain
              </button>
              <div className="wallet-buttons">
                <button
                  onClick={() => metaMaskConnector && connect({ connector: metaMaskConnector })}
                  className="btn btn-primary"
                  disabled={isPending || !metaMaskConnector}
                >
                  {isPending ? 'Connecting…' : 'MetaMask'}
                </button>
                <button
                  onClick={() => phantomConnector && connect({ connector: phantomConnector })}
                  className="btn btn-secondary"
                  disabled={isPending || !phantomConnector}
                >
                  Phantom
                </button>
              </div>
            </div>
          </section>
        ) : (
          <>
            <section className="card wallet-card">
              <div className="wallet-header">
                <h2>Connected</h2>
                <button onClick={() => disconnect()} className="btn btn-ghost">
                  Disconnect
                </button>
              </div>
              <p className="address">
                {address?.slice(0, 6)}…{address?.slice(-4)}
              </p>
              {!isOnRobinhood && (
                <button
                  onClick={() => switchChain({ chainId: robinhoodChain.id })}
                  className="btn btn-primary"
                >
                  Switch to Robinhood Chain
                </button>
              )}
            </section>

            {VAULT_ADDRESS && <LendingVaultCard />}

            <section className="card portfolio-card">
              <h2>Your portfolio</h2>
              <p className="hint">Tokenized stocks on Robinhood Chain testnet</p>
              <div className="balances">
                <div className="balance-section">
                  <div className="token-row">
                    <span className="token-symbol">ETH</span>
                    <span className="token-balance">
                      {ethBalance ? formatUnits(ethBalance.value, 18).slice(0, 12) : '—'}
                    </span>
                  </div>
                </div>
                <div className="balance-section">
                  {STOCK_TOKENS.map((t) => (
                    <TokenBalanceRow key={t.symbol} address={t.address} symbol={t.symbol} />
                  ))}
                </div>
              </div>
              {!showTransfer ? (
                <button onClick={() => setShowTransfer(true)} className="btn btn-secondary">
                  Send stocks
                </button>
              ) : (
                <TransferPanel onClose={() => setShowTransfer(false)} />
              )}
            </section>

            <section className="card guestbook-card">
              <h2>On-chain feed</h2>
              <p className="hint">Max 280 characters · Stored forever on Robinhood Chain</p>
              <form onSubmit={handlePost} className="post-form">
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Write something..."
                  maxLength={280}
                  rows={3}
                  disabled={!isOnRobinhood || isWritePending || isConfirming}
                />
                <div className="form-footer">
                  <span className="char-count">{message.length}/280</span>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={!message.trim() || !isOnRobinhood || isWritePending || isConfirming}
                  >
                    {isWritePending || isConfirming ? 'Posting…' : 'Post'}
                  </button>
                </div>
              </form>
              {writeError && <p className="error">{String(writeError.message)}</p>}
              {txHash && (
                <a
                  href={`https://explorer.testnet.chain.robinhood.com/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tx-link"
                >
                  View transaction →
                </a>
              )}
              <h3>{total} message{total !== 1 ? 's' : ''} on-chain</h3>
              <div className="message-list">
                {Array.from({ length: total }, (_, i) => (
                  <MessageItem key={i} id={i} />
                ))}
              </div>
            </section>
          </>
        )}
      </main>

      <footer className="footer">
        <p>Robinhood Chain Testnet · Chain ID 46630</p>
      </footer>
    </div>
  )
}

export default App
