import { writeFileSync } from 'fs'
import { join } from 'path'
import { compileContract } from './compile-with-imports'

const c = compileContract('RWALendingVaultV4.sol', 'RWALendingVaultV4')
const outPath = join(process.cwd(), 'src', 'config', 'vaultAbiV4.ts')
writeFileSync(
  outPath,
  `// Auto-generated from RWALendingVaultV4 - do not edit manually\n` +
    `export const vaultAbiV4 = ${JSON.stringify(c.abi, null, 2)} as const\n`
)
console.log('Wrote', outPath)
