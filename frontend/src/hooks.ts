import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Runs `load` (a stable function: module-level or useCallback) and tracks its result.
 * `reload` retries; `setData` replaces the result locally. */
export function useAsync<T>(load: () => Promise<T>) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ load?: () => Promise<T>; attempt?: number; data?: T; error?: string }>({})
  useEffect(() => {
    let live = true
    load().then(
      (data) => live && setResult({ load, attempt, data }),
      (e) => live && setResult((r) => ({ load, attempt, data: r.data, error: errorMessage(e) })),
    )
    return () => {
      live = false
    }
  }, [load, attempt])
  const loading = result.load !== load || result.attempt !== attempt
  return {
    data: result.data,
    error: loading ? undefined : result.error,
    loading,
    reload: useCallback(() => setAttempt((n) => n + 1), []),
    setData: useCallback((data: T) => setResult({ load, attempt, data }), [load, attempt]),
  }
}

/** A ref that always holds the latest value, for callbacks that outlive a render. */
export function useLatest<T>(value: T) {
  const ref = useRef(value)
  useLayoutEffect(() => {
    ref.current = value
  })
  return ref
}

/** Window-level single-key shortcuts (e.key → handler). Ignored while typing or with modifiers;
 * Space and Enter are left to a focused button or link. */
export function useHotkeys(keys: Record<string, () => void>) {
  const latest = useLatest(keys)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return
      if ((e.key === ' ' || e.key === 'Enter') && target.closest('button, a')) return
      const handler = latest.current[e.key]
      if (handler) {
        e.preventDefault()
        handler()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [latest])
}

/** useState persisted in localStorage under `key`. */
export function usePersistentState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    const stored = localStorage.getItem(key)
    return stored === null ? initial : (JSON.parse(stored) as T)
  })
  useEffect(() => localStorage.setItem(key, JSON.stringify(value)), [key, value])
  return [value, setValue] as const
}

type Offset = { x: number; y: number }

/** Moves an offset by (dx, dy), as far as keeps `rect` (the element's box at that offset) inside the window. */
function shift(o: Offset, rect: DOMRect, dx: number, dy: number): Offset {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi))
  return {
    x: o.x + clamp(dx, -rect.left, innerWidth - rect.right),
    y: o.y + clamp(dy, -rect.top, innerHeight - rect.bottom),
  }
}

/** Lets the user drag an element around the screen by a grip. Pass `setElement` as the element's ref, put
 * `style` on it and `onPointerDown` on the grip. The position is kept in localStorage under `key`, and pulled
 * back on screen when the window or the element changes size. */
export function useDraggable<T extends HTMLElement>(key: string) {
  const [offset, setOffset] = usePersistentState<Offset>(key, { x: 0, y: 0 })
  const [el, setElement] = useState<T | null>(null)

  useEffect(() => {
    if (!el) return
    const fit = () => setOffset((o) => shift(o, el.getBoundingClientRect(), 0, 0))
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    window.addEventListener('resize', fit)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', fit)
    }
  }, [el, setOffset])

  // The grip captures the pointer, so the drag keeps following it even off the grip.
  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (!el) return
    const grip = e.currentTarget
    const [x, y, rect] = [e.clientX, e.clientY, el.getBoundingClientRect()]
    const move = (m: globalThis.PointerEvent) => setOffset(shift(offset, rect, m.clientX - x, m.clientY - y))
    const end = () => {
      grip.removeEventListener('pointermove', move)
      grip.removeEventListener('pointerup', end)
      grip.removeEventListener('pointercancel', end)
    }
    grip.setPointerCapture(e.pointerId)
    grip.addEventListener('pointermove', move)
    grip.addEventListener('pointerup', end)
    grip.addEventListener('pointercancel', end)
  }
  return { setElement, style: { translate: `${offset.x}px ${offset.y}px` }, onPointerDown }
}
