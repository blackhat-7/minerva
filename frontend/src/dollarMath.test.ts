import { describe, expect, it } from 'vitest'
import { dollarMath } from './dollarMath'

describe('dollarMath', () => {
  it('turns \\( \\) and \\[ \\] into dollars', () => {
    expect(dollarMath('so \\(x^2\\) and \\[y = 1\\]')).toBe('so $x^2$ and $$y = 1$$')
  })

  it('leaves code alone', () => {
    const fenced = '```bash\nfind . \\( -name "*.py" \\)\n```'
    expect(dollarMath(`run \\(a\\):\n${fenced}\nthen \`r"\\(\\d+\\)"\``)).toBe(`run $a$:\n${fenced}\nthen \`r"\\(\\d+\\)"\``)
  })

  it('leaves a code block that is still streaming in alone', () => {
    expect(dollarMath('```python\nre.compile(r"\\(x\\)")')).toBe('```python\nre.compile(r"\\(x\\)")')
  })
})
