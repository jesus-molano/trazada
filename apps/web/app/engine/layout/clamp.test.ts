import { describe, expect, it } from 'vitest'
import {
  clampTo,
  clampWidths,
  limitsFor,
  NARROW_LIMITS,
  panelBudget,
  rangeFor,
  sanitizeWidth,
  SCENE_MIN_PX,
  SCENE_MIN_SHARE,
  sceneMinWidth,
  type StageGeometry,
  WIDE_LIMITS,
} from './clamp'

/** Escenario de una ventana de `vw` px (márgenes de 24 px a cada lado, como en la página). */
const geo = (vw: number, lbExtra = 30): StageGeometry => ({ stage: vw - 48, lbExtra, limits: limitsFor(vw) })

/** El mapa: lo que queda entre los dos paneles. */
const scene = (g: StageGeometry, w: { lb: number; side: number }) => g.stage - (w.lb + g.lbExtra) - w.side

describe('límites de los paneles (ítem 15)', () => {
  it('escritorio y tablet en horizontal (≤ 1100 px), con mínimos que dejan sitio a las columnas fijas', () => {
    expect(limitsFor(1440)).toBe(WIDE_LIMITS)
    expect(limitsFor(1101)).toBe(WIDE_LIMITS)
    expect(limitsFor(1100)).toBe(NARROW_LIMITS)
    expect(limitsFor(1024)).toBe(NARROW_LIMITS)
    for (const l of [WIDE_LIMITS, NARROW_LIMITS]) {
      for (const p of [l.lb, l.side]) expect(p.min).toBeLessThan(p.max)
    }
  })

  it('el mapa nunca baja de su mínimo absoluto ni de su fracción del escenario', () => {
    expect(sceneMinWidth(800)).toBe(SCENE_MIN_PX)
    expect(sceneMinWidth(1872)).toBe(Math.round(1872 * SCENE_MIN_SHARE))
  })

  it('las cifras que promete D44: max(320 px, 35 % del escenario), en literales y no con las constantes', () => {
    // Si alguien cambia el 35 % o los 320 px, estas cifras dejan de cuadrar (con las constantes, no lo notaría nadie).
    expect(sceneMinWidth(800)).toBe(320)
    expect(sceneMinWidth(914)).toBe(320) // 319,9 → el mínimo absoluto
    expect(sceneMinWidth(1232)).toBe(431) // ventana de 1280 px
    expect(sceneMinWidth(1392)).toBe(487) // 1440 px
    expect(sceneMinWidth(1872)).toBe(655) // 1920 px
    expect(sceneMinWidth(2512)).toBe(879) // 2560 px
  })

  it('con los dos paneles al máximo y las columnas de «Análisis», el mapa conserva el 35 % del escenario', () => {
    for (const vw of [1280, 1440, 1920, 2560]) {
      const g = geo(vw, 182)
      const w = clampWidths({ lb: 480, side: 480 }, g)
      expect(scene(g, w), `${vw} px`).toBeGreaterThanOrEqual(Math.round(0.35 * g.stage))
      expect(scene(g, w), `${vw} px`).toBeGreaterThanOrEqual(320)
    }
    // A 1440 px los paneles ceden: el mapa se queda justo en su 35 % (487 px de 1392), no en los 320 px.
    expect(scene(geo(1440, 182), clampWidths({ lb: 480, side: 480 }, geo(1440, 182)))).toBe(488)
  })
})

describe('anchos guardados: lo corrupto vuelve al de por defecto (null)', () => {
  it('números finitos dentro de los límites, redondeados', () => {
    expect(sanitizeWidth(300)).toBe(300)
    expect(sanitizeWidth(312.6)).toBe(313)
    expect(sanitizeWidth(NARROW_LIMITS.lb.min)).toBe(NARROW_LIMITS.lb.min)
    expect(sanitizeWidth(WIDE_LIMITS.lb.max)).toBe(WIDE_LIMITS.lb.max)
  })

  it('fuera de límites, no numérico o no finito: null', () => {
    for (const x of [0, -300, 10, 5000, Number.NaN, Infinity, '300', null, undefined, {}, [300], true]) {
      expect(sanitizeWidth(x), String(x)).toBeNull()
    }
  })
})

describe('clampWidths: cada panel en sus límites y el mapa con su mínimo', () => {
  it('los anchos por defecto del diseño Espectador pasan sin cambios en las ventanas de siempre', () => {
    expect(clampWidths({ lb: 300, side: 300 }, geo(1440))).toEqual({ lb: 300, side: 300 })
    expect(clampWidths({ lb: 300, side: 300 }, geo(1280))).toEqual({ lb: 300, side: 300 })
    expect(clampWidths({ lb: 256, side: 256 }, geo(1024))).toEqual({ lb: 256, side: 256 })
    expect(clampWidths({ lb: 300, side: 300 }, geo(1920))).toEqual({ lb: 300, side: 300 })
  })

  it('cada panel dentro de sus límites', () => {
    expect(clampWidths({ lb: 100, side: 9000 }, geo(2560))).toEqual({ lb: WIDE_LIMITS.lb.min, side: WIDE_LIMITS.side.max })
    expect(clampWidths({ lb: Number.NaN, side: 300 }, geo(1440)).lb).toBe(WIDE_LIMITS.lb.min)
  })

  it('si los dos no dejan al mapa su mínimo, se recortan en proporción a lo que tienen por encima del suyo', () => {
    const g = geo(1280, 182)
    const w = clampWidths({ lb: 480, side: 480 }, g)
    expect(scene(g, w)).toBeGreaterThanOrEqual(sceneMinWidth(g.stage))
    expect(w.lb + w.side).toBeLessThanOrEqual(panelBudget(g))
    // Cada uno cede la misma parte de lo que tenía por encima de su mínimo.
    const ceded = (x: number, min: number) => (480 - x) / (480 - min)
    expect(ceded(w.lb, WIDE_LIMITS.lb.min)).toBeCloseTo(ceded(w.side, WIDE_LIMITS.side.min), 1)
    expect(w.lb).toBeGreaterThanOrEqual(WIDE_LIMITS.lb.min)
    expect(w.side).toBeGreaterThanOrEqual(WIDE_LIMITS.side.min)
  })

  it('ventana demasiado estrecha para el mínimo del mapa: los dos al mínimo (nada desborda)', () => {
    expect(clampWidths({ lb: 400, side: 400 }, geo(1024, 200))).toEqual({ lb: NARROW_LIMITS.lb.min, side: NARROW_LIMITS.side.min })
  })

  it('invariantes con anchos y ventanas al azar (semilla fija)', () => {
    let seed = 15
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    for (let i = 0; i < 500; i++) {
      const vw = 900 + Math.round(rand() * 2000)
      const g = geo(vw, Math.round(rand() * 250))
      const w = clampWidths({ lb: rand() * 800, side: rand() * 800 }, g)
      expect(Number.isInteger(w.lb) && Number.isInteger(w.side)).toBe(true)
      expect(w.lb).toBeGreaterThanOrEqual(g.limits.lb.min)
      expect(w.lb).toBeLessThanOrEqual(g.limits.lb.max)
      expect(w.side).toBeGreaterThanOrEqual(g.limits.side.min)
      expect(w.side).toBeLessThanOrEqual(g.limits.side.max)
      // O el mapa conserva su mínimo, o los dos paneles ya están en el suyo.
      const atMin = w.lb === g.limits.lb.min && w.side === g.limits.side.min
      expect(atMin || scene(g, w) >= sceneMinWidth(g.stage)).toBe(true)
    }
  })
})

describe('rangeFor: los límites del asa con el otro panel fijo', () => {
  it('el máximo deja al mapa su mínimo; nunca baja del mínimo del panel', () => {
    const g = geo(1440)
    const r = rangeFor('lb', 300, g)
    expect(r.min).toBe(WIDE_LIMITS.lb.min)
    expect(r.max).toBeLessThanOrEqual(WIDE_LIMITS.lb.max)
    expect(scene(g, { lb: r.max, side: 300 })).toBeGreaterThanOrEqual(sceneMinWidth(g.stage))
    // Con la otra columna muy ancha y la ventana estrecha, el máximo es el mínimo (el asa no se mueve).
    const tight = rangeFor('side', 400, geo(1024, 200))
    expect(tight.max).toBe(tight.min)
  })

  it('clampTo redondea y respeta los límites', () => {
    expect(clampTo(301.4, { min: 280, max: 480 })).toBe(301)
    expect(clampTo(10, { min: 280, max: 480 })).toBe(280)
    expect(clampTo(900, { min: 280, max: 480 })).toBe(480)
  })
})
