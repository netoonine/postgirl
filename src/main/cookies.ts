import fs from 'fs'
import { CookieJar } from '@postman/tough-cookie'
import type { CookieInfo } from '@shared/types'
import { cookieFile, writeJSON } from './storage'

let jar: CookieJar | null = null

export function getJar(): CookieJar {
  if (jar) return jar
  try {
    jar = CookieJar.deserializeSync(fs.readFileSync(cookieFile(), 'utf8'))
  } catch {
    jar = new CookieJar(undefined, { looseMode: true })
  }
  return jar!
}

/** Recarrega do disco (troca de pasta de trabalho). */
export function resetJar() {
  jar = null
}

export function persistJar() {
  if (jar) writeJSON(cookieFile(), jar.serializeSync())
}

export function toCookieInfo(c: any): CookieInfo {
  return {
    key: c.key ?? c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: c.expires && c.expires !== 'Infinity' ? new Date(c.expires).toISOString() : undefined,
    httpOnly: !!c.httpOnly,
    secure: !!c.secure
  }
}

export function listCookies(): CookieInfo[] {
  const data: any = getJar().serializeSync()
  return (data.cookies || []).map(toCookieInfo)
}

export function deleteCookie(domain: string, path: string, key: string) {
  const store: any = (getJar() as any).store
  store.removeCookie(domain, path, key, () => persistJar())
}

export function clearCookies(domain?: string) {
  const j = getJar() as any
  if (!domain) {
    j.removeAllCookiesSync()
  } else {
    for (const c of listCookies().filter((c) => c.domain === domain)) {
      j.store.removeCookie(c.domain, c.path, c.key, () => {})
    }
  }
  persistJar()
}
