import { useLayoutEffect, useRef, useState } from 'react'

const MIN_WIDTH = 240

/** Live content width of an element, so SVG charts can draw at real pixel size (crisp, legible text). */
export function useWidth<T extends Element>(initial = 640) {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(initial)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // Hidden or collapsed containers report 0; keep charts at a drawable minimum.
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(MIN_WIDTH, e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}
