// Dev page at /gallery: example scene and code visuals with narration to step along with, wide diagrams, then
// every widget with its catalog example; each shows the state it reports to the tutor.
import { Suspense, useState } from 'react'
import { narrate, stopNarration, unlock, useAudio } from '../audio'
import type { Actor, Change, Color, Flow, Step, Visual as VisualSpec } from '../lesson'
import { ReadAlong } from '../ReadAlong'
import { Button, Panel } from '../ui'
import { Visual } from '../Visual'
import { catalog, widgets } from '.'

const actor = (id: string, label: string, icon: string, color: Color, col: number, row: number, more: Partial<Actor> = {}): Actor => ({
  id,
  label,
  icon,
  color,
  col,
  row,
  value: '',
  count: 1,
  level: null,
  ...more,
})
const step = (at: string, caption: string, more: Partial<Step> = {}): Step => ({
  at,
  caption,
  lines: '',
  show: [],
  hide: [],
  link: [],
  flow: [],
  highlight: [],
  change: [],
  ...more,
})
const flow = (path: string[], label: string, speed: Flow['speed']): Flow => ({ path, label, speed, color: '' })
const change = (id: string, more: Partial<Change>): Change => ({ id, value: null, count: null, level: null, ...more })
const visual = (more: Partial<VisualSpec>): VisualSpec => ({ kind: 'scene', widget: '', props: {}, code: '', caption: '', ...more })

const examples: { title: string; narration: string; visual: VisualSpec }[] = [
  {
    title: 'scene: decode waits on memory',
    narration:
      "A GPU keeps the model's weights in HBM memory, next to the chip. To make one token, the cores must read every weight. " +
      'The memory bus is slow next to the cores, so they mostly wait. Batching helps: one read of the weights now serves eight requests. ' +
      'The cores get busier, while the memory traffic stays the same.',
    visual: visual({
      actors: [
        actor('hbm', 'HBM memory', 'memory-stick', 'yellow', 0, 0, { value: '140 GB' }),
        actor('cores', 'Compute cores', 'cpu', 'blue', 2, 0, { level: 0.1, value: '10% busy' }),
        actor('token', 'Next token', '', 'pink', 3, 0),
        actor('requests', 'Requests', 'users', 'green', 2, 1, { value: '1 request' }),
      ],
      steps: [
        step("keeps the model's weights", 'The weights live in HBM, beside the chip', { highlight: ['hbm'] }),
        step('must read every weight', 'Every token reads all 140 GB of weights', {
          link: [['hbm', 'cores']],
          flow: [flow(['hbm', 'cores'], 'weights', 'slow')],
        }),
        step('so they mostly wait', 'The cores sit idle, waiting on memory', {
          highlight: ['cores'],
          flow: [flow(['hbm', 'cores'], 'weights', 'slow')],
        }),
        step('batching helps', 'Requests can share one read', { show: ['requests'], link: [['requests', 'cores']] }),
        step('serves eight requests', 'One read now serves eight requests', {
          change: [change('requests', { count: 8, value: '8 requests' })],
        }),
        step('the cores get busier', 'Same memory traffic, eight times the work', {
          link: [['cores', 'token']],
          change: [change('cores', { level: 0.8, value: '80% busy' })],
          flow: [flow(['hbm', 'cores'], 'weights', 'slow'), flow(['cores', 'token'], '8 tokens', 'fast')],
        }),
      ],
    }),
  },
  {
    title: 'scene: a cache hit skips the work (arrows around actors)',
    narration:
      'You send a prompt to the API server. The server runs it through the model on the GPU, and the reply streams back. ' +
      'The server also keeps the shared start of the prompt in a cache. Next time, a cache hit skips that work, and the reply comes back much sooner.',
    visual: visual({
      actors: [
        actor('you', 'You', 'user', 'cyan', 0, 0),
        actor('api', 'API server', 'server', 'purple', 1, 0),
        actor('gpu', 'GPU', 'cpu', 'blue', 2, 0, { level: 0.2 }),
        actor('reply', 'Reply', 'message-square', 'pink', 3, 0),
        actor('cache', 'Prompt cache', 'database', 'green', 1, 1, { value: '0 prefixes' }),
      ],
      steps: [
        step('you send a prompt', 'Your prompt reaches the server', {
          link: [['you', 'api']],
          flow: [flow(['you', 'api'], 'prompt', 'medium')],
        }),
        step('runs it through the model', 'The GPU does the heavy lifting', {
          link: [['api', 'gpu', 'reply']],
          flow: [flow(['api', 'gpu', 'reply'], 'tokens', 'medium')],
          change: [change('gpu', { level: 0.9 })],
        }),
        step('keeps the shared start', 'The shared start is saved in a cache', {
          show: ['cache'],
          link: [['api', 'cache']],
          change: [change('gpu', { level: 0.2 }), change('cache', { value: '1 prefix' })],
        }),
        step('a cache hit', 'A cache hit skips most of the work', {
          link: [['api', 'reply']],
          highlight: ['cache', 'api'],
          flow: [flow(['api', 'reply'], 'cache hit', 'fast')],
        }),
      ],
    }),
  },
  {
    title: 'scene: batching (stacks, dots, hide)',
    narration:
      'Requests arrive and wait in a queue. Served one at a time, the GPU stays mostly idle. The scheduler groups eight of them into one batch. ' +
      'Now each pass of the model serves all eight, so tokens come out much faster. When a request finishes, it leaves the batch and the next one joins.',
    visual: visual({
      actors: [
        actor('queue', 'Waiting requests', 'inbox', 'yellow', 0, 0, { count: 12, value: '12 waiting' }),
        actor('batch', 'Batch', 'boxes', 'purple', 1, 0, { value: 'batch of 1' }),
        actor('gpu', 'GPU', 'cpu', 'blue', 2, 0, { level: 0.15 }),
        actor('out', 'Tokens out', '', 'pink', 3, 0),
        actor('done', 'Finished', 'check', 'green', 2, 1),
      ],
      steps: [
        step('wait in a queue', 'Twelve requests wait their turn', { highlight: ['queue'] }),
        step('served one at a time', 'One at a time, the GPU idles', {
          link: [['queue', 'batch', 'gpu']],
          flow: [flow(['batch', 'gpu'], '1 request', 'slow')],
        }),
        step('groups eight of them', 'Eight requests share one pass', {
          change: [change('queue', { count: 4, value: '4 waiting' }), change('batch', { count: 8, value: 'batch of 8' })],
        }),
        step('each pass of the model', 'Eight tokens per pass instead of one', {
          link: [['gpu', 'out']],
          change: [change('gpu', { level: 0.85 })],
          flow: [flow(['gpu', 'out'], 'tokens', 'fast')],
        }),
        step('leaves the batch', 'Finished requests make room for the next', {
          show: ['done'],
          link: [['gpu', 'done']],
          flow: [flow(['queue', 'batch'], 'next', 'medium')],
        }),
      ],
    }),
  },
  {
    title: 'code: greedy decoding',
    narration:
      'This function writes text one token at a time. First the prompt is split into tokens and run through the model in one pass, which fills the cache. ' +
      'Then the loop makes one token per pass, feeding only the newest token. It picks the most likely token and stops at the end marker. ' +
      'Finally the tokens are turned back into text.',
    visual: visual({
      kind: 'code',
      language: 'python',
      code: `def generate(model, prompt, max_tokens=64):
    """Greedy decoding with a KV cache.

    Each step feeds only the newest token; the cache holds the rest.
    """
    tokens = tokenize(prompt)
    cache = model.prefill(tokens)  # one pass over the whole prompt fills the cache
    for _ in range(max_tokens):
        logits = model.decode(tokens[-1], cache)  # reads every weight again, for one token
        next_token = int(logits.argmax())
        if next_token == EOS:
            break
        tokens.append(next_token)
    return detokenize(tokens)
`,
      steps: [
        step('writes text one token', 'Greedy decoding with a cache', { lines: '1-5' }),
        step('first the prompt is split', 'Prefill: one pass over the whole prompt', { lines: '6-7' }),
        step('the loop makes one token', 'Decode: one new token per pass', { lines: '8-9' }),
        step('picks the most likely', 'Take the top token; stop at the end marker', { lines: '10-13' }),
        step('turned back into text', 'Tokens back to text', { lines: '14' }),
      ],
    }),
  },
  {
    title: 'mermaid: wide flowchart (top-down when narrow)',
    narration: '',
    visual: visual({
      kind: 'mermaid',
      code: 'flowchart LR\n  A[Prompt] --> B[Tokenizer] --> C[Embeddings] --> D[Transformer layers] --> E[LM head] --> F[Sampler] --> G[Next token]',
    }),
  },
  {
    title: 'mermaid: wide sequence (scrolls when narrow)',
    narration: '',
    visual: visual({
      kind: 'mermaid',
      code:
        'sequenceDiagram\n  participant L as Learner\n  participant A as App server\n  participant M as Language model\n  participant S as Speech server\n' +
        '  L->>A: open the next segment\n  A->>M: write the lesson\n  M-->>A: narration and visuals\n  A->>S: read the first sentence aloud\n  S-->>L: audio',
    }),
  },
]

function VisualEntry({ title, narration, visual }: (typeof examples)[number]) {
  const [state, setState] = useState<Record<string, unknown>>({})
  const audio = useAudio()
  const reading = audio.spoken?.text === narration && audio.state !== 'idle'
  return (
    <Panel className="flex flex-col gap-3">
      <div className="flex min-h-11 items-center justify-between gap-2">
        <h2 className="font-mono text-sm text-accent">{title}</h2>
        {narration && (
          <Button
            onClick={() => {
              if (reading) return stopNarration()
              unlock()
              narrate(narration)
            }}
          >
            {reading ? 'Stop' : 'Narrate'}
          </Button>
        )}
      </div>
      <Visual visual={visual} narration={narration} onState={setState} />
      {narration && (
        <>
          <ReadAlong text={narration} onPlayFrom={(sentence) => narrate(narration, undefined, sentence)} className="text-sm text-muted" />
          <pre className="overflow-x-auto rounded-xl bg-raised p-2 text-xs text-muted">{JSON.stringify(state)}</pre>
        </>
      )}
    </Panel>
  )
}

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
      <h1 className="text-xl font-semibold">Visuals</h1>
      {examples.map((e) => (
        <VisualEntry key={e.title} {...e} />
      ))}
      <h1 className="mt-6 text-xl font-semibold">Widget gallery</h1>
      {catalog.map((c) => (
        <Entry key={c.name} name={c.name} example={c.example} />
      ))}
    </div>
  )
}
