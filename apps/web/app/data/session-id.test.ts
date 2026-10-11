import { describe, expect, it } from 'vitest'
import { formatSessionId, manifestPath, parseSessionId, sessionIdFromManifestPath } from './session-id'

describe('identificador de sesión', () => {
  it('acepta identificadores válidos y los reconstruye igual', () => {
    for (const id of ['2026/10-spa-francorchamps/fp1', '2026/03-suzuka/race', '2023/22-yas-island/sprint']) {
      const parsed = parseSessionId(id)
      expect(parsed).not.toBeNull()
      expect(formatSessionId(parsed!)).toBe(id)
    }
  })

  it('rechaza rutas peligrosas o mal formadas', () => {
    for (const id of ['', '../../etc/passwd', '2026/10-spa/fp9', '2026/1-spa/fp1', '2026/10-Spa/fp1', '2026/10-spa/fp1/', 42, null]) {
      expect(parseSessionId(id)).toBeNull()
    }
  })

  it('traduce entre rutas de manifest e identificadores', () => {
    expect(sessionIdFromManifestPath('sessions/2026/10-spa-francorchamps/fp1/manifest.json')).toBe(
      '2026/10-spa-francorchamps/fp1',
    )
    expect(sessionIdFromManifestPath('sessions/../x/manifest.json')).toBeNull()
    expect(manifestPath('2026/03-suzuka/race')).toBe('sessions/2026/03-suzuka/race/manifest.json')
  })
})
