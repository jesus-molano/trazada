/**
 * Guía de primer uso (ítem 18): lo visto se guarda por paso en `trazada.tips`; la secuencia (siguiente, anterior,
 * saltar), una versión nueva que enseña solo lo nuevo, `{ all: true }` de los e2e y el almacenamiento roto o ausente.
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { markSeen, pendingTips, readTips, TIP_IDS, type TipId, TIPS_KEY, toSaved, useTipsStore } from './tips'

/** localStorage mínimo en memoria. */
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial))
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  }
}

let storage: Storage
const stored = () => JSON.parse(storage.getItem(TIPS_KEY) ?? 'null') as unknown

beforeEach(() => {
  storage = memoryStorage()
  vi.stubGlobal('localStorage', storage)
  setActivePinia(createPinia())
})
afterEach(() => vi.unstubAllGlobals())

describe('lo visto (funciones puras)', () => {
  it('valida campo a campo: lo que no es una lista de textos no cuenta', () => {
    expect(readTips({})).toEqual({ all: false, seen: new Set() })
    expect(readTips({ all: true })).toEqual({ all: true, seen: new Set() })
    const raw = { all: 'sí', seen: ['timeline', 3, null, '', 'analysis'] } as unknown as Parameters<typeof readTips>[0]
    expect(readTips(raw)).toEqual({ all: false, seen: new Set(['timeline', 'analysis']) })
    expect(readTips({ seen: 'timeline' } as unknown as Parameters<typeof readTips>[0]).seen.size).toBe(0)
  })

  it('pendientes en el orden de la guía; `all` las da todas por vistas', () => {
    expect(pendingTips(readTips({}))).toEqual([...TIP_IDS])
    expect(pendingTips(readTips({ seen: ['analysis', 'leaderboard'] }))).toEqual(['follow', 'timeline', 'estimated', 'palette'])
    expect(pendingTips(readTips({ all: true }))).toEqual([])
  })

  it('una versión nueva con un paso más enseña solo ese', () => {
    const v1 = readTips({ seen: [...TIP_IDS] })
    const v2 = [...TIP_IDS, 'gestures'] as unknown as TipId[]
    expect(pendingTips(v1, v2)).toEqual(['gestures'])
  })

  it('apuntar no pierde lo de otras versiones y `all` se queda', () => {
    const s = markSeen(readTips({ seen: ['de-una-version-futura'] }), ['timeline'])
    expect(toSaved(s)).toEqual({ seen: ['de-una-version-futura', 'timeline'] })
    expect(toSaved(markSeen(readTips({ all: true }), ['timeline']))).toEqual({ all: true })
  })
})

describe('useTipsStore', () => {
  it('la primera vez: secuencia completa; «Siguiente» apunta cada paso y el último cierra', () => {
    const tips = useTipsStore()
    expect(tips.open).toBe(false)
    expect(tips.start('auto')).toBe(true)
    expect(tips.mode).toBe('auto')
    expect([tips.current, tips.index, tips.total, tips.last]).toEqual(['leaderboard', 0, TIP_IDS.length, false])
    tips.next()
    expect(tips.current).toBe('follow')
    expect(stored()).toEqual({ seen: ['leaderboard'] })
    tips.prev()
    expect(tips.current).toBe('leaderboard')
    tips.prev()
    expect(tips.index).toBe(0)
    for (let i = 0; i < TIP_IDS.length - 1; i++) tips.next()
    expect(tips.last).toBe(true)
    tips.next()
    expect(tips.open).toBe(false)
    expect(stored()).toEqual({ seen: [...TIP_IDS] })
    // Ya vistas: no vuelven solas.
    expect(tips.start('auto')).toBe(false)
    expect(tips.open).toBe(false)
  })

  it('«Saltar» se recuerda: todos los pasos de la guía abierta quedan vistos', () => {
    const tips = useTipsStore()
    tips.start('auto')
    tips.next()
    tips.skip()
    expect(tips.open).toBe(false)
    expect(stored()).toEqual({ seen: [...TIP_IDS] })
    expect(tips.pending()).toEqual([])
  })

  it('salir a mitad (cerrar sin saltar): lo no visto vuelve la próxima vez, y solo eso', () => {
    const tips = useTipsStore()
    tips.start('auto')
    tips.next()
    tips.next()
    tips.close()
    expect(tips.start('auto')).toBe(true)
    expect(tips.steps).toEqual(['timeline', 'estimated', 'analysis', 'palette'])
    expect(tips.total).toBe(4)
  })

  it('a petición (botón, tecla o paleta): entera desde el principio aunque esté vista; «?» la abre y la salta', () => {
    storage.setItem(TIPS_KEY, JSON.stringify({ seen: [...TIP_IDS] }))
    const tips = useTipsStore()
    expect(tips.start('auto')).toBe(false)
    tips.toggle()
    expect(tips.open).toBe(true)
    expect(tips.mode).toBe('manual')
    expect(tips.steps).toEqual([...TIP_IDS])
    // Abierta, otro start no la reinicia.
    tips.next()
    expect(tips.start('manual')).toBe(true)
    expect(tips.index).toBe(1)
    tips.toggle()
    expect(tips.open).toBe(false)
  })

  it('`{ "all": true }` (los e2e): nada sale solo, también con pasos de versiones futuras', () => {
    storage.setItem(TIPS_KEY, JSON.stringify({ all: true }))
    const tips = useTipsStore()
    expect(tips.pending()).toEqual([])
    expect(tips.start('auto')).toBe(false)
    tips.start('manual')
    tips.skip()
    expect(stored()).toEqual({ all: true })
  })

  it('JSON roto u otro tipo: como la primera vez; al apuntar se sobrescribe bien', () => {
    for (const raw of ['{roto', '[1,2]', '"texto"', '{"seen":{"a":1}}']) {
      storage.setItem(TIPS_KEY, raw)
      setActivePinia(createPinia())
      const tips = useTipsStore()
      expect(tips.pending(), raw).toEqual([...TIP_IDS])
    }
    const tips = useTipsStore()
    tips.start('auto')
    tips.skip()
    expect(stored()).toEqual({ seen: [...TIP_IDS] })
  })

  it('sin almacenamiento (bloqueado o lleno): la guía funciona y lo visto vive solo en memoria de la sesión', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new DOMException('bloqueado', 'SecurityError')
      },
      setItem: () => {
        throw new DOMException('lleno', 'QuotaExceededError')
      },
    })
    const tips = useTipsStore()
    expect(tips.start('auto')).toBe(true)
    expect(() => tips.next()).not.toThrow()
    expect(() => tips.skip()).not.toThrow()
    expect(tips.open).toBe(false)
  })
})
