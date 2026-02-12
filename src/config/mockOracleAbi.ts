export const mockOracleAbi = [
  {
    inputs: [],
    name: 'price',
    outputs: [{ name: '', type: 'int256', internalType: 'int256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'updatedAt',
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: '_price', type: 'int256', internalType: 'int256' }],
    name: 'setPrice',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const
