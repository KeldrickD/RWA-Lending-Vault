import 'dotenv/config'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createWalletClient, createPublicClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { robinhoodChain } from '../src/config/chains'
import { encodeFunctionData } from 'viem'
import { vaultAbi } from '../src/config/vaultAbi'

const deployed = JSON.parse(readFileSync(join(process.cwd(), 'src', 'config', 'deployed.json'), 'utf-8'))
const VAULT = deployed.vaultAddress as `0x${string}`

async function main() {
  const pk = process.env.PRIVATE_KEY?.trim()
  if (!pk) {
    console.error('Set PRIVATE_KEY in .env')
    process.exit(1)
  }
  const key = pk.startsWith('0x') ? pk : '0x' + pk
  const amount = process.argv[2] || '0.01'
  const value = BigInt(parseFloat(amount) * 1e18)

  const account = privateKeyToAccount(key as `0x${string}`)
  const client = createWalletClient({
    account,
    chain: robinhoodChain,
    transport: http('https://rpc.testnet.chain.robinhood.com'),
  })!
  const publicClient = createPublicClient({ chain: robinhoodChain, transport: http('https://rpc.testnet.chain.robinhood.com') })

  console.log('Funding vault with', amount, 'ETH (owner only)...')
  const hash = await client.sendTransaction({
    to: VAULT,
    value,
    data: encodeFunctionData({ abi: vaultAbi, functionName: 'depositLendingPool' }),
    account,
  })
  console.log('TX:', hash)
  await publicClient.waitForTransactionReceipt({ hash })
  console.log('Done!')
}

main().catch(console.error)
