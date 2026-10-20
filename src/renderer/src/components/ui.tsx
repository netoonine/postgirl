import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// ---------------- menu suspenso ----------------

export interface MenuItem {
  label?: string
  icon?: ReactNode
  onClick?: () => void
  danger?: boolean
  sep?: boolean
}

let closeOpenMenu: (() => void) | null = null

export function useMenu() {
  const [state, setState] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const open = (e: { clientX: number; clientY: number; preventDefault?: () => void; stopPropagation?: () => void }, items: MenuItem[]) => {
    e.preventDefault?.()
    e.stopPropagation?.()
    closeOpenMenu?.()
    setState({ x: e.clientX, y: e.clientY, items })
  }
  const openAt = (el: HTMLElement, items: MenuItem[]) => {
    const r = el.getBoundingClientRect()
    closeOpenMenu?.()
    setState({ x: r.left, y: r.bottom + 4, items })
  }
  const node = state ? <MenuPopup {...state} onClose={() => setState(null)} /> : null
  return { open, openAt, node, isOpen: !!state }
}

function MenuPopup({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect()
    setPos({ x: Math.min(x, innerWidth - r.width - 8), y: y + r.height > innerHeight - 8 ? Math.max(8, y - r.height) : y })
  }, [x, y])
  useEffect(() => {
    closeOpenMenu = onClose
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    setTimeout(() => document.addEventListener('mousedown', off))
    document.addEventListener('keydown', esc)
    window.addEventListener('blur', onClose)
    return () => {
      if (closeOpenMenu === onClose) closeOpenMenu = null
      document.removeEventListener('mousedown', off)
      document.removeEventListener('keydown', esc)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])
  return createPortal(
    <div className="menu" ref={ref} style={{ left: pos.x, top: pos.y }}>
      {items.map((it, i) =>
        it.sep ? (
          <div key={i} className="menu-sep" />
        ) : (
          <div
            key={i}
            className={`menu-item${it.danger ? ' danger' : ''}`}
            onClick={() => {
              onClose()
              it.onClick?.()
            }}
          >
            {it.icon}
            {it.label}
          </div>
        )
      )}
    </div>,
    document.body
  )
}

// ---------------- modal ----------------

export function Modal({
  title,
  children,
  footer,
  onClose,
  wide
}: {
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  onClose: () => void
  wide?: boolean
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`}>
        <div className="modal-head">{title}</div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}

// ---------------- redimensionar painéis ----------------

export function useResizable(key: string, initial: number, min: number, max: number, axis: 'x' | 'y', invert = false) {
  const [size, setSize] = useState<number>(() => {
    try {
      return Number(localStorage.getItem(`postwoman.size.${key}`)) || initial
    } catch {
      return initial
    }
  })
  const [dragging, setDragging] = useState(false)
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    const start = axis === 'x' ? e.clientX : e.clientY
    const startSize = size
    setDragging(true)
    const move = (ev: MouseEvent) => {
      const d = (axis === 'x' ? ev.clientX : ev.clientY) - start
      setSize(Math.min(max, Math.max(min, startSize + (invert ? -d : d))))
    }
    const up = () => {
      setDragging(false)
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      setSize((s) => {
        try {
          localStorage.setItem(`postwoman.size.${key}`, String(s))
        } catch {
          /* tamanho só não é lembrado */
        }
        return s
      })
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }
  return { size, onMouseDown, dragging }
}

export function SubTabs<T extends string>({
  tabs,
  value,
  onChange,
  right
}: {
  tabs: { id: T; label: ReactNode }[]
  value: T
  onChange: (v: T) => void
  right?: ReactNode
}) {
  return (
    <div className="subtabs">
      {tabs.map((t) => (
        <button key={t.id} className={`subtab${value === t.id ? ' active' : ''}`} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
      {right && <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>{right}</div>}
    </div>
  )
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.id} className={value === o.id ? 'active' : ''} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
