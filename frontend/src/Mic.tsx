// Tap to record, tap again to transcribe. Hidden when the backend has no speech-to-text.
import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { interrupt, record } from './audio'
import { errorMessage, useAsync } from './hooks'
import { Icon } from './icons'
import { Button, Spinner } from './ui'

export function Mic({ lessonId, onText }: { lessonId?: string; onText: (text: string) => void }) {
  const status = useAsync(api.cachedStatus)
  const [state, setState] = useState<'idle' | 'recording' | 'transcribing'>('idle')
  const [error, setError] = useState('')
  const finish = useRef<() => Promise<Blob>>(null)

  // Release the microphone if we unmount mid-recording.
  useEffect(() => () => void finish.current?.(), [])

  if (!status.data?.stt) return null

  async function toggle() {
    setError('')
    if (state === 'idle') {
      interrupt() // barge-in: pause narration (to resume later) or stop a spoken reply
      try {
        finish.current = await record()
        setState('recording')
      } catch (e) {
        setError(
          !isSecureContext
            ? 'Voice needs HTTPS'
            : errorMessage(e).includes('ermission')
              ? 'Microphone permission denied'
              : 'Microphone unavailable',
        )
      }
    } else if (state === 'recording') {
      setState('transcribing')
      try {
        const blob = await finish.current!()
        finish.current = null
        const { text } = await api.stt(blob, lessonId)
        if (text.trim()) onText(text.trim())
        else setError('Didn’t catch that')
      } catch (e) {
        setError(errorMessage(e))
      } finally {
        setState('idle')
      }
    }
  }

  const label = { idle: 'Speak', recording: 'Stop recording', transcribing: 'Transcribing' }[state]
  return (
    <div className="relative">
      <Button
        type="button"
        variant={state === 'recording' ? 'primary' : 'default'}
        onClick={toggle}
        disabled={state === 'transcribing'}
        aria-label={label}
        title={label}
        className={`w-11 px-0 ${state === 'recording' ? 'animate-pulse border-bad bg-bad! text-bg' : ''}`}
      >
        {state === 'transcribing' ? <Spinner /> : <Icon name={state === 'recording' ? 'stop' : 'mic'} />}
      </Button>
      {error && (
        <span
          role="status"
          className="absolute right-0 bottom-full mb-2 rounded-full border border-white/[0.08] bg-raised px-3 py-1.5 text-xs whitespace-nowrap text-bad"
        >
          {error}
        </span>
      )}
    </div>
  )
}
