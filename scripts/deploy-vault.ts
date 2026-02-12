import 'dotenv/config'
import { writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { compileContract } from './compile-with-imports'
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { robinhoodChain } from '../src/config/chains'

const TSLA_ADDRESS = '0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E' as `0x${string}`
const COLLATERAL_FACTOR = 50n

async function main() {
  let pk = process.env.PRIVATE_KEY?.trim()
  if (!pk) {
    console.error('Set PRIVATE_KEY in .env')
    process.exit(1)
  }
  if (!pk.startsWith('0x')) pk = '0x' + pk

  console.log('Compiling RWALendingVault...')
  const compiled = compileContract('RWALendingVault.sol', 'RWALendingVault')
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
    args: [TSLA_ADDRESS, COLLATERAL_FACTOR],
  })

  console.log('TX hash:', hash)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  const address = receipt.contractAddress!
  console.log('RWALendingVault deployed to:', address)
  console.log('Explorer:', `https://explorer.testnet.chain.robinhood.com/address/${address}`)

  const deployedPath = join(process.cwd(), 'src', 'config', 'deployed.json')
  const deployed = JSON.parse(readFileSync(deployedPath, 'utf-8'))
  deployed.vaultAddress = address
  writeFileSync(deployedPath, JSON.stringify(deployed, null, 2))
  console.log('Updated src/config/deployed.json')

  console.log('\nNext: Fund the lending pool with ETH:')
  console.log('  Call depositLendingPool() and send ~0.01 ETH (or more)')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
