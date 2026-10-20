// Cofre local para valores marcados como "secreto" em ambientes e globais.
// Os arquivos da pasta de trabalho (que podem ir para o git) guardam o valor vazio;
// o valor real fica aqui, criptografado com o Keychain do macOS / DPAPI do Windows / libsecret no Linux.
import { app, safeStorage } from 'electron'
import fs from 'fs'
import path from 'path'

type Vault = Record<string, Record<string, string>>

const file = () => path.join(app.getPath('userData'), 'secrets.json')
// testes automatizados não devem disparar o diálogo do Keychain
const useKeychain = () => !process.env.POSTGIRL_DISABLE_KEYCHAIN && safeStorage.isEncryptionAvailable()

let cache: Vault | null = null

function load(): Vault {
  if (cache) return cache
  try {
    cache = JSON.parse(fs.readFileSync(file(), 'utf8')).scopes || {}
  } catch {
    cache = {}
  }
  return cache!
}

function persist() {
  const tmp = `${file()}.${process.pid}.tmp`
  fs.mkdirSync(path.dirname(tmp), { recursive: true })
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, scopes: load() }, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, file())
}

function encode(value: string) {
  return useKeychain() ? `enc:${safeStorage.encryptString(value).toString('base64')}` : `b64:${Buffer.from(value).toString('base64')}`
}

function decode(stored: string): string | undefined {
  try {
    if (stored.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
    if (stored.startsWith('b64:')) return Buffer.from(stored.slice(4), 'base64').toString()
  } catch {
    // chave do Keychain diferente (outro usuário, app reinstalado): o valor se perde, o resto segue
  }
  return undefined
}

export function getScope(scope: string): Record<string, string> {
  const entries = load()[scope] || {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(entries)) {
    const d = decode(v)
    if (d !== undefined) out[k] = d
  }
  return out
}

/** Substitui todos os segredos de um escopo; só regrava o arquivo quando algo mudou. */
export function setScope(scope: string, values: Record<string, string>) {
  const current = getScope(scope)
  const same = Object.keys(values).length === Object.keys(current).length && Object.entries(values).every(([k, v]) => current[k] === v)
  if (same) return
  const vault = load()
  if (Object.keys(values).length) vault[scope] = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, encode(v)]))
  else delete vault[scope]
  persist()
}

export function deleteScope(scope: string) {
  const vault = load()
  if (!vault[scope]) return
  delete vault[scope]
  persist()
}
