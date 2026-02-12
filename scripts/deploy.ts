import 'dotenv/config'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import solc from 'solc'
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { robinhoodChain } from '../src/config/chains'

const contractPath = join(process.cwd(), 'contracts', 'Guestbook.sol')
const source = readFileSync(contractPath, 'utf-8')

function compile() {
  const input = {
    language: 'Solidity',
    sources: { 'Guestbook.sol': { content: source } },
    settings: {
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } },
    },
  }
  const output = JSON.parse(solc.compile(JSON.stringify(input)))
  const err = output.errors?.find((e: { severity: string }) => e.severity === 'error')
  if (err) throw new Error(err.formattedMessage)
  return output.contracts['Guestbook.sol'].Guestbook
}

async function main() {
  let pk = process.env.PRIVATE_KEY?.trim()
  if (!pk) {
    console.error('Set PRIVATE_KEY in .env (e.g. PRIVATE_KEY=0xYourKey)')
    process.exit(1)
  }
  if (!pk.startsWith('0x')) pk = '0x' + pk

  const compiled = compile()
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
  })

  console.log('TX hash:', hash)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  const address = receipt.contractAddress!
  console.log('Guestbook deployed to:', address)
  console.log('Explorer:', `https://explorer.testnet.chain.robinhood.com/address/${address}`)

  const outPath = join(process.cwd(), 'src', 'config', 'deployed.json')
  writeFileSync(outPath, JSON.stringify({ guestbookAddress: address }, null, 2))
  console.log('Written to src/config/deployed.json')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
