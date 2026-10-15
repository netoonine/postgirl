import { useState } from 'react'
import type { PMAuth } from '@shared/types'
import { api } from '../api'
import { toast } from '../store'
import { VarInput } from './VarInput'

interface Field {
  key: string
  label: string
  kind?: 'text' | 'select' | 'bool' | 'textarea'
  options?: [string, string][]
  placeholder?: string
  advanced?: boolean
}

const AUTH_TYPES: [string, string][] = [
  ['inherit', 'Herdar do pai'],
  ['noauth', 'Sem autenticação'],
  ['basic', 'Basic Auth'],
  ['bearer', 'Bearer Token'],
  ['apikey', 'API Key'],
  ['jwt', 'JWT Bearer'],
  ['digest', 'Digest Auth'],
  ['oauth1', 'OAuth 1.0'],
  ['oauth2', 'OAuth 2.0'],
  ['hawk', 'Hawk'],
  ['awsv4', 'AWS Signature'],
  ['ntlm', 'NTLM'],
  ['edgegrid', 'Akamai EdgeGrid']
]

const FIELDS: Record<string, Field[]> = {
  basic: [
    { key: 'username', label: 'Usuário' },
    { key: 'password', label: 'Senha' }
  ],
  bearer: [{ key: 'token', label: 'Token' }],
  apikey: [
    { key: 'key', label: 'Chave' },
    { key: 'value', label: 'Valor' },
    { key: 'in', label: 'Enviar em', kind: 'select', options: [['header', 'Header'], ['query', 'Query params']] }
  ],
  jwt: [
    { key: 'algorithm', label: 'Algoritmo', kind: 'select', options: ['HS256', 'HS384', 'HS512', 'RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512'].map((a) => [a, a]) },
    { key: 'secret', label: 'Segredo / chave privada', kind: 'textarea' },
    { key: 'isSecretBase64Encoded', label: 'Segredo em Base64', kind: 'bool' },
    { key: 'payload', label: 'Payload (JSON)', kind: 'textarea' },
    { key: 'addTokenTo', label: 'Enviar em', kind: 'select', options: [['header', 'Header'], ['queryParam', 'Query param']] },
    { key: 'headerPrefix', label: 'Prefixo do header', placeholder: 'Bearer', advanced: true },
    { key: 'queryParamKey', label: 'Nome do query param', placeholder: 'token', advanced: true },
    { key: 'header', label: 'Headers JWT (JSON)', kind: 'textarea', advanced: true }
  ],
  digest: [
    { key: 'username', label: 'Usuário' },
    { key: 'password', label: 'Senha' },
    { key: 'realm', label: 'Realm', advanced: true },
    { key: 'nonce', label: 'Nonce', advanced: true },
    { key: 'algorithm', label: 'Algoritmo', kind: 'select', options: ['MD5', 'MD5-sess', 'SHA-256', 'SHA-256-sess', 'SHA-512-256', 'SHA-512-256-sess'].map((a) => [a, a]), advanced: true },
    { key: 'qop', label: 'qop', advanced: true },
    { key: 'nonceCount', label: 'Nonce count', advanced: true },
    { key: 'clientNonce', label: 'Client nonce', advanced: true },
    { key: 'opaque', label: 'Opaque', advanced: true }
  ],
  oauth1: [
    { key: 'signatureMethod', label: 'Método de assinatura', kind: 'select', options: ['HMAC-SHA1', 'HMAC-SHA256', 'HMAC-SHA512', 'RSA-SHA1', 'RSA-SHA256', 'RSA-SHA512', 'PLAINTEXT'].map((a) => [a, a]) },
    { key: 'consumerKey', label: 'Consumer key' },
    { key: 'consumerSecret', label: 'Consumer secret' },
    { key: 'token', label: 'Access token' },
    { key: 'tokenSecret', label: 'Token secret' },
    { key: 'addParamsToHeader', label: 'Enviar no header', kind: 'bool' },
    { key: 'callback', label: 'Callback URL', advanced: true },
    { key: 'verifier', label: 'Verifier', advanced: true },
    { key: 'timestamp', label: 'Timestamp', advanced: true },
    { key: 'nonce', label: 'Nonce', advanced: true },
    { key: 'version', label: 'Versão', advanced: true },
    { key: 'realm', label: 'Realm', advanced: true },
    { key: 'addEmptyParamsToSign', label: 'Incluir params vazios na assinatura', kind: 'bool', advanced: true }
  ],
  hawk: [
    { key: 'authId', label: 'Hawk Auth ID' },
    { key: 'authKey', label: 'Hawk Auth Key' },
    { key: 'algorithm', label: 'Algoritmo', kind: 'select', options: [['sha256', 'sha256'], ['sha1', 'sha1']] },
    { key: 'user', label: 'Usuário', advanced: true },
    { key: 'nonce', label: 'Nonce', advanced: true },
    { key: 'extraData', label: 'ext', advanced: true },
    { key: 'app', label: 'app', advanced: true },
    { key: 'delegation', label: 'dlg', advanced: true },
    { key: 'timestamp', label: 'Timestamp', advanced: true },
    { key: 'includePayloadHash', label: 'Incluir hash do payload', kind: 'bool', advanced: true }
  ],
  awsv4: [
    { key: 'accessKey', label: 'Access key' },
    { key: 'secretKey', label: 'Secret key' },
    { key: 'region', label: 'Região', placeholder: 'us-east-1' },
    { key: 'service', label: 'Serviço', placeholder: 's3' },
    { key: 'sessionToken', label: 'Session token', advanced: true },
    { key: 'addAuthDataToQuery', label: 'Assinar na query (presigned)', kind: 'bool', advanced: true }
  ],
  ntlm: [
    { key: 'username', label: 'Usuário' },
    { key: 'password', label: 'Senha' },
    { key: 'domain', label: 'Domínio', advanced: true },
    { key: 'workstation', label: 'Workstation', advanced: true }
  ],
  edgegrid: [
    { key: 'accessToken', label: 'Access token' },
    { key: 'clientToken', label: 'Client token' },
    { key: 'clientSecret', label: 'Client secret' },
    { key: 'baseURL', label: 'Base URL', advanced: true },
    { key: 'nonce', label: 'Nonce', advanced: true },
    { key: 'timestamp', label: 'Timestamp', advanced: true },
    { key: 'headersToSign', label: 'Headers a assinar', advanced: true }
  ],
  oauth2: [
    { key: 'accessToken', label: 'Access token' },
    { key: 'addTokenTo', label: 'Enviar em', kind: 'select', options: [['header', 'Header'], ['queryParams', 'Query params']] },
    { key: 'headerPrefix', label: 'Prefixo do header', placeholder: 'Bearer' }
  ]
}

const OAUTH2_CONFIG: Field[] = [
  {
    key: 'grant_type',
    label: 'Grant type',
    kind: 'select',
    options: [
      ['authorization_code', 'Authorization Code'],
      ['authorization_code_with_pkce', 'Authorization Code (PKCE)'],
      ['implicit', 'Implicit'],
      ['password', 'Password Credentials'],
      ['client_credentials', 'Client Credentials']
    ]
  },
  { key: 'authUrl', label: 'Auth URL' },
  { key: 'accessTokenUrl', label: 'Access token URL' },
  { key: 'redirect_uri', label: 'Callback URL', placeholder: 'https://oauth.pstmn.io/v1/callback' },
  { key: 'clientId', label: 'Client ID' },
  { key: 'clientSecret', label: 'Client secret' },
  { key: 'scope', label: 'Scope' },
  { key: 'audience', label: 'Audience' },
  { key: 'state', label: 'State' },
  { key: 'username', label: 'Usuário' },
  { key: 'password', label: 'Senha' },
  { key: 'client_authentication', label: 'Credenciais do cliente', kind: 'select', options: [['header', 'Basic Auth header'], ['body', 'No corpo']] }
]

const DEFAULTS: Record<string, Record<string, any>> = {
  apikey: { in: 'header' },
  jwt: { algorithm: 'HS256', addTokenTo: 'header', headerPrefix: 'Bearer', payload: '{}', header: '{}' },
  digest: { algorithm: 'MD5' },
  oauth1: { signatureMethod: 'HMAC-SHA1', addParamsToHeader: true, version: '1.0' },
  hawk: { algorithm: 'sha256' },
  oauth2: { addTokenTo: 'header', headerPrefix: 'Bearer', grant_type: 'authorization_code', client_authentication: 'header' }
}

const get = (auth: PMAuth, k: string) => (auth[auth.type] as any[])?.find((p) => p.key === k)?.value

function setParam(auth: PMAuth, k: string, v: any): PMAuth {
  const params = ((auth[auth.type] as any[]) || []).filter((p) => p.key !== k)
  params.push({ key: k, value: v, type: typeof v === 'boolean' ? 'boolean' : 'string' })
  return { ...auth, [auth.type]: params }
}

function FieldInput({ f, auth, onChange }: { f: Field; auth: PMAuth; onChange: (a: PMAuth) => void }) {
  const v = get(auth, f.key)
  if (f.kind === 'bool')
    return (
      <label className="check">
        <input type="checkbox" checked={v === true || v === 'true'} onChange={(e) => onChange(setParam(auth, f.key, e.target.checked))} />
      </label>
    )
  if (f.kind === 'select')
    return (
      <select className="select" value={v ?? f.options![0][0]} onChange={(e) => onChange(setParam(auth, f.key, e.target.value))}>
        {f.options!.map(([val, label]) => (
          <option key={val} value={val}>
            {label}
          </option>
        ))}
      </select>
    )
  if (f.kind === 'textarea')
    return <textarea className="textarea mono" rows={4} value={v ?? ''} spellCheck={false} onChange={(e) => onChange(setParam(auth, f.key, e.target.value))} />
  return (
    <div className="urlbar-field" style={{ borderRadius: 7 }}>
      <VarInput cell value={v ?? ''} placeholder={f.placeholder} onChange={(val) => onChange(setParam(auth, f.key, val))} />
    </div>
  )
}

export function AuthEditor({
  auth,
  onChange,
  canInherit = true,
  inheritedFrom
}: {
  auth: PMAuth | null | undefined
  onChange: (a: PMAuth | null) => void
  canInherit?: boolean
  inheritedFrom?: { type?: string; from: string }
}) {
  const cur: PMAuth = auth || { type: canInherit ? 'inherit' : 'noauth' }
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  const fields = FIELDS[cur.type] || []

  const changeType = (type: string) => {
    if (type === 'inherit') return onChange(null)
    let next: PMAuth = { type, [type]: cur[type] || [] }
    for (const [k, v] of Object.entries(DEFAULTS[type] || {})) if (get(next, k) === undefined) next = setParam(next, k, v)
    onChange(next)
  }

  const getToken = async () => {
    const cfg = Object.fromEntries(OAUTH2_CONFIG.map((f) => [f.key, get(cur, f.key)]))
    setBusy(true)
    const tok = await api.oauth2Token(cfg)
    setBusy(false)
    if (tok.error) return toast(`OAuth 2.0: ${tok.error}`, 'error')
    let next = setParam(cur, 'accessToken', tok.access_token || '')
    if (tok.refresh_token) next = setParam(next, 'refreshToken', tok.refresh_token)
    onChange(next)
    toast('Token obtido e aplicado')
  }

  const typeLabel = (t?: string) => AUTH_TYPES.find(([k]) => k === t)?.[1] || t

  return (
    <div className="auth-layout">
      <div>
        <div className="field">
          <span>Tipo</span>
          <select className="select" value={cur.type} onChange={(e) => changeType(e.target.value)}>
            {AUTH_TYPES.filter(([k]) => canInherit || k !== 'inherit').map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <p className="hint">
          A autenticação é aplicada na hora do envio. Use {'{{variaveis}}'} para não deixar segredos gravados na coleção.
        </p>
      </div>
      <div>
        {cur.type === 'inherit' && (
          <div className="callout">
            {inheritedFrom?.type ? (
              <>
                Esta requisição usa <b>{typeLabel(inheritedFrom.type)}</b> herdado de <b>{inheritedFrom.from}</b>.
              </>
            ) : (
              'Herda a autenticação da pasta ou coleção. Nenhum pai define autenticação no momento.'
            )}
          </div>
        )}
        {cur.type === 'noauth' && <div className="callout">Nenhuma autenticação será enviada.</div>}
        {fields.length > 0 && (
          <div className="form-grid">
            {fields
              .filter((f) => !f.advanced || showAdvanced)
              .map((f) => (
                <FieldRow key={f.key} f={f} auth={cur} onChange={onChange} />
              ))}
            {fields.some((f) => f.advanced) && (
              <div className="full">
                <button className="btn ghost sm" onClick={() => setShowAdvanced(!showAdvanced)}>
                  {showAdvanced ? 'Ocultar opções avançadas' : 'Mostrar opções avançadas'}
                </button>
              </div>
            )}
          </div>
        )}
        {cur.type === 'oauth2' && (
          <>
            <h4 style={{ margin: '22px 0 10px', fontSize: 13 }}>Obter novo token</h4>
            <div className="form-grid">
              {OAUTH2_CONFIG.filter((f) => {
                const g = get(cur, 'grant_type') || 'authorization_code'
                if (['authUrl', 'redirect_uri', 'state'].includes(f.key)) return g.startsWith('authorization_code') || g === 'implicit'
                if (f.key === 'accessTokenUrl') return g !== 'implicit'
                if (['username', 'password'].includes(f.key)) return g === 'password'
                return true
              }).map((f) => (
                <FieldRow key={f.key} f={f} auth={cur} onChange={onChange} />
              ))}
              <div className="full">
                <button className="btn primary" disabled={busy} onClick={getToken}>
                  {busy ? 'Obtendo…' : 'Obter token'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function FieldRow(props: { f: Field; auth: PMAuth; onChange: (a: PMAuth) => void }) {
  return (
    <>
      <label>{props.f.label}</label>
      <FieldInput {...props} />
    </>
  )
}
