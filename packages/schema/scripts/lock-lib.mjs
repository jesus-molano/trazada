import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

export const LAYOUT_NAMES = ['motion', 'car', 'circuit', 'timing']

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

/** Hash del contenido normativo del layout (tablas, columnas, tipos), sin descripciones. */
export function layoutHash(layout) {
  const stripped = JSON.parse(JSON.stringify(layout), (key, val) => (key === 'description' ? undefined : val))
  return createHash('sha256').update(canonical(stripped)).digest('hex')
}

export function readJson(url) {
  return JSON.parse(readFileSync(url, 'utf8'))
}
