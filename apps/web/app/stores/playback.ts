import { defineStore } from 'pinia'
import type { Rate } from '~/engine/clock/SessionClock'
import type { ReplayRuntime } from '~/replay/runtime'

/** Runtime activo (no reactivo: Vue nunca lo recorre). */
let runtime: ReplayRuntime | null = null
let offCoarse: (() => void) | null = null

export function getRuntime(): ReplayRuntime | null {
  return runtime
}

/**
 * Estado grueso de la reproducción (≤ 10 Hz) y acciones sobre el reloj maestro. La UI lee de aquí;
 * los consumidores por frame (escena, cabezal del timeline) se suscriben al runtime.
 */
export const usePlaybackStore = defineStore('playback', () => {
  const attached = ref(false)
  const timeMs = ref(0)
  const playing = ref(false)
  const rate = ref<Rate>(1)
  const selectedCar = ref<string | null>(null)
  /** Orden para ↑/↓: lo fija el leaderboard; por defecto, el orden del manifest. */
  const order = shallowRef<string[]>([])

  function attach(rt: ReplayRuntime): void {
    detach()
    runtime = rt
    order.value = rt.drivers.map((d) => d.number)
    selectedCar.value = null
    offCoarse = rt.onCoarse((s) => {
      timeMs.value = s.timeMs
      playing.value = s.playing
      rate.value = s.rate
    })
    attached.value = true
  }

  function detach(): void {
    offCoarse?.()
    offCoarse = null
    runtime?.dispose()
    runtime = null
    attached.value = false
  }

  const toggle = () => runtime?.clock.toggle()
  const play = () => runtime?.clock.play()
  const pause = () => runtime?.clock.pause()
  const setRate = (r: Rate) => runtime?.clock.setRate(r)
  const seek = (t: number) => runtime?.clock.seek(t)
  const seekBy = (dt: number) => runtime?.clock.seekBy(dt)

  function selectCar(car: string | null): void {
    selectedCar.value = car
    runtime?.requestFrame()
  }

  /** ↑ (−1) / ↓ (+1) recorren el orden; sin selección, empiezan por el primero o el último. */
  function selectRelative(step: 1 | -1): void {
    const list = order.value
    if (list.length === 0) return
    const i = selectedCar.value ? list.indexOf(selectedCar.value) : -1
    const next = i < 0 ? (step > 0 ? 0 : list.length - 1) : (i + step + list.length) % list.length
    selectCar(list[next]!)
  }

  return {
    attached,
    timeMs,
    playing,
    rate,
    selectedCar,
    order,
    attach,
    detach,
    toggle,
    play,
    pause,
    setRate,
    seek,
    seekBy,
    selectCar,
    selectRelative,
  }
})
