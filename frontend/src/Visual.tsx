// Renders a segment's visual: a registered widget, an animated scene, a code walkthrough, a Mermaid diagram,
// a markdown table, a KaTeX equation or a sandboxed HTML simulation.
import katex from 'katex'
import { Component, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { Code } from './Code'
import { svgWidth, topDown } from './diagram'
import type { Visual as VisualSpec } from './lesson'
import { Markdown } from './Markdown'
import { Scene } from './Scene'
import { Skeleton } from './ui'
import { Walkthrough } from './Walkthrough'
import { widgets } from './widgets'
import { useWidth } from './widgets/useWidth'

type OnState = (state: Record<string, unknown>) => void

/** `narration`: the segment's narration; scene and code visuals step along with it while it is read aloud. */
export function Visual({ visual, narration, onState }: { visual: VisualSpec; narration?: string; onState: OnState }) {
  const steps = visual.steps ?? []
  return (
    <figure className="flex flex-1 flex-col gap-3">
      <div className="flex min-h-0 flex-1 flex-col justify-center">
        <Boundary key={JSON.stringify(visual)}>
          {visual.kind === 'widget' ? (
            <Widget name={visual.widget} props={visual.props} onState={onState} />
          ) : visual.kind === 'scene' ? (
            <Walkthrough steps={steps} narration={narration} onState={onState}>
              {(step) => <Scene actors={visual.actors ?? []} steps={steps} step={step} />}
            </Walkthrough>
          ) : visual.kind === 'code' ? (
            <Walkthrough steps={steps} narration={narration} onState={onState}>
              {(step) => <Code code={visual.code} language={visual.language ?? ''} lines={steps[step]?.lines ?? ''} />}
            </Walkthrough>
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

type Diagram = { code?: string; svg?: string; width?: number; error?: string }

/** Mermaid code drawn as SVG, with the width it is drawn at by default; nothing for null code. */
function useDiagram(code: string | null): Diagram {
  const [result, setResult] = useState<Diagram>({})
  useEffect(() => {
    if (code === null) return
    let live = true
    loadMermaid()
      .then((m) => m.render(`mermaid-${++diagramId}`, code))
      .then(
        ({ svg }) => live && setResult({ code, svg, width: svgWidth(svg) }),
        (e) => live && setResult({ code, error: e instanceof Error ? e.message : String(e) }),
      )
    return () => {
      live = false
    }
  }, [code])
  return result.code === code ? result : {}
}

const MIN_SCALE = 0.7 // smaller makes the diagram's text too small to read

/** A Mermaid diagram, shrunk to fit its container down to MIN_SCALE. Narrower than that, a left-right flowchart
 * is redrawn top-down; anything still too wide is shown at MIN_SCALE and scrolls sideways. */
function Mermaid({ code }: { code: string }) {
  const [ref, room] = useWidth<HTMLDivElement>()
  const wide = useDiagram(code)
  const down = topDown(code)
  const tooWide = !!wide.width && wide.width * MIN_SCALE > room && down !== null
  const tall = useDiagram(tooWide ? down : null)
  const diagram = tooWide && !tall.error ? tall : wide
  const width = diagram.width ?? 0
  const scale = width ? Math.min(1, room / width) : 1
  return (
    <div ref={ref} className="overflow-x-auto">
      {wide.error ? (
        <Unavailable>
          Couldn’t draw this diagram.
          <pre className="mt-3 overflow-x-auto text-left font-mono text-xs whitespace-pre-wrap">{code}</pre>
        </Unavailable>
      ) : !diagram.svg ? (
        <Skeleton className="h-72" />
      ) : (
        <div
          className="mx-auto [&_svg]:h-auto [&_svg]:w-full"
          style={scale < MIN_SCALE ? { width: width * MIN_SCALE } : { maxWidth: width || undefined }}
          dangerouslySetInnerHTML={{ __html: diagram.svg }}
        />
      )}
    </div>
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
