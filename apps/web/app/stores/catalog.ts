import { type Catalog, type CatalogEvent, isCatalog } from '@trazada/schema'
import { defineStore } from 'pinia'
import { shallowRef } from 'vue'

/** Primera temporada que cubre el proyecto (las anteriores no se ofrecen). */
export const FIRST_SEASON = 2023

export const useCatalogStore = defineStore('catalog', () => {
  const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const error = ref<string | null>(null)
  const catalog = shallowRef<Catalog | null>(null)

  /** Temporadas ofrecidas: de FIRST_SEASON a la más reciente (con o sin datos), de nueva a antigua. */
  const seasons = computed<number[]>(() => {
    const withData = catalog.value?.seasons.map((s) => s.season) ?? []
    const last = Math.max(new Date().getFullYear(), ...withData)
    const out: number[] = []
    for (let y = last; y >= FIRST_SEASON; y--) out.push(y)
    return out
  })

  function eventsOf(season: number): CatalogEvent[] {
    return catalog.value?.seasons.find((s) => s.season === season)?.events ?? []
  }

  async function load(force = false): Promise<void> {
    if (status.value === 'loading' || (status.value === 'ready' && !force)) return
    status.value = 'loading'
    error.value = null
    try {
      const url = useDataUrl()('catalog.json')
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const value: unknown = await res.json()
      if (!isCatalog(value)) throw new Error('catálogo inválido')
      catalog.value = markRaw(value)
      status.value = 'ready'
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      status.value = 'error'
    }
  }

  return { status, error, catalog, seasons, eventsOf, load }
})
