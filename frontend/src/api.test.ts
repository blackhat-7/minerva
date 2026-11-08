import { describe, expect, it } from 'vitest'
import { addStep, sseParser } from './api'

describe('sseParser', () => {
  it('yields each event data payload', () => {
    const parse = sseParser()
    expect(parse('data: {"delta":"a"}\n\ndata: {"delta":"b"}\n\n')).toEqual(['{"delta":"a"}', '{"delta":"b"}'])
  })

  it('buffers events split across chunks', () => {
    const parse = sseParser()
    expect(parse('data: {"del')).toEqual([])
    expect(parse('ta":"a"}\n')).toEqual([])
    expect(parse('\ndata: {"done":true}\n\n')).toEqual(['{"delta":"a"}', '{"done":true}'])
  })

  it('handles CRLF, comments, no space after colon and multi-line data', () => {
    const parse = sseParser()
    expect(parse(': ping\r\n\r\ndata:x\r\ndata: y\r\n\r\n')).toEqual(['x\ny'])
  })

  it('handles a CRLF split across chunks', () => {
    const parse = sseParser()
    expect(parse('data: a\r\n\r')).toEqual([])
    expect(parse('\n')).toEqual(['a'])
  })
})

describe('addStep', () => {
  it('merges thinking in a row and keeps tool calls in order', () => {
    let steps = addStep([], { thinking: '' })
    steps = addStep(steps, { thinking: 'Bytes ' })
    steps = addStep(steps, { thinking: 'first.' })
    steps = addStep(steps, { tool: { name: 'WebSearch', detail: 'H100 bandwidth' } })
    steps = addStep(steps, { thinking: 'Now.' })
    expect(steps).toEqual([
      { kind: 'thinking', text: 'Bytes first.' },
      { kind: 'tool', name: 'WebSearch', detail: 'H100 bandwidth' },
      { kind: 'thinking', text: 'Now.' },
    ])
  })
  it('ignores reply text', () => {
    expect(addStep([], { delta: 'hi' })).toEqual([])
  })
})
