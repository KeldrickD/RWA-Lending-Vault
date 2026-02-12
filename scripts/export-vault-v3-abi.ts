import { writeFileSync } from 'fs'
import { join } from 'path'
import { compileContract } from './compile-with-imports'

const c = compileContract('RWALendingVaultV3.sol', 'RWALendingVaultV3')
const outPath = join(process.cwd(), 'src', 'config', 'vaultAbiV3.ts')
writeFileSync(
  outPath,
  `// Auto-generated from RWALendingVaultV3 - do not edit manually\n` +
    `export const vaultAbiV3 = ${JSON.stringify(c.abi, null, 2)} as const\n`
)
console.log('Wrote', outPath)
