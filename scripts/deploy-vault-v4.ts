import 'dotenv/config'
import { writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { compileContract } from './compile-with-imports'
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { robinhoodChain } from '../src/config/chains'
import { STOCK_TOKENS } from '../src/config/tokens'

const COLLATERAL_FACTOR = 50n
const LIQUIDATION_THRESHOLD = 125n
const LIQUIDATION_BONUS = 5n

// Approximate stock prices in 8 decimals (Chainlink format)
const MOCK_PRICES: { symbol: string; price: bigint; desc: string }[] = [
  { symbol: 'TSLA', price: 250n * 10n ** 8n, desc: 'Mock TSLA/USD' },
  { symbol: 'AMZN', price: 180n * 10n ** 8n, desc: 'Mock AMZN/USD' },
  { symbol: 'PLTR', price: 25n * 10n ** 8n, desc: 'Mock PLTR/USD' },
  { symbol: 'NFLX', price: 500n * 10n ** 8n, desc: 'Mock NFLX/USD' },
  { symbol: 'AMD', price: 120n * 10n ** 8n, desc: 'Mock AMD/USD' },
]

async function main() {
  let pk = process.env.PRIVATE_KEY?.trim()
  if (!pk) {
    console.error('Set PRIVATE_KEY in .env')
    process.exit(1)
  }
  if (!pk.startsWith('0x')) pk = '0x' + pk

  const account = privateKeyToAccount(pk as `0x${string}`)
  const transport = http('https://rpc.testnet.chain.robinhood.com')
  const publicClient = createPublicClient({ chain: robinhoodChain, transport })
  const walletClient = createWalletClient({
    account,
    chain: robinhoodChain,
    transport,
  })!

  const balance = await publicClient.getBalance({ address: account.address })
  console.log('Deploying from:', account.address)
  console.log('Balance:', Number(balance) / 1e18, 'ETH')

  // 1. Compile and deploy Mock oracles
  console.log('\nCompiling MockAggregatorV3...')
  const mockCompiled = compileContract('MockAggregatorV3.sol', 'MockAggregatorV3')
  const mockBytecode = (mockCompiled.evm.bytecode.object.startsWith('0x')
    ? mockCompiled.evm.bytecode.object
    : '0x' + mockCompiled.evm.bytecode.object) as `0x${string}`

  const mockAddresses: Record<string, string> = {}
  for (let i = 0; i < STOCK_TOKENS.length; i++) {
    const { symbol, price, desc } = MOCK_PRICES[i]!
    console.log(`Deploying mock ${symbol} @ $${Number(price) / 1e8}...`)
    const hash = await walletClient.deployContract({
      abi: mockCompiled.abi,
      account,
      bytecode: mockBytecode,
      args: [price, desc],
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    mockAddresses[symbol] = receipt.contractAddress!
    console.log(`  ${symbol} oracle: ${receipt.contractAddress}`)
  }

  const tokens = STOCK_TOKENS.map((t) => t.address as string)
  const priceFeeds = STOCK_TOKENS.map((t, i) => mockAddresses[MOCK_PRICES[i]!.symbol]!)

  // 2. Compile and deploy V4 vault
  console.log('\nCompiling RWALendingVaultV4...')
  const vaultCompiled = compileContract('RWALendingVaultV4.sol', 'RWALendingVaultV4')
  const vaultBytecode = (vaultCompiled.evm.bytecode.object.startsWith('0x')
    ? vaultCompiled.evm.bytecode.object
    : '0x' + vaultCompiled.evm.bytecode.object) as `0x${string}`

  const vaultHash = await walletClient.deployContract({
    abi: vaultCompiled.abi,
    account,
    bytecode: vaultBytecode,
    args: [tokens, priceFeeds, COLLATERAL_FACTOR, LIQUIDATION_THRESHOLD, LIQUIDATION_BONUS],
  })

  const vaultReceipt = await publicClient.waitForTransactionReceipt({ hash: vaultHash })
  const vaultAddress = vaultReceipt.contractAddress!

  console.log('\nRWALendingVaultV4 deployed to:', vaultAddress)
  console.log('Explorer:', `https://explorer.testnet.chain.robinhood.com/address/${vaultAddress}`)

  const deployedPath = join(process.cwd(), 'src', 'config', 'deployed.json')
  const deployed = JSON.parse(readFileSync(deployedPath, 'utf-8'))
  deployed.vaultAddress = vaultAddress
  deployed.vaultVersion = 4
  deployed.mockOracles = mockAddresses
  writeFileSync(deployedPath, JSON.stringify(deployed, null, 2))
  console.log('Updated src/config/deployed.json')

  console.log('\nMock oracles (call setPrice to simulate drops):')
  Object.entries(mockAddresses).forEach(([sym, addr]) => console.log(`  ${sym}: ${addr}`))
  console.log('\nNext: npm run fund:vault 0.01')
  console.log('V4: Oracle-ready with mock feeds. Simulate price drops via setPrice on mock contracts.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
