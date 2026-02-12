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

// address(0) = 1:1 testnet fallback for all tokens
const ZERO_FEED = '0x0000000000000000000000000000000000000000' as `0x${string}`

async function main() {
  let pk = process.env.PRIVATE_KEY?.trim()
  if (!pk) {
    console.error('Set PRIVATE_KEY in .env')
    process.exit(1)
  }
  if (!pk.startsWith('0x')) pk = '0x' + pk

  const tokens = STOCK_TOKENS.map((t) => t.address as string)
  const priceFeeds = STOCK_TOKENS.map(() => ZERO_FEED as string)

  console.log('Compiling RWALendingVaultV3...')
  const compiled = compileContract('RWALendingVaultV3.sol', 'RWALendingVaultV3')
  const bc = compiled.evm.bytecode.object
  const bytecode = (bc.startsWith('0x') ? bc : '0x' + bc) as `0x${string}`

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
  console.log('Tokens:', tokens)
  console.log('Price feeds: all address(0) for testnet 1:1 fallback')

  const hash = await walletClient.deployContract({
    abi: compiled.abi,
    account,
    bytecode,
    args: [tokens, priceFeeds, COLLATERAL_FACTOR, LIQUIDATION_THRESHOLD, LIQUIDATION_BONUS],
  })

  console.log('TX hash:', hash)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  const address = receipt.contractAddress!
  console.log('RWALendingVaultV3 deployed to:', address)
  console.log('Explorer:', `https://explorer.testnet.chain.robinhood.com/address/${address}`)

  const deployedPath = join(process.cwd(), 'src', 'config', 'deployed.json')
  const deployed = JSON.parse(readFileSync(deployedPath, 'utf-8'))
  deployed.vaultAddress = address
  deployed.vaultVersion = 3
  writeFileSync(deployedPath, JSON.stringify(deployed, null, 2))
  console.log('Updated src/config/deployed.json')

  console.log('\nNext: Fund the lending pool: npm run fund:vault 0.1')
  console.log('V3 features: utilization-based rates, multi-asset collateral (TSLA, AMZN, PLTR, NFLX, AMD)')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
