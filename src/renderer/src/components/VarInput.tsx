import { createContext, KeyboardEvent, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { isDynamicVar, ResolvedVar } from '../util'

export const VarsContext = createContext<Map<string, ResolvedVar>>(new Map())

const SOURCE_LABEL = { global: 'Global', collection: 'Coleção', environment: 'Ambiente' }

const DYNAMIC_VARS = [
  '$guid',
  '$randomUUID',
  '$timestamp',
  '$isoTimestamp',
  '$randomInt',
  '$randomEmail',
  '$randomFirstName',
  '$randomLastName',
  '$randomFullName',
  '$randomCity',
  '$randomColor',
  '$randomBoolean',
  '$randomPrice',
  '$randomWord',
  '$randomLoremSentence'
]

function Highlighted({ text, vars }: { text: string; vars: Map<string, ResolvedVar> }) {
  const parts: React.ReactNode[] = []
  const re = /\{\{([^{}]*)\}\}/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(<span key={last}>{text.slice(last, m.index)}</span>)
    const name = m[1].trim()
    const v = vars.get(name)
    const ok = !!v || isDynamicVar(name)
    parts.push(
      <span
        key={m.index}
        className={`tok-var${ok ? '' : ' bad'}`}
        title={v ? `${SOURCE_LABEL[v.source]}: ${v.value}` : ok ? 'Variável dinâmica' : 'Variável não definida'}
      >
        {m[0]}
      </span>
    )
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(<span key={last}>{text.slice(last)}</span>)
  return <>{parts}</>
}

/**
 * Campo de uma linha que destaca {{variaveis}} (verde = definida, vermelho = não definida)
 * e sugere variáveis ao digitar "{{".
 */
export function VarInput({
  value,
  onChange,
  placeholder,
  cell,
  onEnter,
  autoFocus
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  cell?: boolean
  onEnter?: () => void
  autoFocus?: boolean
}) {
  const vars = useContext(VarsContext)
  const inputRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const [suggest, setSuggest] = useState<{ query: string; start: number; sel: number } | null>(null)
  const [popPos, setPopPos] = useState({ x: 0, y: 0 })

  const syncScroll = () => {
    if (overlayRef.current && inputRef.current) overlayRef.current.scrollLeft = inputRef.current.scrollLeft
  }
  useLayoutEffect(syncScroll)

  const options = suggest
    ? [
        ...[...vars.entries()].map(([k, v]) => ({ key: k, hint: `${SOURCE_LABEL[v.source]} · ${v.value}` })),
        ...DYNAMIC_VARS.map((k) => ({ key: k, hint: 'dinâmica' }))
      ]
        .filter((o) => o.key.toLowerCase().includes(suggest.query.toLowerCase()))
        .slice(0, 40)
    : []

  const detect = (text: string, caret: number) => {
    const before = text.slice(0, caret)
    const open = before.lastIndexOf('{{')
    if (open >= 0 && !before.slice(open).includes('}}')) {
      const r = inputRef.current!.getBoundingClientRect()
      setPopPos({ x: r.left, y: r.bottom + 4 })
      setSuggest((s) => ({ query: before.slice(open + 2), start: open, sel: s?.sel ?? 0 }))
    } else setSuggest(null)
  }

  const pick = (key: string) => {
    if (!suggest) return
    const caret = inputRef.current!.selectionStart ?? value.length
    let after = value.slice(caret)
    if (after.startsWith('}}')) after = after.slice(2)
    const next = `${value.slice(0, suggest.start)}{{${key}}}${after}`
    onChange(next)
    setSuggest(null)
    const pos = suggest.start + key.length + 4
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(pos, pos))
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (suggest && options.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        return setSuggest({ ...suggest, sel: (suggest.sel + 1) % options.length })
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        return setSuggest({ ...suggest, sel: (suggest.sel - 1 + options.length) % options.length })
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        return pick(options[Math.min(suggest.sel, options.length - 1)].key)
      }
      if (e.key === 'Escape') return setSuggest(null)
    }
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && onEnter) {
      e.preventDefault()
      onEnter()
    }
  }

  useEffect(() => {
    if (!suggest) return
    const close = () => setSuggest(null)
    window.addEventListener('blur', close)
    return () => window.removeEventListener('blur', close)
  }, [suggest])

  return (
    <div className={`var-input${cell ? ' cell' : ''}`}>
      <div className="overlay" ref={overlayRef}>
        <span>
          <Highlighted text={value} vars={vars} />
          {'​'}
        </span>
      </div>
      <input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoFocus={autoFocus}
        onChange={(e) => {
          onChange(e.target.value)
          detect(e.target.value, e.target.selectionStart ?? e.target.value.length)
        }}
        onKeyDown={onKeyDown}
        onScroll={syncScroll}
        onSelect={syncScroll}
        onBlur={() => setTimeout(() => setSuggest(null), 150)}
      />
      {suggest &&
        options.length > 0 &&
        createPortal(
          <div className="var-pop" style={{ left: popPos.x, top: popPos.y }}>
            {options.map((o, i) => (
              <div key={o.key} className={`opt${i === suggest.sel ? ' sel' : ''}`} onMouseDown={(e) => (e.preventDefault(), pick(o.key))}>
                <span className="mono">{o.key}</span>
                <small>{o.hint}</small>
              </div>
            ))}
          </div>,
          document.body
        )}
    </div>
  )
}
