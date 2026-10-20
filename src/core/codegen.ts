import type { CodegenLanguage, EnvValue, KV, PMAuth, PMRequest } from '@shared/types'

import codegen from 'postman-code-generators'
import sdk from 'postman-collection'

export function languages(): CodegenLanguage[] {
  return codegen.getLanguageList()
}

const authParam = (auth: PMAuth, key: string) => (auth[auth.type] || []).find((p: any) => p.key === key)?.value ?? ''

/** Os geradores não aplicam auth; viramos os tipos simples em header/query como o Postman faz. */
function applyAuth(req: any, auth?: PMAuth | null) {
  if (!auth) return
  if (auth.type === 'bearer') {
    req.header.push({ key: 'Authorization', value: `Bearer ${authParam(auth, 'token')}` })
  } else if (auth.type === 'basic') {
    const b64 = Buffer.from(`${authParam(auth, 'username')}:${authParam(auth, 'password')}`).toString('base64')
    req.header.push({ key: 'Authorization', value: `Basic ${b64}` })
  } else if (auth.type === 'apikey') {
    const k = authParam(auth, 'key')
    const v = authParam(auth, 'value')
    if (authParam(auth, 'in') === 'query') {
      const sep = req.url.raw.includes('?') ? '&' : '?'
      req.url = { raw: `${req.url.raw}${sep}${encodeURIComponent(k)}=${encodeURIComponent(v)}` }
    } else {
      req.header.push({ key: k, value: v })
    }
  } else if (auth.type === 'oauth2') {
    req.header.push({ key: 'Authorization', value: `Bearer ${authParam(auth, 'accessToken')}` })
  }
}

export function generate(o: { request: PMRequest; auth?: PMAuth | null; lang: string; variant: string; variables: (EnvValue | KV)[] }): Promise<string> {
  return new Promise((resolve, reject) => {
    const reqJson: any = JSON.parse(JSON.stringify(o.request))
    reqJson.header = (reqJson.header || []).filter((h: any) => !h.disabled)
    applyAuth(reqJson, o.auth)
    delete reqJson.auth

    // resolve {{variaveis}}: a última definição vence, como na precedência do Postman
    const vars: Record<string, string> = {}
    for (const v of o.variables) {
      if ((v as EnvValue).enabled === false || (v as KV).disabled) continue
      vars[v.key] = v.value
    }
    const resolved = sdk.Property.replaceSubstitutionsIn(reqJson, [vars])
    const url = resolved.url
    if (url && typeof url === 'object') {
      const parsed = sdk.Url.parse(url.raw)
      if (Array.isArray(url.query)) parsed.query = url.query.filter((q: any) => !q.disabled)
      if (Array.isArray(url.variable)) parsed.variable = url.variable
      resolved.url = parsed
    }
    const request = new sdk.Request(resolved)
    codegen.convert(
      o.lang,
      o.variant,
      request,
      { trimRequestBody: true, followRedirect: true, indentType: 'Space', indentCount: 2 },
      (err: any, snippet: string) => (err ? reject(err) : resolve(snippet))
    )
  })
}
