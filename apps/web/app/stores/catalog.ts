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

  async function fetchCatalog(): Promise<Catalog> {
    const res = await fetch(useDataUrl()('catalog.json'), { cache: 'no-store' })
    // Sin catálogo todavía (instalación nueva, nada descargado): catálogo vacío, no un error.
    if (res.status === 404) return { schema: 'trazada.catalog', schemaVersion: '', generatedAt: '', seasons: [] }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const value: unknown = await res.json()
    if (!isCatalog(value)) throw new Error('catálogo inválido')
    return value
  }

  async function load(force = false): Promise<void> {
    if (status.value === 'loading' || (status.value === 'ready' && !force)) return
    status.value = 'loading'
    error.value = null
    try {
      catalog.value = markRaw(await fetchCatalog())
      status.value = 'ready'
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      status.value = 'error'
    }
  }

  /** Relee el catálogo sin pasar por "cargando" (tras una descarga del gestor local); si falla, se queda el actual. */
  async function refresh(): Promise<void> {
    if (status.value !== 'ready') return load(true)
    try {
      catalog.value = markRaw(await fetchCatalog())
    } catch {
      // el siguiente refresco lo reintenta
    }
  }

  return { status, error, catalog, seasons, eventsOf, load, refresh }
})
