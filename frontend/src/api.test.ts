import { describe, expect, it } from 'vitest'
import { sseParser } from './api'

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
