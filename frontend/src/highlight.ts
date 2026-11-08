// Syntax highlighting with highlight.js for code visuals and markdown code blocks: only the languages in
// shared/scene.json (and their usual aliases, like "py" or "ts"). Colors are the .hljs-* rules in index.css.
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

const languages = { bash, c, cpp, csharp, css, dockerfile, go, java, javascript, json, kotlin, python, rust, sql, typescript, xml, yaml }
for (const [name, language] of Object.entries(languages)) hljs.registerLanguage(name, language)

/** The code as highlighted HTML (escaped, safe to insert), or null for plaintext and unknown languages. */
export const highlight = (code: string, language: string): string | null =>
  hljs.getLanguage(language) ? hljs.highlight(code, { language, ignoreIllegals: true }).value : null
