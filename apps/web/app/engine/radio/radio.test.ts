import type { RadioClip } from '@trazada/schema'
import { describe, expect, it } from 'vitest'
import { clipsUpTo, clipUrl, liveClip, radioClips, radioStatus } from './radio'

const clip = (t: number, car: string, n = 0): RadioClip => ({ t, car, file: `radio/${String(n).padStart(16, 'a')}.mp3`, bytes: 1000 })
const CLIPS = [clip(1000, '44', 1), clip(5000, '1', 2), clip(5000, '16', 3), clip(9000, '44', 4)]
const TIMES = CLIPS.map((c) => c.t)

describe('radio de los equipos (D51)', () => {
  it('el estado sale del manifest; sin el campo, la sesión es de antes de 1.2.0', () => {
    expect(radioStatus({ channels: { drs: 'absent', elevation: 'flat', radio: 'partial' } })).toBe('partial')
    expect(radioStatus({ channels: { drs: 'absent', elevation: 'flat' } })).toBe('outdated')
  })

  it('clips en orden y sin rutas raras; la URL va junto al manifest', () => {
    const list = radioClips({ radio: [CLIPS[3]!, { ...CLIPS[0]!, file: '../x.mp3' }, CLIPS[0]!] })
    expect(list.map((c) => c.t)).toEqual([1000, 9000])
    expect(radioClips({})).toEqual([])
    expect(clipUrl('/data/v1/sessions/2026/14-madrid/race/manifest.json', CLIPS[0]!)).toBe(
      '/data/v1/sessions/2026/14-madrid/race/radio/aaaaaaaaaaaaaaa1.mp3',
    )
    expect(clipUrl('/m/manifest.json', { file: 'https://x/y.mp3' })).toBeNull()
  })

  it('solo los publicados hasta el instante (nunca del futuro)', () => {
    expect(clipsUpTo(TIMES, 999)).toBe(0)
    expect(clipsUpTo(TIMES, 5000)).toBe(3)
    expect(clipsUpTo(TIMES, 1e9)).toBe(4)
  })

  it('en directo: el más reciente del tramo, del coche elegido o de todos; hacia atrás, ninguno', () => {
    expect(liveClip(CLIPS, TIMES, 900, 1100, null)).toBe(0)
    expect(liveClip(CLIPS, TIMES, 4000, 6000, null)).toBe(2)
    expect(liveClip(CLIPS, TIMES, 4000, 6000, '1')).toBe(1)
    expect(liveClip(CLIPS, TIMES, 4000, 6000, '44')).toBe(-1)
    expect(liveClip(CLIPS, TIMES, 1000, 1000, null)).toBe(-1) // el del instante de partida ya sonó
    expect(liveClip(CLIPS, TIMES, 9500, 2000, null)).toBe(-1)
  })
})
