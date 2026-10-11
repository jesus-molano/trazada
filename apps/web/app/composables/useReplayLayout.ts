/**
 * Anchos de los paneles del replay (ítem 15, D41/D44): los del diseño elegido (stores/layout.ts) o los que puso el
 * usuario con las asas, recortados para que el mapa conserve su mínimo (engine/layout/clamp.ts). Se pasan a la página
 * como variables CSS (`--replay-lb-w`, `--replay-side-w`); lo guardado no se toca, así una ventana más ancha lo
 * recupera. En tablet vertical no hay anchos (los paneles van en la franja inferior, con la misma media query que el
 * CSS de la página). Estado grueso: cambia con la ventana (como mucho una vez por frame), el diseño o al soltar un asa.
 */
import { token } from '~/design/tokens'
import {
  clampWidths,
  type LayoutPanel,
  limitsFor,
  NARROW_MAX_PX,
  type PanelLimits,
  type PanelWidths,
  rangeFor,
  type StageGeometry,
} from '~/engine/layout/clamp'
import { cellsExtraPx, cellsFor, LEADERBOARD_CELLS } from '~/slots/leaderboard-cells'
import { useLayoutStore } from '~/stores/layout'

/** La media query del CSS de la página para la franja inferior (tablet en vertical): ahí no hay asas ni anchos. */
export const PORTRAIT_QUERY = '(width <= 900px) and (orientation: portrait)'

/** Hueco de la rejilla de la clasificación (`--lb-gap` en TzLeaderboard): 8 px, y 6 px con los paneles estrechos. */
const LB_GAP_PX = 8
const LB_GAP_NARROW_PX = 6

const px = (name: `--tz-${string}`) => Number.parseFloat(token(name)) || 0

export function useReplayLayout() {
  const layout = useLayoutStore()
  const width = ref(0)
  const portrait = ref(false)
  let query: MediaQueryList | null = null
  let raf = 0

  function read() {
    raf = 0
    width.value = window.innerWidth
    portrait.value = query?.matches ?? false
  }
  function schedule() {
    if (!raf) raf = requestAnimationFrame(read)
  }

  onMounted(() => {
    query = typeof window.matchMedia === 'function' ? window.matchMedia(PORTRAIT_QUERY) : null
    read()
    window.addEventListener('resize', schedule)
    query?.addEventListener?.('change', schedule)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('resize', schedule)
    query?.removeEventListener?.('change', schedule)
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  })

  const narrow = computed(() => width.value <= NARROW_MAX_PX)
  /** Hay anchos (y asas): fuera de la tablet en vertical, una vez medida la ventana. */
  const resizable = computed(() => width.value > 0 && !portrait.value)
  const gap = computed(() => (narrow.value ? LB_GAP_NARROW_PX : LB_GAP_PX))

  const geometry = computed<StageGeometry>(() => ({
    // El escenario tiene el margen de la página a cada lado (--tz-space-6).
    stage: width.value - 2 * px('--tz-space-6'),
    lbExtra: cellsExtraPx(cellsFor(LEADERBOARD_CELLS, layout.preset), gap.value),
    limits: limitsFor(width.value),
  }))

  /** Anchos por defecto: los de siempre en «Espectador»; en «Análisis», la columna derecha más ancha (no en tablet). */
  const defaults = computed<PanelWidths>(() => {
    const base = px(narrow.value ? '--tz-panel-w-narrow' : '--tz-panel-w')
    const side = layout.preset === 'analysis' && !narrow.value ? px('--tz-panel-w-wide') : base
    return { lb: base, side }
  })

  /** Lo que se pinta: lo elegido (o lo de por defecto), dejando al mapa su mínimo. */
  const widths = computed<PanelWidths>(() =>
    clampWidths(
      { lb: layout.current.lb ?? defaults.value.lb, side: layout.current.side ?? defaults.value.side },
      geometry.value,
    ),
  )

  /** Límites de cada asa con el otro panel donde está. */
  const ranges = computed<Record<LayoutPanel, PanelLimits>>(() => ({
    lb: rangeFor('lb', widths.value.side, geometry.value),
    side: rangeFor('side', widths.value.lb, geometry.value),
  }))

  /** Lo que las columnas de «Análisis» ensanchan la clasificación por encima de las de «Espectador». */
  const lbMore = computed(() =>
    Math.max(0, geometry.value.lbExtra - cellsExtraPx(cellsFor(LEADERBOARD_CELLS, 'spectator'), gap.value)),
  )

  const vars = computed(() =>
    resizable.value
      ? {
          '--replay-lb-w': `${widths.value.lb}px`,
          '--replay-side-w': `${widths.value.side}px`,
          '--replay-lb-more': `${lbMore.value}px`,
        }
      : undefined,
  )

  return { widths, ranges, vars, resizable }
}
