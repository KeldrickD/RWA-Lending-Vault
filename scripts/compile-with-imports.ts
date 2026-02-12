import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import solc from 'solc'

const ROOT = process.cwd()
const NODE_MODULES = join(ROOT, 'node_modules')

function extractImports(source: string): string[] {
  const imports: string[] = []
  const re = /import\s+(?:(?:{[^}]+}\s+from\s+)?)["']([^"']+)["']\s*;/g
  let m
  while ((m = re.exec(source)) !== null) imports.push(m[1])
  return imports
}

function resolveImport(imp: string, fromPath: string): string | null {
  if (imp.startsWith('@openzeppelin/')) {
    const p = join(NODE_MODULES, imp)
    return existsSync(p) ? p : null
  }
  const baseDir = dirname(fromPath)
  const resolved = join(baseDir, imp)
  return existsSync(resolved) ? resolved : null
}

function getSourceKey(fullPath: string): string {
  const n = fullPath.replace(/\\/g, '/')
  const root = ROOT.replace(/\\/g, '/')
  const oz = 'node_modules/@openzeppelin/contracts/'
  const idx = n.indexOf(oz)
  if (idx >= 0) return '@openzeppelin/contracts/' + n.slice(idx + oz.length)
  return n.startsWith(root) ? n.slice(root.length + 1) : n
}

function collectSources(entryPath: string, sources: Record<string, string> = {}): Record<string, string> {
  const fullPath = entryPath.startsWith(ROOT) ? entryPath : join(ROOT, entryPath)
  if (!existsSync(fullPath)) throw new Error(`Not found: ${entryPath}`)
  const content = readFileSync(fullPath, 'utf-8')
  const key = getSourceKey(fullPath)
  if (sources[key]) return sources
  sources[key] = content
  for (const imp of extractImports(content)) {
    const resolved = resolveImport(imp, fullPath)
    if (resolved) {
      const resolvedKey = getSourceKey(resolved)
      if (!sources[resolvedKey]) collectSources(resolved, sources)
    }
  }
  return sources
}

export function compileContract(entryFile: string, contractName: string) {
  const entryPath = entryFile.startsWith('contracts/') ? entryFile : `contracts/${entryFile}`
  const entryFull = join(ROOT, entryPath)
  const sources = collectSources(entryFull)
  const entryKey = entryPath.replace(/\\/g, '/')
  const input = {
    language: 'Solidity' as const,
    sources: Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, { content: v }])),
    settings: {
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } },
      optimizer: { enabled: true, runs: 200 },
    },
  }
  const output = JSON.parse(solc.compile(JSON.stringify(input)))
  const err = output.errors?.find((e: { severity: string }) => e.severity === 'error')
  if (err) throw new Error(err.formattedMessage)
  const contracts = output.contracts[entryKey] ?? output.contracts[Object.keys(output.contracts)[0]!]
  const contract = contracts?.[contractName] ?? Object.values(contracts as object)[0]
  if (!contract) throw new Error(`Contract ${contractName} not found`)
  return contract as { abi: unknown[]; evm: { bytecode: { object: string } } }
}
