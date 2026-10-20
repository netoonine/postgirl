import { useState } from 'react'
import { FileUp, Trash2 } from 'lucide-react'
import type { KV } from '@shared/types'
import { api } from '../api'
import { bulkToKv, kvToBulk } from '../util'
import { VarInput } from './VarInput'

/**
 * Tabela chave/valor com linha vazia no fim para adicionar, checkbox para desativar
 * e modo de edição em massa. Usada em params, headers, form-data e variáveis.
 */
export function KVTable({
  rows,
  onChange,
  title,
  description = true,
  files = false,
  keyPlaceholder = 'Chave',
  valuePlaceholder = 'Valor',
  readOnlyKeys = false,
  noAdd = false
}: {
  rows: KV[]
  onChange: (rows: KV[]) => void
  title?: string
  description?: boolean
  files?: boolean
  keyPlaceholder?: string
  valuePlaceholder?: string
  readOnlyKeys?: boolean
  noAdd?: boolean
}) {
  const [bulk, setBulk] = useState<string | null>(null)
  const list = noAdd ? rows : [...rows, { key: '', value: '' } as KV]

  const update = (i: number, patch: Partial<KV>) => {
    const next = rows.slice()
    if (i >= rows.length) next.push({ key: '', value: '', ...(files ? { type: 'text' } : {}), ...patch })
    else next[i] = { ...next[i], ...patch }
    onChange(next)
  }
  const remove = (i: number) => onChange(rows.filter((_, j) => j !== i))

  const pickFile = async (i: number) => {
    const p = await api.openFile({ title: 'Escolher arquivo', multi: true })
    if (p) update(i, { src: Array.isArray(p) && p.length === 1 ? p[0] : p, type: 'file', value: '' })
  }

  return (
    <div>
      <div className="kv-toolbar">
        <span>{title}</span>
        {!readOnlyKeys && (
          <button
            className="btn ghost sm"
            onClick={() => {
              if (bulk === null) setBulk(kvToBulk(rows))
              else {
                onChange(bulkToKv(bulk, rows))
                setBulk(null)
              }
            }}
          >
            {bulk === null ? 'Edição em massa' : 'Edição em tabela'}
          </button>
        )}
      </div>
      {bulk !== null ? (
        <>
          <textarea
            className="textarea mono"
            style={{ width: '100%', minHeight: 180 }}
            value={bulk}
            spellCheck={false}
            onChange={(e) => setBulk(e.target.value)}
            onBlur={() => onChange(bulkToKv(bulk, rows))}
            autoFocus
          />
          <div className="hint">Uma linha por item no formato chave:valor. Comece a linha com // para desativar.</div>
        </>
      ) : (
        <table className="kv">
          <thead>
            <tr>
              <th className="c-check" />
              <th>{keyPlaceholder}</th>
              <th>{valuePlaceholder}</th>
              {description && <th>Descrição</th>}
              <th className="c-act" />
            </tr>
          </thead>
          <tbody>
            {list.map((r, i) => {
              const isNew = i >= rows.length
              const isFile = files && r.type === 'file'
              return (
                <tr key={i} className={r.disabled ? 'disabled' : ''}>
                  <td className="c-check">
                    {!isNew && <input type="checkbox" checked={!r.disabled} onChange={(e) => update(i, { disabled: !e.target.checked || undefined })} />}
                  </td>
                  <td>
                    <div className="cell-flex">
                      {readOnlyKeys ? (
                        <span style={{ padding: '0 8px', fontSize: 12 }} className="mono">
                          {r.key}
                        </span>
                      ) : (
                        <VarInput cell value={r.key} placeholder={isNew ? keyPlaceholder : ''} onChange={(v) => update(i, { key: v })} />
                      )}
                      {files && (
                        <select
                          className="mini-select"
                          value={r.type === 'file' ? 'file' : 'text'}
                          onChange={(e) => update(i, { type: e.target.value, ...(e.target.value === 'text' ? { src: undefined } : {}) })}
                        >
                          <option value="text">Texto</option>
                          <option value="file">Arquivo</option>
                        </select>
                      )}
                    </div>
                  </td>
                  <td>
                    {isFile ? (
                      <div className="file-pick">
                        <button className="btn sm" onClick={() => pickFile(i)}>
                          <FileUp size={13} /> Escolher
                        </button>
                        <span title={String(r.src || '')}>
                          {r.src ? (Array.isArray(r.src) ? `${r.src.length} arquivos` : String(r.src).split('/').pop()) : 'Nenhum arquivo'}
                        </span>
                      </div>
                    ) : (
                      <VarInput cell value={r.value ?? ''} placeholder={isNew ? valuePlaceholder : ''} onChange={(v) => update(i, { value: v })} />
                    )}
                  </td>
                  {description && (
                    <td>
                      <input
                        className="cell-input"
                        value={r.description || ''}
                        placeholder={isNew ? 'Descrição' : ''}
                        onChange={(e) => update(i, { description: e.target.value || undefined })}
                      />
                    </td>
                  )}
                  <td className="c-act">
                    {!isNew && !readOnlyKeys && (
                      <button className="icon-btn sm row-del" title="Remover" onClick={() => remove(i)}>
                        <Trash2 size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
