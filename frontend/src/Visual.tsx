// Renders a segment's visual: a registered widget, Mermaid diagram, markdown table, KaTeX equation or sandboxed HTML simulation.
import katex from 'katex'
import { Component, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Visual as VisualSpec } from './lesson'
import { Markdown } from './Markdown'
import { Skeleton } from './ui'
import { widgets } from './widgets'

type OnState = (state: Record<string, unknown>) => void

export function Visual({ visual, onState }: { visual: VisualSpec; onState: OnState }) {
  return (
    <figure className="flex flex-1 flex-col gap-3">
      <div className="flex min-h-0 flex-1 flex-col justify-center">
        <Boundary key={visual.kind + visual.widget + visual.code}>
          {visual.kind === 'widget' ? (
            <Widget name={visual.widget} props={visual.props} onState={onState} />
          ) : visual.kind === 'mermaid' ? (
            <Mermaid code={visual.code} />
          ) : visual.kind === 'table' ? (
            <Markdown className="overflow-x-auto">{visual.code}</Markdown>
          ) : visual.kind === 'math' ? (
            <MathBlock code={visual.code} />
          ) : visual.kind === 'html' ? (
            <HtmlSim code={visual.code} onState={onState} />
          ) : null}
        </Boundary>
      </div>
      {visual.caption && <figcaption className="text-center text-sm text-muted">{visual.caption}</figcaption>}
    </figure>
  )
}

function Unavailable({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">{children}</div>
}

/** Keeps a broken generated visual from taking down the lesson. */
class Boundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {}
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    return this.state.error ? (
      <Unavailable>This visual failed to render: {this.state.error.message}</Unavailable>
    ) : (
      this.props.children
    )
  }
}

function Widget({ name, props, onState }: { name: string; props: Record<string, unknown>; onState: OnState }) {
  const W = widgets[name]
  if (!W) return <Unavailable>The “{name}” simulation isn’t available in this version of Minerva.</Unavailable>
  return (
    <Suspense fallback={<Skeleton className="h-80" />}>
      <W props={props} onState={onState} />
    </Suspense>
  )
}

let mermaid: Promise<typeof import('mermaid').default> | undefined
let diagramId = 0

function loadMermaid() {
  mermaid ??= import('mermaid').then(({ default: m }) => {
    const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim()
    m.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: getComputedStyle(document.body).fontFamily,
      themeVariables: {
        darkMode: true,
        background: token('surface'),
        primaryColor: token('raised'),
        primaryTextColor: token('fg'),
        primaryBorderColor: token('accent'),
        secondaryColor: token('surface'),
        tertiaryColor: token('bg'),
        lineColor: token('muted'),
        textColor: token('fg'),
        mainBkg: token('raised'),
        nodeBorder: token('accent'),
        clusterBkg: token('bg'),
        clusterBorder: token('line'),
        edgeLabelBackground: token('surface'),
        actorBkg: token('raised'),
        actorBorder: token('accent'),
        signalColor: token('muted'),
        noteBkgColor: token('surface'),
        noteTextColor: token('fg'),
        noteBorderColor: token('line'),
      },
    })
    return m
  })
  return mermaid
}

function Mermaid({ code }: { code: string }) {
  const [result, setResult] = useState<{ svg?: string; error?: string }>({})
  useEffect(() => {
    let live = true
    loadMermaid()
      .then((m) => m.render(`mermaid-${++diagramId}`, code))
      .then(
        ({ svg }) => live && setResult({ svg }),
        (e) => live && setResult({ error: e instanceof Error ? e.message : String(e) }),
      )
    return () => {
      live = false
    }
  }, [code])
  if (result.error)
    return (
      <Unavailable>
        Couldn’t draw this diagram.
        <pre className="mt-3 overflow-x-auto text-left font-mono text-xs whitespace-pre-wrap">{code}</pre>
      </Unavailable>
    )
  if (!result.svg) return <Skeleton className="h-72" />
  return (
    <div
      className="flex justify-center overflow-x-auto [&_svg]:h-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: result.svg }}
    />
  )
}

function MathBlock({ code }: { code: string }) {
  const tex = code
    .trim()
    .replace(/^\$\$([\s\S]*)\$\$$/, '$1')
    .replace(/^\\\[([\s\S]*)\\\]$/, '$1')
  const html = katex.renderToString(tex, { displayMode: true, throwOnError: false })
  return <div className="md overflow-x-auto py-4 text-base lg:text-lg" dangerouslySetInnerHTML={{ __html: html }} />
}

// Generated HTML runs in an opaque-origin sandbox (no allow-same-origin) with no network access.
const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'"

// Injected first into every simulation: reports its content height so the frame fits it (no inner scroll).
const FIT_HEIGHT =
  "<script>addEventListener('load',()=>{const send=()=>parent.postMessage({type:'minerva-height'," +
  "height:Math.ceil(document.documentElement.getBoundingClientRect().height)},'*');" +
  'new ResizeObserver(send).observe(document.documentElement);send()})</script>'
const MIN_HEIGHT = 160
const MAX_HEIGHT = 1400

function HtmlSim({ code, onState }: { code: string; onState: OnState }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState<number | null>(null)
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return
      if (e.data?.type === 'state' && e.data.state && typeof e.data.state === 'object') onState(e.data.state)
      if (e.data?.type === 'minerva-height' && typeof e.data.height === 'number')
        setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, e.data.height)))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [onState])
  const doc =
    `<!doctype html><meta http-equiv="Content-Security-Policy" content="${CSP}"><meta name="color-scheme" content="dark">` +
    FIT_HEIGHT +
    code.replace(/^\s*<!doctype[^>]*>/i, '')
  return (
    <iframe
      ref={frame}
      title="Simulation"
      sandbox="allow-scripts"
      srcDoc={doc}
      style={height ? { height } : undefined}
      className="h-[440px] w-full rounded-xl border-0 bg-transparent lg:h-[min(620px,calc(100dvh-240px))]"
    />
  )
}
