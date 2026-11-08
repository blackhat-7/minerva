// Dev page at /gallery: every widget with its catalog example, plus the state it reports to the tutor.
import { Suspense, useState } from 'react'
import { Panel } from '../ui'
import { catalog, widgets } from '.'

function Entry({ name, example }: { name: string; example: Record<string, unknown> }) {
  const [state, setState] = useState<Record<string, unknown>>({})
  const Widget = widgets[name]
  return (
    <Panel className="flex flex-col gap-3">
      <h2 className="font-mono text-sm text-accent">{name}</h2>
      {Widget ? (
        <Suspense fallback={<div className="text-muted">loading…</div>}>
          <Widget props={example} onState={setState} />
        </Suspense>
      ) : (
        <div className="text-bad">no component registered</div>
      )}
      <pre className="overflow-x-auto rounded-xl bg-raised p-2 text-xs text-muted">{JSON.stringify(state, null, 1)}</pre>
    </Panel>
  )
}

export default function Gallery() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">Widget gallery</h1>
      {catalog.map((c) => (
        <Entry key={c.name} name={c.name} example={c.example} />
      ))}
    </div>
  )
}
