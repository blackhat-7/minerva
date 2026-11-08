import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

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
