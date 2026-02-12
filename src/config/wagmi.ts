import { createConfig, http } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { robinhoodChain } from './chains'

export const wagmiConfig = createConfig({
  chains: [robinhoodChain],
  connectors: [
    injected({ target: 'metaMask' }),
    injected({ target: 'phantom' }),
  ],
  transports: {
    [robinhoodChain.id]: http(),
  },
})
