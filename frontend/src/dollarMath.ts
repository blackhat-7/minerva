// Fenced code blocks (closed or still streaming in) and inline code, where \( and \[ are code, not math.
const CODE = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/

/** \(…\) and \[…\] math written as remark-math's $…$ and $$…$$, leaving code alone. */
export function dollarMath(text: string): string {
  return text
    .split(CODE)
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `$$${m}$$`).replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$${m}$`),
    )
    .join('')
}
