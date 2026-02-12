export const guestbookAbi = [
  {
    inputs: [{ name: '_content', type: 'string', internalType: 'string' }],
    name: 'post',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: '_id', type: 'uint256', internalType: 'uint256' }],
    name: 'getMessage',
    outputs: [
      { name: 'author', type: 'address', internalType: 'address' },
      { name: 'content', type: 'string', internalType: 'string' },
      { name: 'timestamp', type: 'uint256', internalType: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getTotalMessages',
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const
