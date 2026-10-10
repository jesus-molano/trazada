import { describe, expect, it } from 'vitest'
import { persisted, VERSION_FIELD } from './persisted'

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

interface Prefs {
  mode: string
  n: number
}

describe('persisted (D41)', () => {
  it('ida y vuelta; un parche no pisa lo demás', () => {
    const storage = memoryStorage()
    const p = persisted<Prefs>('trazada.test', { storage: () => storage })
    expect(p.read()).toEqual({})
    p.write({ mode: 'a', n: 1 })
    p.patch({ n: 2 })
    expect(p.read()).toEqual({ mode: 'a', n: 2 })
    expect(JSON.parse(storage.getItem('trazada.test')!)).toEqual({ mode: 'a', n: 2 })
    p.clear()
    expect(p.read()).toEqual({})
  })

  it('sin versión, lee el formato de siempre (objeto plano, como trazada.settings)', () => {
    const storage = memoryStorage({ 'trazada.settings': '{"gapMode":"interval","followDistance":30}' })
    expect(persisted('trazada.settings', { storage: () => storage }).read()).toEqual({ gapMode: 'interval', followDistance: 30 })
  })

  it('con versión, la guarda y descarta lo de otra versión o sin ella', () => {
    const storage = memoryStorage()
    const v2 = persisted<Prefs>('trazada.layout', { version: 2, storage: () => storage })
    v2.write({ mode: 'analysis' })
    expect(JSON.parse(storage.getItem('trazada.layout')!)).toEqual({ mode: 'analysis', [VERSION_FIELD]: 2 })
    expect(v2.read()).toEqual({ mode: 'analysis' })
    expect(persisted<Prefs>('trazada.layout', { version: 3, storage: () => storage }).read()).toEqual({})
    storage.setItem('trazada.layout', '{"mode":"x"}')
    expect(v2.read()).toEqual({})
  })

  it('JSON roto, algo que no es un objeto o un almacenamiento que no está: vacío, sin lanzar', () => {
    for (const raw of ['{roto', '[1,2]', '42', 'null', '"texto"']) {
      expect(persisted('k', { storage: () => memoryStorage({ k: raw }) }).read(), raw).toEqual({})
    }
    expect(persisted('k', { storage: () => null }).read()).toEqual({})
    const blocked = persisted<Prefs>('k', {
      storage: () => {
        throw new DOMException('bloqueado', 'SecurityError')
      },
    })
    expect(blocked.read()).toEqual({})
    expect(() => blocked.patch({ n: 1 })).not.toThrow()
    expect(() => blocked.clear()).not.toThrow()
  })

  it('escribir con el almacenamiento lleno o en modo privado no lanza', () => {
    const full = memoryStorage()
    full.setItem = () => {
      throw new DOMException('lleno', 'QuotaExceededError')
    }
    expect(() => persisted<Prefs>('k', { storage: () => full }).write({ n: 1 })).not.toThrow()
  })

  it('sin localStorage (SSR o Node), por defecto: vacío y sin lanzar', () => {
    const p = persisted<Prefs>('trazada.test')
    expect(p.read()).toEqual({})
    expect(() => p.patch({ n: 1 })).not.toThrow()
  })
})
