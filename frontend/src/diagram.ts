// Pure helpers that keep Mermaid diagrams readable in a narrow container.

/** The flowchart redrawn top-down when it runs left-right (LR or RL), since a wide chart shrinks its text on
 * a phone; null for any other diagram. Front matter, %%{init}%% directives and comments stay as they are. */
export function topDown(code: string): string | null {
  const lines = code.split('\n')
  let i = lines[0]?.trim() === '---' ? lines.findIndex((l, j) => j > 0 && l.trim() === '---') + 1 : 0
  for (; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.startsWith('%%{')) while (i < lines.length - 1 && !lines[i].includes('}%%')) i++
    else if (line && !line.startsWith('%%')) {
      const header = /^(\s*(?:flowchart|graph)\s+)(?:LR|RL)\b/.exec(lines[i])
      if (!header) return null
      lines[i] = header[1] + 'TD' + lines[i].slice(header[0].length)
      return lines.join('\n')
    }
  }
  return null
}

/** The width a rendered Mermaid SVG is drawn at by default (its viewBox), or 0 if it doesn't say. */
export function svgWidth(svg: string): number {
  const box = /viewBox="\s*[-\d.e]+[\s,]+[-\d.e]+[\s,]+([\d.e]+)/.exec(svg)
  return box ? Number(box[1]) : 0
}
