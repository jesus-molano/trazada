/**
 * Bench de rendimiento (`/replay?s=…&bench=1`): reproduce con los 22 coches y el panel de telemetría
 * abierto, calienta W s y mide D s de frames (deltas de requestAnimationFrame). Resultado en
 * `window.__trazada.bench` y en el panel del bench. Parámetros: benchSeconds, benchWarmup, benchRate.
 */
import type { Rate } from '~/engine/clock/SessionClock'
import { type FrameSummary, summarize } from '~/engine/perf/frames'
import { sceneStats } from './debug'
import type { ReplayRuntime } from './runtime'

export interface BenchOptions {
  warmupS: number
  measureS: number
  rate: Rate
}

export interface BenchResult extends FrameSummary {
  durationS: number
  /** Heap JS usado al final (MB; solo Chromium expone performance.memory). */
  heapMB: number | null
  longTasks: number
  longTaskMaxMs: number
  dpr: number
  dprChanges: number
  drawCalls: number
  triangles: number
  visibleCars: number
  telemetryOpen: boolean
  gpu: string
  viewport: [number, number]
  devicePixelRatio: number
  userAgent: string
  session: string
}

export interface BenchState {
  status: 'warmup' | 'measuring' | 'done'
  elapsedS: number
  result: BenchResult | null
}

const RATES: readonly Rate[] = [1, 2, 4, 8, 16]

export function benchOptions(query: Record<string, unknown>): BenchOptions {
  const num = (v: unknown, def: number) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : def
  }
  const rate = num(query.benchRate, 1)
  return {
    warmupS: num(query.benchWarmup, 10),
    measureS: num(query.benchSeconds, 30),
    rate: (RATES.includes(rate as Rate) ? rate : 1) as Rate,
  }
}

/**
 * Inicio del bench: en carrera, un minuto después de la salida; en el resto, el instante con más
 * coches en pista (muestreo cada 30 s). Siempre con margen para la duración pedida.
 */
export function benchStart(rt: ReplayRuntime, neededMs: number): number {
  const { playback } = rt.session.manifest.session
  const latest = Math.max(playback.startMs, playback.endMs - neededMs)
  if (playback.lightsOutMs != null) return Math.min(latest, playback.lightsOutMs + 60_000)
  let best = playback.startMs
  let bestCount = -1
  for (let t = playback.startMs; t <= latest; t += 30_000) {
    rt.model.update(t)
    const n = rt.model.states.filter((st) => st.visible && !st.inPit).length
    if (n > bestCount) {
      bestCount = n
      best = t
    }
  }
  return best
}

/** Lanza el bench. `select` abre el panel de telemetría del coche dado; `onChange` recibe el estado. */
export function runBench(
  rt: ReplayRuntime,
  opts: BenchOptions,
  select: (car: string) => void,
  onChange: (s: BenchState) => void,
): () => void {
  rt.clock.seek(benchStart(rt, (opts.warmupS + opts.measureS + 5) * 1000 * opts.rate))
  rt.clock.setRate(opts.rate)
  const first = rt.leaderboard.compute(rt.clock.timeMs, rt.model.states)[0]?.car ?? rt.drivers[0]?.number
  if (first) select(first)
  rt.clock.play()

  const deltas: number[] = []
  let longTasks = 0
  let longTaskMaxMs = 0
  const observer =
    typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')
      ? new PerformanceObserver((list) => {
          if (state.status !== 'measuring') return
          for (const e of list.getEntries()) {
            longTasks++
            longTaskMaxMs = Math.max(longTaskMaxMs, e.duration)
          }
        })
      : null
  observer?.observe({ type: 'longtask', buffered: false })

  const state: BenchState = { status: 'warmup', elapsedS: 0, result: null }
  const t0 = performance.now()
  let measureFrom = 0
  let last = 0
  let raf = 0
  let lastNotify = 0

  const finish = (now: number) => {
    rt.clock.pause()
    observer?.disconnect()
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
    state.status = 'done'
    state.result = {
      ...summarize(deltas),
      durationS: (now - measureFrom) / 1000,
      heapMB: memory ? Math.round((memory.usedJSHeapSize / 1048576) * 10) / 10 : null,
      longTasks,
      longTaskMaxMs: Math.round(longTaskMaxMs),
      dpr: sceneStats.dpr,
      dprChanges: sceneStats.dprChanges,
      drawCalls: sceneStats.drawCalls,
      triangles: sceneStats.triangles,
      visibleCars: rt.model.states.filter((s) => s.visible).length,
      telemetryOpen: !!document.querySelector('[data-testid="telemetry"]'),
      gpu: sceneStats.gpu,
      viewport: [window.innerWidth, window.innerHeight],
      devicePixelRatio: window.devicePixelRatio,
      userAgent: navigator.userAgent,
      session: rt.session.id,
    }
    onChange({ ...state })
  }

  const loop = (now: number) => {
    if (last > 0 && state.status === 'measuring') deltas.push(now - last)
    last = now
    const elapsed = (now - t0) / 1000
    if (state.status === 'warmup' && elapsed >= opts.warmupS) {
      state.status = 'measuring'
      measureFrom = now
    }
    state.elapsedS = elapsed
    if (state.status === 'measuring' && now - measureFrom >= opts.measureS * 1000) {
      finish(now)
      return
    }
    if (now - lastNotify > 250) {
      lastNotify = now
      onChange({ ...state })
    }
    raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)
  onChange({ ...state })

  return () => {
    cancelAnimationFrame(raf)
    observer?.disconnect()
  }
}
