import { FileUp } from 'lucide-react'
import type { BodyMode, PMBody, RawLanguage } from '@shared/types'
import { api } from '../api'
import { CodeEditor } from './CodeEditor'
import { KVTable } from './KVTable'

const MODES: [BodyMode, string][] = [
  ['none', 'nenhum'],
  ['formdata', 'form-data'],
  ['urlencoded', 'x-www-form-urlencoded'],
  ['raw', 'raw'],
  ['file', 'binário'],
  ['graphql', 'GraphQL']
]

const LANGS: [RawLanguage, string][] = [
  ['json', 'JSON'],
  ['text', 'Texto'],
  ['javascript', 'JavaScript'],
  ['html', 'HTML'],
  ['xml', 'XML']
]

export function BodyEditor({ body, onChange }: { body?: PMBody; onChange: (b: PMBody) => void }) {
  const b: PMBody = body || { mode: 'none' }
  const mode = b.mode || 'none'
  const lang = b.options?.raw?.language || 'text'

  const beautify = () => {
    try {
      onChange({ ...b, raw: JSON.stringify(JSON.parse(b.raw || ''), null, 2) })
    } catch {
      /* JSON inválido: deixa como está */
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
      <div className="radio-row">
        {MODES.map(([m, label]) => (
          <label key={m} className="check">
            <input type="radio" name="body-mode" checked={mode === m} onChange={() => onChange({ ...b, mode: m })} />
            {label}
          </label>
        ))}
        {mode === 'raw' && (
          <>
            <select
              className="select sm"
              value={lang}
              onChange={(e) => onChange({ ...b, options: { ...b.options, raw: { language: e.target.value as RawLanguage } } })}
            >
              {LANGS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            {lang === 'json' && (
              <button className="btn ghost sm" onClick={beautify}>
                Formatar
              </button>
            )}
          </>
        )}
      </div>

      {mode === 'none' && <div className="hint">Esta requisição não tem corpo.</div>}
      {mode === 'raw' && (
        <div className="editor-box">
          <CodeEditor value={b.raw || ''} lang={lang as any} onChange={(raw) => onChange({ ...b, raw })} />
        </div>
      )}
      {mode === 'urlencoded' && <KVTable rows={b.urlencoded || []} onChange={(urlencoded) => onChange({ ...b, urlencoded })} />}
      {mode === 'formdata' && <KVTable files rows={b.formdata || []} onChange={(formdata) => onChange({ ...b, formdata })} />}
      {mode === 'file' && (
        <div className="file-pick" style={{ padding: 0 }}>
          <button
            className="btn"
            onClick={async () => {
              const p = await api.openFile({ title: 'Arquivo do corpo' })
              if (p) onChange({ ...b, file: { src: p as string } })
            }}
          >
            <FileUp size={14} /> Escolher arquivo
          </button>
          <span>{b.file?.src || 'Nenhum arquivo selecionado'}</span>
        </div>
      )}
      {mode === 'graphql' && (
        <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 10, flex: 1, minHeight: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div className="hint" style={{ marginBottom: 4 }}>
              Query
            </div>
            <div className="editor-box">
              <CodeEditor
                value={b.graphql?.query || ''}
                lang="javascript"
                placeholder="query { ... }"
                onChange={(query) => onChange({ ...b, graphql: { variables: b.graphql?.variables, query } })}
              />
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div className="hint" style={{ marginBottom: 4 }}>
              Variáveis GraphQL (JSON)
            </div>
            <div className="editor-box">
              <CodeEditor
                value={b.graphql?.variables || ''}
                lang="json"
                placeholder="{}"
                onChange={(variables) => onChange({ ...b, graphql: { query: b.graphql?.query || '', variables } })}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
