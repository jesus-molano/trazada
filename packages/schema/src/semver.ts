export type SemVer = [number, number, number]

export function parseSemver(v: string): SemVer {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v)
  if (!m) throw new Error(`versión semver inválida: ${v}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  for (let i = 0; i < 3; i++) {
    const d = pa[i]! - pb[i]!
    if (d !== 0) return Math.sign(d)
  }
  return 0
}

/** El lector (`readerVersion`) puede leer datos que exigen `minReader` si comparte major y no es más antiguo. */
export function canRead(readerVersion: string, minReader: string): boolean {
  return parseSemver(readerVersion)[0] === parseSemver(minReader)[0] && compareSemver(readerVersion, minReader) >= 0
}
