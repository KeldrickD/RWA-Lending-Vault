import { useState, useEffect, useRef } from 'react'
import {
  useAccount,
  useBalance,
  useBlock,
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
import { vaultAbiV3 } from './config/vaultAbiV3'
import { vaultAbiV4 } from './config/vaultAbiV4'
import { mockOracleAbi } from './config/mockOracleAbi'
import deployed from './config/deployed.json'

const VAULT_V2 = deployed.vaultVersion === 2
const VAULT_V3 = deployed.vaultVersion === 3
const VAULT_V4 = deployed.vaultVersion === 4
const VAULT_V3_OR_V4 = VAULT_V3 || VAULT_V4
const vaultAbiToUse = VAULT_V4 ? vaultAbiV4 : VAULT_V3 ? vaultAbiV3 : vaultAbi
const mockOracles = (deployed as { mockOracles?: Record<string, string> }).mockOracles
import './App.css'

const GUESTBOOK_ADDRESS = (deployed.guestbookAddress || '') as `0x${string}`
const VAULT_ADDRESS = (deployed.vaultAddress || '') as `0x${string}`
const TSLA_ADDRESS = STOCK_TOKENS.find((t) => t.symbol === 'TSLA')!.address

function DeferredVaultStats() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setReady(true), 100)
    return () => clearTimeout(id)
  }, [])
  return ready ? <VaultStatsTeaser /> : <div className="vault-stats-teaser vault-stats-skeleton"><span className="stat-value">Loading...</span></div>
}

function VaultStatsTeaser() {
  const { data: poolBal } = useReadContract({
    address: VAULT_ADDRESS || undefined,
    abi: vaultAbiToUse,
    functionName: 'poolBalance',
  })
  const { data: borrowRate } = useReadContract({
    address: VAULT_ADDRESS && VAULT_V3_OR_V4 ? VAULT_ADDRESS : undefined,
    abi: vaultAbiToUse,
    functionName: 'getCurrentBorrowRate',
  })
  const { data: utilization } = useReadContract({
    address: VAULT_ADDRESS && VAULT_V3_OR_V4 ? VAULT_ADDRESS : undefined,
    abi: vaultAbiToUse,
    functionName: 'getUtilization',
  })
  if (!VAULT_ADDRESS) return null
  return (
    <div className="vault-stats-teaser">
      <div className="stat">
        <span className="stat-label">Pool TVL</span>
        <span className="stat-value">{poolBal ? formatUnits(poolBal, 18).slice(0, 8) : '—'} ETH</span>
      </div>
      {borrowRate !== undefined && (
        <div className="stat">
          <span className="stat-label">Borrow APR</span>
          <span className="stat-value">{(Number(borrowRate) / 100).toFixed(2)}%</span>
        </div>
      )}
      {utilization !== undefined && (
        <div className="stat">
          <span className="stat-label">Utilization</span>
          <span className="stat-value">{(Number(utilization) / 100).toFixed(1)}%</span>
        </div>
      )}
    </div>
  )
}

function HowItWorks() {
  const steps = [
    { icon: '📥', label: 'Deposit', desc: 'Add TSLA, AMZN, PLTR, NFLX or AMD as collateral' },
    { icon: '💰', label: 'Borrow', desc: 'Get ETH up to 50% LTV with dynamic interest rates' },
    { icon: '📊', label: 'Monitor', desc: 'Track health factor & oracle prices in real time' },
    { icon: '⚡', label: 'Liquidate', desc: 'Simulate price crashes or liquidate underwater positions' },
  ]
  return (
    <div className="how-it-works">
      <h3>How it works</h3>
      <div className="steps">
        {steps.map((s, i) => (
          <div key={i} className="step">
            <span className="step-icon">{s.icon}</span>
            <div className="step-content">
              <strong>{s.label}</strong>
              <span>{s.desc}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

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
  const [depositToken, setDepositToken] = useState<(typeof STOCK_TOKENS)[number]>(STOCK_TOKENS[0])
  const [withdrawToken, setWithdrawToken] = useState<(typeof STOCK_TOKENS)[number]>(STOCK_TOKENS[0])

  const { data: poolBal } = useReadContract({
    address: VAULT_ADDRESS || undefined,
    abi: vaultAbiToUse,
    functionName: 'poolBalance',
  })
  const { data: collateral } = useReadContract({
    address: VAULT_ADDRESS || undefined,
    abi: vaultAbi,
    functionName: 'collateralBalances',
    args: address && !VAULT_V3_OR_V4 ? [address] : undefined,
  })
  const { data: collateralValueUSD } = useReadContract({
    address: VAULT_ADDRESS && VAULT_V3_OR_V4 ? VAULT_ADDRESS : undefined,
    abi: vaultAbiToUse,
    functionName: 'getCollateralValueUSD',
    args: address ? [address] : undefined,
  })
  const { data: collateralBalancesV3 } = useReadContracts({
    contracts: VAULT_V3_OR_V4 && address
      ? STOCK_TOKENS.map((t) => ({
          address: VAULT_ADDRESS,
          abi: vaultAbiToUse,
          functionName: 'getCollateralBalance' as const,
          args: [address, t.address],
        }))
      : [],
  })
  const { data: loanDetails } = useReadContract({
    address: VAULT_ADDRESS || undefined,
    abi: vaultAbiToUse,
    functionName: 'getLoanDetails',
    args: address ? [address] : undefined,
  })
  const { data: loanDebtAccrued } = useReadContract({
    address: VAULT_ADDRESS && VAULT_V3_OR_V4 ? VAULT_ADDRESS : undefined,
    abi: vaultAbiToUse,
    functionName: 'getLoanDebtWithAccrued',
    args: address ? [address] : undefined,
  })
  const { data: maxBorrow } = useReadContract({
    address: VAULT_ADDRESS || undefined,
    abi: vaultAbiToUse,
    functionName: 'getMaxBorrow',
    args: address ? [address] : undefined,
  })
  const { data: healthFactor } = useReadContract({
    address: VAULT_ADDRESS && (VAULT_V2 || VAULT_V3_OR_V4) ? VAULT_ADDRESS : undefined,
    abi: vaultAbiToUse,
    functionName: 'getHealthFactor',
    args: address ? [address] : undefined,
  })
  const { data: borrowRate } = useReadContract({
    address: VAULT_ADDRESS && VAULT_V3_OR_V4 ? VAULT_ADDRESS : undefined,
    abi: vaultAbiToUse,
    functionName: 'getCurrentBorrowRate',
  })
  const { data: utilization } = useReadContract({
    address: VAULT_ADDRESS && VAULT_V3_OR_V4 ? VAULT_ADDRESS : undefined,
    abi: vaultAbiToUse,
    functionName: 'getUtilization',
  })
  const { data: vaultOwner } = useReadContract({
    address: VAULT_ADDRESS || undefined,
    abi: vaultAbiToUse,
    functionName: 'owner',
  })
  const { data: depositTokenBalance } = useReadContract({
    address: VAULT_V3_OR_V4 ? depositToken.address : TSLA_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
  })
  const { data: ethBalance } = useBalance({ address })
  const tokenForAllowance = VAULT_V3_OR_V4 ? depositToken : { address: TSLA_ADDRESS }
  const { data: tokenAllowance } = useReadContract({
    address: (tokenForAllowance as { address: `0x${string}` }).address,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && VAULT_ADDRESS ? [address, VAULT_ADDRESS] : undefined,
  })
  const [depositAmt, setDepositAmt] = useState('')
  const [borrowAmt, setBorrowAmt] = useState('')
  const [repayAmt, setRepayAmt] = useState('')
  const [withdrawAmt, setWithdrawAmt] = useState('')
  const [fundAmt, setFundAmt] = useState('')
  const [simulateToken, setSimulateToken] = useState<(typeof STOCK_TOKENS)[number]>(STOCK_TOKENS[0])
  const [simulatePrice, setSimulatePrice] = useState('')
  const { data: tokenPrices } = useReadContracts({
    contracts: VAULT_V4 && VAULT_ADDRESS
      ? STOCK_TOKENS.map((t) => ({
          address: VAULT_ADDRESS,
          abi: vaultAbiV4,
          functionName: 'getTokenPriceUSD' as const,
          args: [t.address],
        }))
      : [],
  })
  const { data: block } = useBlock()
  const { data: mockUpdatedAts } = useReadContracts({
    contracts: VAULT_V4 && mockOracles
      ? STOCK_TOKENS.map((t) => ({
          address: mockOracles[t.symbol] as `0x${string}`,
          abi: mockOracleAbi,
          functionName: 'updatedAt' as const,
        }))
      : [],
  })
  const isVaultOwner = vaultOwner && address?.toLowerCase() === (vaultOwner as string).toLowerCase()
  const { writeContract, isPending, error, data: writeTxHash } = useWriteContract()
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash: writeTxHash })

  const coll = VAULT_V3_OR_V4
    ? (collateralBalancesV3?.reduce((sum, r) => sum + Number((r as { result?: bigint }).result ?? 0), 0) ?? 0)
    : (collateral !== undefined ? Number(collateral) : 0)
  const loan = VAULT_V3_OR_V4 && loanDebtAccrued !== undefined
    ? Number(loanDebtAccrued)
    : (loanDetails ? Number(loanDetails[0]) : 0)
  const hasLoan = loanDetails?.[2] === true
  const max = maxBorrow !== undefined ? Number(maxBorrow) : 0
  const borrowPreviewHF = (() => {
    if (hasLoan || !borrowAmt || parseFloat(borrowAmt) <= 0 || !collateralValueUSD) return null
    const debtWei = BigInt(Math.floor(parseFloat(borrowAmt) * 1e18))
    if (debtWei === 0n) return null
    const collValue = BigInt(Number(collateralValueUSD))
    return Number((collValue * 10000n) / (debtWei * 125n))
  })()
  const projectedHealthFactor = (() => {
    if (!hasLoan || !simulatePrice || parseFloat(simulatePrice) <= 0 || !VAULT_V4 || !collateralValueUSD || !collateralBalancesV3 || !tokenPrices) return null
    const simIdx = STOCK_TOKENS.findIndex((t) => t.symbol === simulateToken.symbol)
    if (simIdx < 0) return null
    const balR = collateralBalancesV3[simIdx] as { result?: bigint } | undefined
    const priceR = tokenPrices[simIdx] as { result?: bigint } | undefined
    if (!balR?.result || !priceR?.result) return null
    const bal = balR.result
    const oldPrice = priceR.result
    const newPrice = BigInt(Math.floor(parseFloat(simulatePrice) * 1e18))
    const currentColl = BigInt(Number(collateralValueUSD))
    const oldTokenVal = (bal * oldPrice) / BigInt(1e18)
    const newTokenVal = (bal * newPrice) / BigInt(1e18)
    const projectedColl = currentColl - oldTokenVal + newTokenVal
    const debt = BigInt(Math.ceil(loan))
    if (debt === 0n) return null
    return Number((projectedColl * 10000n) / (debt * 125n))
  })()
  const needsApproval = depositAmt && parseFloat(depositAmt) > 0 && tokenAllowance !== undefined && parseUnits(depositAmt, 18) > tokenAllowance

  const handleApprove = () => {
    if (!depositAmt || parseFloat(depositAmt) <= 0) return
    const tokenAddr = VAULT_V3_OR_V4 ? depositToken.address : TSLA_ADDRESS
    writeContract({
      address: tokenAddr,
      abi: erc20Abi,
      functionName: 'approve',
      args: [VAULT_ADDRESS, parseUnits(depositAmt, 18)],
    })
    setDepositAmt('')
  }
  const handleDeposit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!depositAmt || parseFloat(depositAmt) <= 0) return
    writeContract({
      address: VAULT_ADDRESS,
      abi: vaultAbiToUse,
      functionName: 'depositCollateral',
      args: VAULT_V3_OR_V4 ? [depositToken.address, parseUnits(depositAmt, 18)] : [parseUnits(depositAmt, 18)],
    })
    setDepositAmt('')
  }
  const handleBorrow = (e: React.FormEvent) => {
    e.preventDefault()
    if (!borrowAmt || parseFloat(borrowAmt) <= 0) return
    writeContract({
      address: VAULT_ADDRESS,
      abi: vaultAbiToUse,
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
      abi: vaultAbiToUse,
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
      abi: vaultAbiToUse,
      functionName: 'depositLendingPool',
      value: parseUnits(fundAmt, 18),
    })
    setFundAmt('')
  }
  const handleSimulatePrice = (e: React.FormEvent) => {
    e.preventDefault()
    if (!simulatePrice || parseFloat(simulatePrice) <= 0 || !mockOracles?.[simulateToken.symbol]) return
    writeContract({
      address: mockOracles[simulateToken.symbol] as `0x${string}`,
      abi: mockOracleAbi,
      functionName: 'setPrice',
      args: [BigInt(Math.round(parseFloat(simulatePrice) * 1e8))],
    })
    setSimulatePrice('')
  }
  const handleWithdraw = (e: React.FormEvent) => {
    e.preventDefault()
    if (!withdrawAmt || parseFloat(withdrawAmt) <= 0) return
    writeContract({
      address: VAULT_ADDRESS,
      abi: vaultAbiToUse,
      functionName: 'withdrawCollateral',
      args: VAULT_V3_OR_V4 ? [withdrawToken.address, parseUnits(withdrawAmt, 18)] : [parseUnits(withdrawAmt, 18)],
    })
    setWithdrawAmt('')
  }

  if (!VAULT_ADDRESS) return null
  return (
    <section className="card lending-card featured-vault">
      <h2>RWA Lending{VAULT_V4 ? ' V4' : VAULT_V3 ? ' V3' : ''}</h2>
      <p className="hint">
        {VAULT_V3_OR_V4
          ? `Deposit any supported stock (TSLA, AMZN, PLTR, NFLX, AMD) · Dynamic rates${VAULT_V4 ? ' · Oracle-ready' : ''}`
          : 'Deposit TSLA as collateral, borrow ETH (50% LTV)'}
      </p>
      {isVaultOwner && (
        <form onSubmit={handleFundPool} className="lending-form fund-form">
          <label>Fund pool (owner only)</label>
          <div className="input-with-max">
            <input
              type="number"
              placeholder="ETH amount"
              value={fundAmt}
              onChange={(e) => setFundAmt(e.target.value)}
              step="any"
            />
            {ethBalance && (
              <button type="button" className="btn-max" onClick={() => setFundAmt(formatUnits(ethBalance.value, 18))}>
                Max
              </button>
            )}
          </div>
          <button type="submit" className="btn btn-primary" disabled={isPending || isConfirming || !fundAmt}>
            Deposit ETH to pool
          </button>
        </form>
      )}
      <div className="lending-stats">
        <p>Pool: {poolBal ? formatUnits(poolBal, 18).slice(0, 8) : '0'} ETH</p>
        {VAULT_V3_OR_V4 && borrowRate !== undefined && (
          <p>Borrow rate: {(Number(borrowRate) / 100).toFixed(2)}% APR</p>
        )}
        {VAULT_V3_OR_V4 && utilization !== undefined && (
          <p className={Number(utilization) > 8000 ? 'utilization-high' : ''}>Utilization: {(Number(utilization) / 100).toFixed(1)}%</p>
        )}
        {VAULT_V3_OR_V4 && utilization !== undefined && Number(utilization) === 0 && poolBal && Number(poolBal) > 0 && (
          <p className="pool-nudge">Pool underutilized — borrow to earn for lenders!</p>
        )}
        <p>Your collateral: {VAULT_V3_OR_V4 ? (collateralValueUSD ? `$${(Number(collateralValueUSD) / 1e18).toFixed(0)}` : '0') : `${(coll / 1e18).toFixed(2)} TSLA`}</p>
        {hasLoan && <p className="loan-amt">Your loan: {(loan / 1e18).toFixed(4)} ETH</p>}
        {hasLoan && healthFactor !== undefined && (
          <p className={Number(healthFactor) < 100 ? 'health-danger' : 'health-ok'}>
            Health: {Number(healthFactor) >= 100 ? 'Healthy (' + (Number(healthFactor) / 100).toFixed(0) + '%)' : '⚠️ LIQUIDATABLE'}
          </p>
        )}
        <p>Max borrow: {(max / 1e18).toFixed(4)} ETH</p>
      </div>
      {VAULT_V4 && tokenPrices && tokenPrices.length > 0 && (
        <div className="lending-stats oracle-status">
          <p className="oracle-label">Oracle status (mock feeds)</p>
          <div className="oracle-prices">
            {STOCK_TOKENS.map((t, i) => {
              const r = tokenPrices[i] as { result?: bigint } | undefined
              const price = r?.result !== undefined ? Number(r.result) / 1e18 : 0
              const updatedAtR = mockUpdatedAts?.[i] as { result?: bigint } | undefined
              const updatedAt = updatedAtR?.result !== undefined ? Number(updatedAtR.result) : 0
              const blockTs = block?.timestamp != null ? Number(block.timestamp) : 0
              const isStale = blockTs > 0 && updatedAt > 0 && (blockTs - updatedAt) > 3600
              const status = isStale ? 'Stale' : 'Active'
              return (
                <span key={t.symbol} className={isStale ? 'oracle-stale' : ''} title={isStale ? 'Price >1hr old, fallback to 1:1' : ''}>
                  {t.symbol}: ${price.toFixed(0)} <small>({status})</small>
                </span>
              )
            })}
          </div>
        </div>
      )}
      {VAULT_V4 && mockOracles && isVaultOwner && (
        <form onSubmit={handleSimulatePrice} className="lending-form simulate-form">
          <label>Simulate price change (owner only)</label>
          <select value={simulateToken.symbol} onChange={(e) => {
            const t = STOCK_TOKENS.find((x) => x.symbol === e.target.value)
            if (t) setSimulateToken(t)
          }}>
            {STOCK_TOKENS.map((t) => (
              <option key={t.symbol} value={t.symbol}>{t.symbol}</option>
            ))}
          </select>
          <input
            type="number"
            placeholder="New price (USD)"
            value={simulatePrice}
            onChange={(e) => setSimulatePrice(e.target.value)}
            step="any"
            min="0"
          />
          <button type="submit" className="btn btn-secondary" disabled={isPending || isConfirming || !simulatePrice}>
            Set price
          </button>
          {projectedHealthFactor !== null && (
            <p className={`projected-hf ${projectedHealthFactor < 100 ? 'health-danger' : 'health-ok'}`}>
              If {simulateToken.symbol} → ${simulatePrice}: HF = {(projectedHealthFactor / 100).toFixed(0)}%
              {projectedHealthFactor < 100 && ' (liquidatable)'}
            </p>
          )}
        </form>
      )}
      <form onSubmit={handleDeposit} className="lending-form">
        <label>Deposit {VAULT_V3_OR_V4 ? 'collateral' : 'TSLA'}</label>
        {VAULT_V3_OR_V4 && (
          <select value={depositToken.symbol} onChange={(e) => {
            const t = STOCK_TOKENS.find((x) => x.symbol === e.target.value)
            if (t) setDepositToken(t)
          }}>
            {STOCK_TOKENS.map((t) => (
              <option key={t.symbol} value={t.symbol}>{t.symbol}</option>
            ))}
          </select>
        )}
        <div className="input-with-max">
          <input
            type="number"
            placeholder="Amount"
            value={depositAmt}
            onChange={(e) => setDepositAmt(e.target.value)}
            step="any"
          />
          {depositTokenBalance !== undefined && (
            <button type="button" className="btn-max" onClick={() => setDepositAmt(formatUnits(depositTokenBalance, 18))}>
              Max
            </button>
          )}
        </div>
        {needsApproval ? (
          <button type="button" className="btn btn-secondary" onClick={handleApprove} disabled={isPending}>
            Approve {VAULT_V3_OR_V4 ? depositToken.symbol : 'TSLA'}
          </button>
        ) : (
          <button type="submit" className="btn btn-primary" disabled={isPending || isConfirming || !depositAmt}>
            Deposit
          </button>
        )}
      </form>
      <form onSubmit={handleBorrow} className="lending-form">
        <label>Borrow ETH</label>
        <div className="input-with-max">
          <input
            type="number"
            placeholder="Amount"
            value={borrowAmt}
            onChange={(e) => setBorrowAmt(e.target.value)}
            step="any"
          />
          {max > 0 && (
            <button type="button" className="btn-max" onClick={() => setBorrowAmt((max / 1e18).toString())}>
              Max
            </button>
          )}
        </div>
        {borrowPreviewHF !== null && (
          <p className={`borrow-preview ${borrowPreviewHF < 100 ? 'health-danger' : 'health-ok'}`}>
            Borrowing {borrowAmt} ETH → HF: {(borrowPreviewHF / 100).toFixed(0)}% {borrowPreviewHF < 100 ? '(liquidatable)' : 'Healthy'}
          </p>
        )}
        <button type="submit" className="btn btn-primary" disabled={isPending || isConfirming || !borrowAmt || hasLoan}>
          Borrow
        </button>
      </form>
      {hasLoan && (
        <form onSubmit={handleRepay} className="lending-form">
          <label>Repay loan</label>
          <div className="input-with-max">
            <input
              type="number"
              placeholder="ETH amount"
              value={repayAmt}
              onChange={(e) => setRepayAmt(e.target.value)}
              step="any"
            />
            <button type="button" className="btn-max" onClick={() => setRepayAmt((loan / 1e18).toString())}>
              Max
            </button>
          </div>
          <button type="submit" className="btn btn-secondary" disabled={isPending || isConfirming || !repayAmt}>
            Repay
          </button>
        </form>
      )}
      {(VAULT_V3_OR_V4 ? (collateralBalancesV3?.some((r) => Number((r as { result?: bigint }).result ?? 0) > 0) ?? false) : coll > 0) && !hasLoan && (
        <form onSubmit={handleWithdraw} className="lending-form">
          <label>Withdraw collateral</label>
          {VAULT_V3_OR_V4 && (
            <select value={withdrawToken.symbol} onChange={(e) => {
              const t = STOCK_TOKENS.find((x) => x.symbol === e.target.value)
              if (t) setWithdrawToken(t)
            }}>
              {STOCK_TOKENS.map((t) => (
                <option key={t.symbol} value={t.symbol}>{t.symbol}</option>
              ))}
            </select>
          )}
          <div className="input-with-max">
            <input
              type="number"
              placeholder={`${VAULT_V3_OR_V4 ? withdrawToken.symbol : 'TSLA'} amount`}
              value={withdrawAmt}
              onChange={(e) => setWithdrawAmt(e.target.value)}
              step="any"
            />
            {VAULT_V3_OR_V4 ? (() => {
              const idx = STOCK_TOKENS.findIndex((t) => t.symbol === withdrawToken.symbol)
              const bal = collateralBalancesV3 && idx >= 0 ? (collateralBalancesV3[idx] as { result?: bigint })?.result : undefined
              return bal !== undefined ? (
                <button type="button" className="btn-max" onClick={() => setWithdrawAmt(formatUnits(bal, 18))}>
                  Max
                </button>
              ) : null
            })() : coll > 0 ? (
              <button type="button" className="btn-max" onClick={() => setWithdrawAmt((coll / 1e18).toString())}>
                Max
              </button>
            ) : null}
          </div>
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
  const [activeTab, setActiveTab] = useState<'vault' | 'portfolio' | 'feed'>('vault')
  const [darkMode, setDarkMode] = useState(() => {
    try {
      const saved = localStorage.getItem('theme')
      return saved !== 'light'
    } catch { return true }
  })
  useEffect(() => {
    document.documentElement.classList.toggle('light-mode', !darkMode)
    try { localStorage.setItem('theme', darkMode ? 'dark' : 'light') } catch {}
  }, [darkMode])

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
        <div className="header-row">
          <h1>Robinhood Chain</h1>
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setDarkMode((d) => !d)}
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label="Toggle theme"
          >
            {darkMode ? '☀️' : '🌙'}
          </button>
        </div>
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
          <section className="card connect-card hero-card">
            <h2>Test RWA Lending on Robinhood Chain</h2>
            <p className="hero-copy">
              Connect your wallet to lend/borrow against tokenized stocks (TSLA, AMZN, PLTR, NFLX, AMD). Deposit collateral → Borrow ETH → Simulate liquidations.
            </p>
            <div className="token-badges">
              {STOCK_TOKENS.map((t) => (
                <span key={t.symbol} className="token-badge">{t.symbol}</span>
              ))}
            </div>
            <ul className="hero-bullets">
              <li><span className="bullet-icon">🔒</span> Multi-asset collateral · 5 stock tokens supported</li>
              <li><span className="bullet-icon">📈</span> Dynamic rates & oracle-ready pricing</li>
              <li><span className="bullet-icon">⚡</span> Simulate price crashes → test liquidations</li>
            </ul>
            <p className="why-connect" title="Testnet uses fake tokens and ETH—no real funds at risk. Connect to try lending, borrowing, and liquidations.">
              Why connect? <span className="why-tooltip">Testnet = no real funds at risk</span>
            </p>
            {VAULT_ADDRESS && <DeferredVaultStats />}
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
            <HowItWorks />
          </section>
        ) : (
          <>
            <div className="wallet-bar sticky-bar">
              <div className="wallet-bar-left">
                <span className="wallet-address">{address?.slice(0, 6)}…{address?.slice(-4)}</span>
                <span className={`network-badge ${isOnRobinhood ? 'network-ok' : 'network-wrong'}`}>
                  {isOnRobinhood ? '✓ Robinhood Chain' : 'Wrong network'}
                </span>
              </div>
              <div className="wallet-bar-right">
                {!isOnRobinhood && (
                  <button
                    onClick={() => switchChain({ chainId: robinhoodChain.id })}
                    className="btn btn-primary btn-sm"
                  >
                    Switch chain
                  </button>
                )}
                <button onClick={() => disconnect()} className="btn btn-ghost btn-sm">
                  Disconnect
                </button>
              </div>
            </div>

            <nav className="tab-nav">
              <button className={`tab ${activeTab === 'vault' ? 'tab-active' : ''}`} onClick={() => setActiveTab('vault')}>Vault</button>
              <button className={`tab ${activeTab === 'portfolio' ? 'tab-active' : ''}`} onClick={() => setActiveTab('portfolio')}>Portfolio</button>
              <button className={`tab ${activeTab === 'feed' ? 'tab-active' : ''}`} onClick={() => setActiveTab('feed')}>Feed</button>
            </nav>

            {activeTab === 'vault' && VAULT_ADDRESS && <LendingVaultCard />}

            {activeTab === 'portfolio' && (
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
            )}

            {activeTab === 'feed' && (
            <section className="card guestbook-card">
              <h2>On-chain feed</h2>
              <p className="hint">Share your lending strategies or test results on-chain · Max 280 chars</p>
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
            )}
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
