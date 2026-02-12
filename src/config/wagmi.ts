import { createConfig, http } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { robinhoodChain } from './chains'

const RPC_URL = 'https://rpc.testnet.chain.robinhood.com'

export const wagmiConfig = createConfig({
  chains: [robinhoodChain],
  connectors: [
    injected({ target: 'metaMask' }),
    injected({ target: 'phantom' }),
  ],
  transports: {
    [robinhoodChain.id]: http(RPC_URL, { batch: true }),
  },
})
