import { describe, expect, it } from 'vitest'
import { formatNumber, gradeNumeric, parseNumber } from './numeric'

describe('parseNumber', () => {
  it.each([
    ['1.2e12', 1.2e12],
    ['1.2E12', 1.2e12],
    ['3.5T', 3.5e12],
    ['400G', 400e9],
    ['20k', 20e3],
    ['20K', 20e3],
    ['2M', 2e6],
    ['1,000', 1000],
    [' 1 000 ', 1000],
    ['-2.5', -2.5],
    ['.5', 0.5],
    ['7.', 7],
    ['1e-3', 1e-3],
  ])('%s -> %d', (input, want) => {
    expect(parseNumber(input)).toBeCloseTo(want, 6)
  })

  it.each(['', 'abc', '1.2.3', '5m', '3x', 'e5', '--1', '1e'])('rejects %j', (input) => {
    expect(parseNumber(input)).toBeNull()
  })
})

describe('gradeNumeric', () => {
  it('accepts within the tolerance factor either way', () => {
    expect(gradeNumeric(150, 100, 2).correct).toBe(true)
    expect(gradeNumeric(50, 100, 2).correct).toBe(true)
    expect(gradeNumeric(200, 100, 2).correct).toBe(true)
  })

  it('rejects outside the tolerance and reports the factor', () => {
    const g = gradeNumeric(320, 100, 2)
    expect(g.correct).toBe(false)
    expect(g.feedback).toBe('Off by 3.2x (too high).')
    expect(gradeNumeric(10, 100, 2).feedback).toBe('Off by 10.0x (too low).')
  })

  it('rejects mismatched signs and zero', () => {
    expect(gradeNumeric(-100, 100, 2).correct).toBe(false)
    expect(gradeNumeric(0, 100, 2).correct).toBe(false)
  })

  it('handles negative values by ratio', () => {
    expect(gradeNumeric(-150, -100, 2).correct).toBe(true)
  })
})

describe('formatNumber', () => {
  it.each([
    [1.2e12, '1.2T'],
    [400e9, '400G'],
    [20000, '20k'],
    [999, '999'],
    [0.25, '0.25'],
    [3.5e-7, '3.5e-7'],
    [0, '0'],
  ])('%d -> %s', (n, want) => {
    expect(formatNumber(n)).toBe(want)
  })
})
