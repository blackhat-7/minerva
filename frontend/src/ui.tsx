// Shared UI primitives. Touch targets are >= 44px for iPhone and iPad.
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react'
import { Icon, type IconName } from './icons'

/** Classes for text inputs and textareas. */
export const field =
  'w-full rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-base text-fg placeholder:text-muted/70 transition focus:border-accent/60 focus:bg-white/[0.05] focus:outline-none'

/** A small accent label above a heading. */
export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`text-sm font-medium text-accent ${className}`}>{children}</div>
}

const buttonStyles = {
  default: 'bg-white/[0.07] text-fg hover:bg-white/[0.11]',
  primary: 'bg-fg text-bg font-medium hover:bg-white',
  ghost: 'text-fg hover:bg-white/[0.07]',
}

export function Button({
  variant = 'default',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof buttonStyles }) {
  return (
    <button
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm transition duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-35 ${buttonStyles[variant]} ${className}`}
      {...rest}
    />
  )
}

/** A round icon-only button; `label` is its accessible name and tooltip. */
export function IconButton({
  icon,
  label,
  variant = 'ghost',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; variant?: keyof typeof buttonStyles }) {
  return (
    <Button variant={variant} aria-label={label} title={label} className={`w-11 px-0 ${className}`} {...rest}>
      <Icon name={icon} />
    </Button>
  )
}

export function Panel({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-3xl border border-white/[0.06] bg-surface p-5 ${className}`} {...rest} />
}

/** Labeled range input. `format` renders the current value (units, SI prefixes). */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format = String,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  format?: (v: number) => string
}) {
  return (
    <label className="flex min-h-11 flex-col justify-center gap-1.5 text-sm">
      <span className="flex justify-between gap-2 text-muted">
        <span>{label}</span>
        <span className="tabular font-mono text-fg">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-6 w-full cursor-pointer"
      />
    </label>
  )
}

/** Segmented control for a small set of options. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label?: string
  value: T
  options: readonly T[] | { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  const opts = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      {label && <span className="text-muted">{label}</span>}
      <div className="flex flex-wrap gap-0.5 rounded-full bg-white/[0.05] p-1">
        {opts.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            aria-pressed={o.value === value}
            className={`min-h-9 flex-1 rounded-full px-3 whitespace-nowrap transition duration-150 ${
              o.value === value ? 'bg-white/[0.12] text-fg shadow-sm shadow-black/40' : 'text-muted hover:text-fg'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** A labeled metric. */
export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'good' | 'warn' | 'bad' }) {
  const color = tone ? { good: 'text-good', warn: 'text-warn', bad: 'text-bad' }[tone] : 'text-fg'
  return (
    <div className="flex flex-col gap-0.5 rounded-2xl bg-white/[0.03] px-3.5 py-2.5">
      <span className="text-xs text-muted">{label}</span>
      <span className={`tabular font-mono text-[15px] ${color}`}>{value}</span>
    </div>
  )
}

/** Inline error with an optional retry. */
export function ErrorNote({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-2xl bg-bad/10 py-1 pr-1 pl-4 text-sm">
      <span className="py-2 text-bad">{error}</span>
      {onRetry && (
        <Button variant="ghost" onClick={onRetry} className="shrink-0">
          Retry
        </Button>
      )}
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-2xl bg-white/[0.04] ${className}`} />
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      aria-label="Loading"
      className={`inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent ${className}`}
    />
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="hidden rounded-md border border-current/25 px-1.5 font-mono text-[11px] opacity-60 lg:inline">{children}</kbd>
  )
}

/** A floating status pill, shown above the lesson dock. */
export function Notice({ children, tone = '' }: { children: ReactNode; tone?: string }) {
  return (
    <div
      role="status"
      className={`pointer-events-auto flex max-w-[min(32rem,calc(100vw-1.5rem))] animate-enter items-center gap-2 rounded-full border border-white/[0.08] bg-raised/90 px-4 py-2 text-sm shadow-xl shadow-black/50 backdrop-blur-xl ${tone}`}
    >
      {children}
    </div>
  )
}

/** On/off switch row, for settings menus. */
export function Switch({ on, onChange, children }: { on: boolean; onChange: (on: boolean) => void; children: ReactNode }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex min-h-11 w-full items-center justify-between gap-4 rounded-xl px-3 text-left text-sm transition hover:bg-white/[0.06]"
    >
      {children}
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${on ? 'bg-accent' : 'bg-white/[0.12]'}`}>
        <span
          className={`absolute top-0.5 size-4 rounded-full bg-fg shadow transition-all duration-200 ${on ? 'left-[18px]' : 'left-0.5'}`}
        />
      </span>
    </button>
  )
}

/** A button that opens a small menu above it. Closes on outside tap or Escape. */
export function Popover({ icon, label, children }: { icon: IconName; label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !root.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
    }
  }, [open])
  return (
    // On phones the menu spans the dock it sits in (the dock's backdrop blur makes it the containing block).
    <div ref={root} className="sm:relative">
      <IconButton icon={icon} label={label} aria-expanded={open} onClick={() => setOpen(!open)} className="text-muted" />
      {open && (
        <div
          role="menu"
          className="absolute bottom-full mb-3 max-sm:inset-x-0 sm:right-0 sm:w-72 animate-enter rounded-2xl border border-white/[0.08] bg-raised/95 p-1.5 shadow-2xl shadow-black/60 backdrop-blur-xl"
        >
          {children}
        </div>
      )}
    </div>
  )
}

/** Side drawer on wide screens, bottom sheet on phones. Stays mounted so its state survives closing. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  compact = false,
}: {
  open: boolean
  compact?: boolean // phones: half height and no backdrop, so the lesson stays visible
  onClose: () => void
  title: ReactNode
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-30 bg-black/60 backdrop-blur-[2px] transition-opacity duration-200 lg:hidden ${open && !compact ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      />
      <aside
        inert={!open}
        className={`fixed z-40 flex flex-col border border-white/[0.07] bg-surface/95 shadow-2xl shadow-black/60 backdrop-blur-xl transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] max-lg:inset-x-0 max-lg:bottom-0 ${compact ? 'max-lg:h-[50dvh]' : 'max-lg:h-[85dvh]'} max-lg:rounded-t-[28px] max-lg:border-b-0 max-lg:pb-[env(safe-area-inset-bottom)] lg:top-[max(0.75rem,env(safe-area-inset-top))] lg:right-3 lg:bottom-3 lg:w-[400px] lg:rounded-[28px] ${open ? 'translate-x-0 translate-y-0' : 'max-lg:translate-y-full lg:translate-x-[calc(100%+1rem)]'}`}
      >
        <header className="flex items-center justify-between gap-2 py-2 pr-2 pl-5">
          <h2 className="flex items-center gap-2 text-[15px] font-medium">{title}</h2>
          <IconButton icon="close" label="Close" onClick={onClose} className="text-muted" />
        </header>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </aside>
    </>
  )
}
