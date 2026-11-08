import { describe, expect, it } from 'vitest'
import { svgWidth, topDown } from './diagram'

describe('topDown', () => {
  it('turns a left-right flowchart top-down', () => {
    expect(topDown('flowchart LR\n  A --> B')).toBe('flowchart TD\n  A --> B')
    expect(topDown('graph RL;\nA-->B')).toBe('graph TD;\nA-->B')
    expect(topDown('graph LR; A-->B')).toBe('graph TD; A-->B')
  })

  it('keeps front matter, init directives and comments', () => {
    expect(topDown('%%{init: {"theme": "dark"}}%%\n%% note\n\nflowchart LR\nA-->B')).toBe(
      '%%{init: {"theme": "dark"}}%%\n%% note\n\nflowchart TD\nA-->B',
    )
    expect(topDown('%%{\n  init: {}\n}%%\ngraph LR\nA')).toBe('%%{\n  init: {}\n}%%\ngraph TD\nA')
    expect(topDown('---\ntitle: Flow\n---\nflowchart LR\nA-->B')).toBe('---\ntitle: Flow\n---\nflowchart TD\nA-->B')
  })

  it('leaves other diagrams alone', () => {
    expect(topDown('flowchart TD\nA-->B')).toBeNull()
    expect(topDown('graph\nA-->B')).toBeNull()
    expect(topDown('flowchart LRX')).toBeNull()
    expect(topDown('sequenceDiagram\nA->>B: hi')).toBeNull()
    expect(topDown('---\ntitle: unclosed\nflowchart LR')).toBeNull()
    expect(topDown('')).toBeNull()
  })
})

describe('svgWidth', () => {
  it('reads the viewBox width', () => {
    expect(svgWidth('<svg id="m" width="100%" style="max-width: 552.5px;" viewBox="-8 -8 552.5 300">')).toBe(552.5)
    expect(svgWidth('<svg viewBox="0,0,1200,80">')).toBe(1200)
    expect(svgWidth('<svg width="10">')).toBe(0)
  })
})
