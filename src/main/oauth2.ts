import { BrowserWindow } from 'electron'
import crypto from 'crypto'

export interface OAuth2Config {
  grant_type: 'authorization_code' | 'authorization_code_with_pkce' | 'client_credentials' | 'password' | 'implicit'
  authUrl?: string
  accessTokenUrl?: string
  clientId?: string
  clientSecret?: string
  scope?: string
  state?: string
  redirect_uri?: string
  username?: string
  password?: string
  client_authentication?: 'header' | 'body'
  audience?: string
}

export interface OAuth2Token {
  access_token?: string
  refresh_token?: string
  token_type?: string
  expires_in?: number
  id_token?: string
  error?: string
  raw?: any
}

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** Abre a tela de login do provedor e devolve a URL de callback quando o navegador chega nela. */
function captureRedirect(authUrl: string, redirectUri: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({ width: 520, height: 720, title: 'Login OAuth 2.0', webPreferences: { partition: 'oauth2' } })
    let done = false
    const check = (url: string, e?: { preventDefault: () => void }) => {
      if (done || !url.startsWith(redirectUri)) return
      done = true
      e?.preventDefault()
      resolve(url)
      win.close()
    }
    win.webContents.on('will-redirect', (e, url) => check(url, e))
    win.webContents.on('will-navigate', (e, url) => check(url, e))
    win.webContents.on('did-navigate', (_e, url) => check(url))
    win.on('closed', () => !done && reject(new Error('Janela de login fechada antes de concluir')))
    win.loadURL(authUrl)
  })
}

async function tokenRequest(c: OAuth2Config, params: Record<string, string>): Promise<OAuth2Token> {
  const body = new URLSearchParams(params)
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json'
  }
  if (c.client_authentication === 'body') {
    body.set('client_id', c.clientId || '')
    if (c.clientSecret) body.set('client_secret', c.clientSecret)
  } else {
    headers.Authorization = 'Basic ' + Buffer.from(`${c.clientId || ''}:${c.clientSecret || ''}`).toString('base64')
  }
  if (c.scope) body.set('scope', c.scope)
  if (c.audience) body.set('audience', c.audience)
  const res = await fetch(c.accessTokenUrl!, { method: 'POST', headers, body })
  const text = await res.text()
  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    json = Object.fromEntries(new URLSearchParams(text))
  }
  if (!res.ok || json.error) return { error: json.error_description || json.error || `HTTP ${res.status}`, raw: json }
  return { ...json, raw: json }
}

export async function getToken(c: OAuth2Config): Promise<OAuth2Token> {
  try {
    if (c.grant_type === 'client_credentials') return await tokenRequest(c, { grant_type: 'client_credentials' })
    if (c.grant_type === 'password') return await tokenRequest(c, { grant_type: 'password', username: c.username || '', password: c.password || '' })

    const redirect = c.redirect_uri || 'https://oauth.pstmn.io/v1/callback'
    const state = c.state || crypto.randomBytes(8).toString('hex')
    const u = new URL(c.authUrl!)
    u.searchParams.set('client_id', c.clientId || '')
    u.searchParams.set('redirect_uri', redirect)
    u.searchParams.set('state', state)
    if (c.scope) u.searchParams.set('scope', c.scope)
    if (c.audience) u.searchParams.set('audience', c.audience)

    if (c.grant_type === 'implicit') {
      u.searchParams.set('response_type', 'token')
      const back = new URL(await captureRedirect(u.toString(), redirect))
      const frag = new URLSearchParams(back.hash.slice(1))
      if (frag.get('error')) return { error: frag.get('error_description') || frag.get('error')! }
      return { access_token: frag.get('access_token') || '', token_type: frag.get('token_type') || 'bearer', raw: Object.fromEntries(frag) }
    }

    u.searchParams.set('response_type', 'code')
    let verifier = ''
    if (c.grant_type === 'authorization_code_with_pkce') {
      verifier = b64url(crypto.randomBytes(32))
      u.searchParams.set('code_challenge', b64url(crypto.createHash('sha256').update(verifier).digest()))
      u.searchParams.set('code_challenge_method', 'S256')
    }
    const back = new URL(await captureRedirect(u.toString(), redirect))
    if (back.searchParams.get('error')) return { error: back.searchParams.get('error_description') || back.searchParams.get('error')! }
    const params: Record<string, string> = {
      grant_type: 'authorization_code',
      code: back.searchParams.get('code') || '',
      redirect_uri: redirect
    }
    if (verifier) params.code_verifier = verifier
    return await tokenRequest(c, params)
  } catch (e: any) {
    return { error: e.message || String(e) }
  }
}
