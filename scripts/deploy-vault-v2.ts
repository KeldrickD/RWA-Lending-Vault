import 'dotenv/config'
import { writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { compileContract } from './compile-with-imports'
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { robinhoodChain } from '../src/config/chains'

const TSLA_ADDRESS = '0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E' as `0x${string}`
const PRICE_FEED = '0x0000000000000000000000000000000000000000' as `0x${string}` // address(0) = 1:1 testnet
const COLLATERAL_FACTOR = 50n
const LIQUIDATION_THRESHOLD = 125n
const LIQUIDATION_BONUS = 5n

async function main() {
  let pk = process.env.PRIVATE_KEY?.trim()
  if (!pk) {
    console.error('Set PRIVATE_KEY in .env')
    process.exit(1)
  }
  if (!pk.startsWith('0x')) pk = '0x' + pk

  console.log('Compiling RWALendingVaultV2...')
  const compiled = compileContract('RWALendingVaultV2.sol', 'RWALendingVaultV2')
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

  const hash = await walletClient.deployContract({
    abi: compiled.abi,
    account,
    bytecode,
    args: [TSLA_ADDRESS, PRICE_FEED, COLLATERAL_FACTOR, LIQUIDATION_THRESHOLD, LIQUIDATION_BONUS],
  })

  console.log('TX hash:', hash)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  const address = receipt.contractAddress!
  console.log('RWALendingVaultV2 deployed to:', address)
  console.log('Explorer:', `https://explorer.testnet.chain.robinhood.com/address/${address}`)

  const deployedPath = join(process.cwd(), 'src', 'config', 'deployed.json')
  const deployed = JSON.parse(readFileSync(deployedPath, 'utf-8'))
  deployed.vaultAddress = address
  deployed.vaultVersion = 2
  writeFileSync(deployedPath, JSON.stringify(deployed, null, 2))
  console.log('Updated src/config/deployed.json')

  console.log('\nNext: Fund the lending pool: npm run fund:vault 0.01')
  console.log('For mainnet: pass Chainlink TSLA/USD feed (e.g. Arbitrum: 0x3609baAa0a9b1f0FE4d6CC01884585d0e191C3E3)')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
