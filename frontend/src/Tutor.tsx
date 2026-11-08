// Streaming tutor chat: type, or talk hands-free. Voice replies are spoken sentence by sentence as they
// stream. A lesson keeps several chats (the player owns and saves them); any question can be rewound to,
// dropping it and what followed so it can be edited and asked again.
import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { api, type ChatMessage, type TutorRequest } from './api'
import { Icon } from './icons'
import type { Chat } from './Player'
import { interrupt as interruptAudio, narrationHeard, resumeNarration, speakStream, stop, useAudio } from './audio'
import { errorMessage, useAsync, useLatest } from './hooks'
import { setVoiceHandlers, startListening, useListening } from './listen'
import { Markdown } from './Markdown'
import { isResumePhrase, sentenceSplitter, sentences } from './speech'
import { Talk } from './Talk'
import { Button, ErrorNote, IconButton } from './ui'

const CHIPS = ['Explain it simpler', 'Go deeper', 'Give me an analogy']
const INTERRUPTED = '(interrupted)' // TUTOR_RULES in backend prompts.py refers to this marker
const HISTORY = 16 // messages sent to the model; the whole conversation stays saved

export function Tutor({
  lessonId,
  messages,
  setMessages,
  context,
  inputRef,
  onConversation,
  where,
  chats,
  chatId,
  onOpenChat,
  onDeleteChat,
  quote,
  onQuote,
}: {
  lessonId: string
  messages: ChatMessage[]
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>
  context: () => Pick<TutorRequest, 'segment_id' | 'context'>
  inputRef: RefObject<HTMLTextAreaElement | null>
  onConversation: () => void // a spoken question arrived: show the transcript
  where: string // the step being studied, shown as a divider in the saved conversation
  chats: Chat[]
  chatId: string // '' = a new chat
  onOpenChat: (id: string) => void
  onDeleteChat: (id: string) => void
  quote: string // selected lesson text attached to the next question; '' = none
  onQuote: (quote: string) => void
}) {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const listening = useListening().phase !== 'off'
  const audio = useAudio()
  const held = audio.held !== null
  const [respeaking, setRespeaking] = useState(-1) // index of the reply being read aloud again
  const stt = useAsync(api.cachedStatus).data?.stt
  const abort = useRef<AbortController>(null)
  const abandoned = useRef<AbortController>(null) // a reply cut off by leaving its chat: write nothing back
  const scroller = useRef<HTMLDivElement>(null)
  const [browsing, setBrowsing] = useState(false)

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [messages])
  useEffect(() => () => abort.current?.abort(), [])

  async function send(text: string, voice: boolean, history = messages) {
    text = text.trim() || (quote ? 'Explain this.' : '')
    if (!text || busy) return
    setInput('')
    setError('')
    const sent: ChatMessage[] = [...history, { role: 'user', content: text, at: where, ...(quote && { quote }) }]
    onQuote('')
    setMessages([...sent, { role: 'assistant', content: '' }])
    setBusy(true)
    const ctl = new AbortController()
    abort.current = ctl
    let reply = ''
    // Speak each sentence as soon as it is complete, rather than after the whole reply.
    const speech = voice ? speakStream() : null
    const splitter = sentenceSplitter()
    const { segment_id, context: ctx } = context()
    const heard = narrationHeard() // narration paused for this conversation: how far the learner got
    const recent = sent.slice(-HISTORY)
    const turns = recent.slice(recent.findIndex((m) => m.role === 'user')).map(({ role, content, quote }) => ({
      role,
      content: quote ? `${quote.replace(/^/gm, '> ')}\n\n${content}` : content,
    }))
    try {
      await api.tutor(
        { lesson_id: lessonId, segment_id, context: heard ? { ...ctx, narration_heard: heard } : ctx, messages: turns, voice },
        (delta) => {
          reply += delta
          setMessages([...sent, { role: 'assistant', content: reply }])
          if (speech) splitter.push(delta).forEach(speech.push)
        },
        ctl.signal,
      )
      if (speech) splitter.flush().forEach(speech.push)
    } catch (e) {
      if (abandoned.current === ctl) return
      // A reply the learner cut off stays, marked so the tutor answers what comes next instead of finishing it.
      if (!reply) setMessages(sent)
      else if (ctl.signal.aborted) setMessages([...sent, { role: 'assistant', content: `${reply.trimEnd()} ${INTERRUPTED}` }])
      if (!ctl.signal.aborted) setError(errorMessage(e))
    } finally {
      speech?.end() // after a barge-in this is a no-op: stop() already ended the stream
      setBusy(false)
    }
  }

  // Hands-free: speaking pauses narration (or cuts off a reply); a short "continue" resumes the narration,
  // anything else is a question for the tutor.
  function interrupt() {
    abort.current?.abort()
    interruptAudio()
  }
  function onUtterance(text: string) {
    if (held && isResumePhrase(text)) return resumeNarration()
    onConversation()
    send(text, true)
  }
  const voice = useLatest({ interrupt, onUtterance })
  useEffect(() => {
    setVoiceHandlers({
      onSpeech: () => voice.current.interrupt(),
      onUtterance: (text) => voice.current.onUtterance(text),
    })
    return () => setVoiceHandlers(null)
  }, [voice])

  /** Reads reply `i` aloud again, at the narration speed. Narration playing now pauses, to resume later. */
  function respeak(i: number) {
    interruptAudio()
    const speech = speakStream(() => setRespeaking(-1))
    sentences(spoken(messages[i].content)).forEach(speech.push)
    speech.end()
    setRespeaking(i)
  }

  /** Stops a reply in flight without writing it back: the open chat is about to change. */
  function leave() {
    setError('')
    if (!busy) return
    abandoned.current = abort.current
    abort.current?.abort()
    interruptAudio()
  }
  function openChat(id: string) {
    if (id !== chatId) leave()
    onOpenChat(id)
    setBrowsing(false)
  }
  function deleteChat(id: string) {
    if (id === chatId) leave()
    onDeleteChat(id)
  }
  /** Drops question `i` and everything after it, and puts the question back in the box to edit. */
  function rewindTo(i: number) {
    leave()
    setMessages(messages.slice(0, i))
    setInput(messages[i].content)
    onQuote(messages[i].quote ?? '')
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  function retry() {
    const last = messages.findLastIndex((m) => m.role === 'user')
    if (last >= 0) send(messages[last].content, false, messages.slice(0, last))
  }

  const streaming = busy && messages.at(-1)?.content === ''

  const current = chats.find((c) => c.id === chatId)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {chats.length > 0 && (
        <div className="flex items-center gap-1 px-3 pb-1">
          <button
            onClick={() => setBrowsing(!browsing)}
            aria-expanded={browsing}
            className="flex min-h-9 min-w-0 items-center gap-1.5 rounded-full px-3 text-sm text-muted transition hover:bg-white/[0.06] hover:text-fg"
          >
            <span className="truncate">{browsing ? 'All chats' : current ? titleOf(current) : 'New chat'}</span>
            <Icon name="chevron" className={`transition-transform ${browsing ? 'rotate-180' : ''}`} />
          </button>
          <Button variant="ghost" className="ml-auto min-h-9 shrink-0 px-3 text-muted" onClick={() => openChat('')}>
            <Icon name="plus" />
            New chat
          </Button>
        </div>
      )}
      {browsing ? (
        <ChatList chats={chats} chatId={chatId} onOpen={openChat} onDelete={deleteChat} />
      ) : (
        <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-3">
          {messages.length === 0 && (
            <div className="m-auto flex max-w-xs flex-col items-center gap-5 py-6 text-center">
              <p className="text-muted">
                {listening ? 'Just ask out loud. Say “continue” to resume the narration.' : 'Ask anything about this step.'}
              </p>
              {!listening && (
                <div className="flex flex-wrap justify-center gap-2">
                  {CHIPS.map((c) => (
                    <button
                      key={c}
                      onClick={() => send(c, false)}
                      className="min-h-9 rounded-full bg-white/[0.05] px-3.5 text-sm text-muted transition hover:bg-white/[0.09] hover:text-fg"
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {messages.map((m, i) => {
            if (m.role === 'user') {
              const previous = messages.slice(0, i).findLast((x) => x.role === 'user')
              return (
                <div key={i} className="flex flex-col gap-5">
                  {m.at && m.at !== previous?.at && (
                    <div className="flex items-center gap-3 text-xs text-muted">
                      <span className="h-px flex-1 bg-white/[0.06]" />
                      <span className="max-w-[70%] truncate">{m.at}</span>
                      <span className="h-px flex-1 bg-white/[0.06]" />
                    </div>
                  )}
                  <div className="group flex items-center justify-end gap-1">
                    <button
                      onClick={() => rewindTo(i)}
                      aria-label="Rewind to here and edit"
                      title="Rewind to here and edit"
                      className="grid size-9 shrink-0 place-items-center rounded-full text-muted opacity-0 transition group-hover:opacity-100 hover:bg-white/[0.07] hover:text-fg focus-visible:opacity-100 pointer-coarse:opacity-60"
                    >
                      <Icon name="undo" />
                    </button>
                    <div className="flex max-w-[85%] flex-col gap-2 rounded-3xl rounded-br-lg bg-white/[0.08] px-4 py-2.5 text-[15px] whitespace-pre-wrap">
                      {m.quote && <Quoted text={m.quote} />}
                      {m.content}
                    </div>
                  </div>
                </div>
              )
            }
            if (!m.content) return null
            const cut = m.content.endsWith(INTERRUPTED)
            return (
              <div key={i} className="flex flex-col gap-1">
                <Markdown className="max-w-full text-[15px]">{cut ? m.content.slice(0, -INTERRUPTED.length) : m.content}</Markdown>
                <div className="flex items-center gap-2 text-xs text-muted">
                  {!(busy && i === messages.length - 1) && (
                    <button
                      onClick={() => (respeaking === i && audio.state !== 'idle' ? stop() : respeak(i))}
                      aria-label={respeaking === i && audio.state !== 'idle' ? 'Stop reading' : 'Read aloud'}
                      title={respeaking === i && audio.state !== 'idle' ? 'Stop reading' : 'Read aloud'}
                      className="-ml-2 grid size-8 place-items-center rounded-full transition hover:bg-white/[0.07] hover:text-fg"
                    >
                      <Icon name={respeaking === i && audio.state !== 'idle' ? 'stop' : 'volume'} />
                    </button>
                  )}
                  {cut && <span>Interrupted</span>}
                </div>
              </div>
            )
          })}
          {streaming && (
            <div className="flex gap-1" aria-label="Tutor is thinking">
              {[0, 150, 300].map((d) => (
                <span key={d} className="size-1.5 animate-pulse rounded-full bg-muted" style={{ animationDelay: `${d}ms` }} />
              ))}
            </div>
          )}
          {error && <ErrorNote error={error} onRetry={retry} />}
        </div>
      )}

      {quote && (
        <div className="mx-3 mt-1 flex items-start gap-2 rounded-2xl bg-white/[0.04] py-2.5 pr-1 pl-3">
          <div className="min-w-0 flex-1">
            <Quoted text={quote} />
          </div>
          <IconButton icon="close" label="Remove quote" onClick={() => onQuote('')} className="-my-1.5 text-muted" />
        </div>
      )}
      {listening ? (
        <Talk busy={busy} />
      ) : (
        <form
          className="m-3 mt-1 flex items-end gap-1 rounded-[26px] border border-white/[0.08] bg-white/[0.03] p-1.5 transition focus-within:border-accent/50"
          onSubmit={(e) => {
            e.preventDefault()
            send(input, false)
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            onChange={(e) => {
              setInput(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                send(input, false)
              }
            }}
            placeholder={quote ? 'Ask about this, or just send' : 'Ask the tutor…'}
            aria-label="Message"
            className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-base placeholder:text-muted/70 focus:outline-none focus-visible:outline-none"
          />
          {busy ? (
            <IconButton icon="stop" label="Stop" variant="default" onClick={() => abort.current?.abort()} />
          ) : input.trim() || quote ? (
            <IconButton icon="send" label="Send" variant="primary" type="submit" />
          ) : (
            stt && (
              <IconButton
                icon="mic"
                label="Talk to the tutor"
                variant="default"
                type="button"
                onClick={() => startListening(lessonId)}
              />
            )
          )}
        </form>
      )}
    </div>
  )
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** A chat's name: its first question. */
const titleOf = (chat: Chat) => chat.messages.find((m) => m.role === 'user')?.content ?? 'New chat'

function ChatList({
  chats,
  chatId,
  onOpen,
  onDelete,
}: {
  chats: Chat[]
  chatId: string
  onOpen: (id: string) => void
  onDelete: (id: string) => void
}) {
  // a chat emptied by rewinding to its first question is listed only while open
  const sorted = chats.filter((c) => c.messages.length || c.id === chatId).sort((a, b) => b.updated.localeCompare(a.updated))
  return (
    <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2">
      {sorted.map((c) => (
        <li key={c.id} className={`group flex items-center rounded-2xl pr-1 transition ${c.id === chatId ? 'bg-white/[0.06]' : 'hover:bg-white/[0.04]'}`}>
          <button onClick={() => onOpen(c.id)} className="flex min-h-14 min-w-0 flex-1 flex-col justify-center px-3 text-left">
            <span className="truncate text-[15px]">{titleOf(c)}</span>
            <span className="text-xs text-muted">
              {plural(c.messages.filter((m) => m.role === 'user').length, 'question')} ·{' '}
              {new Date(c.updated).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          </button>
          <IconButton
            icon="trash"
            label="Delete chat"
            onClick={() => onDelete(c.id)}
            className="text-muted opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100"
          />
        </li>
      ))}
    </ul>
  )
}

/** A quoted piece of the lesson, clipped to a few lines. */
function Quoted({ text }: { text: string }) {
  return <div className="line-clamp-3 border-l-2 border-accent/60 pl-3 text-sm text-muted">{text}</div>
}

/** A reply as plain words for the voice: no markdown marks, code blocks or LaTeX commands. */
const spoken = (text: string) =>
  text
    .replace(INTERRUPTED, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/[*_#`>$|{}]/g, '')
