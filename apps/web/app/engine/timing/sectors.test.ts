import { describe, expect, it } from 'vitest'
import { loadFixture } from '../../testing/fixture'
import { lapDeletedMessage, type LapInput, timingBuilder } from '../../testing/laps'
import { buildLapTable } from '../analysis/lapTable'
import { type LapSectors, SectorTimes } from './sectors'

/** Vuelta de `start` a `start` + S1 + S2 + S3 con esos sectores (lapMs = la suma). */
function lap(start: number, sectors: [number, number, number], over: LapInput = {}): LapInput {
  const ms = sectors.reduce((a, b) => a + Math.max(0, b), 0)
  return { startMs: start, endMs: start + ms, lapMs: ms, sectors, ...over }
}

/** Estados y tiempos de los tres sectores, compactos: «b31000 p48000 n29000». */
const show = (x: LapSectors | null) =>
  x ? x.sectors.map((s) => `${s.status[0]}${s.ms ?? '-'}`).join(' ') + (x.deleted ? ' anulada' : '') : null

describe('colores de sector (D34)', () => {
  it('morado = mejor de la sesión al completarlo; si otro lo mejora después, el anterior no cambia', () => {
    const timing = timingBuilder()
      .lap(1, 1, lap(0, [30_000, 40_000, 30_000])) // fin 100 000
      .lap(1, 2, lap(100_000, [29_000, 41_000, 31_000])) // fin 201 000
      .lap(2, 1, lap(20_000, [29_500, 39_000, 32_000])) // fin 120 500
      .build()
    const st = new SectorTimes(buildLapTable('fp1', timing, []))
    // Coche 1, vuelta 1: primeros tiempos de la sesión en cada sector.
    expect(show(st.lastLap('1', 100_000))).toBe('b30000 b40000 b30000')
    // Coche 2, vuelta 1: mejora S1 y S2 (morado); S3 peor que el del coche 1 pero su primer tiempo (verde).
    expect(show(st.lastLap('2', 120_500))).toBe('b29500 b39000 p32000')
    // Lo que ya se pintó no cambia aunque el coche 2 lo haya mejorado.
    expect(show(st.lastLap('1', 150_000))).toBe('b30000 b40000 b30000')
    // Coche 1, vuelta 2: S1 mejor que el morado de 29 500 (morado); S2 y S3 peores que sus propios mejores.
    expect(show(st.lastLap('1', 201_000))).toBe('b29000 n41000 n31000')
  })

  it('verde = mejor personal (estricto), amarillo = el resto', () => {
    const timing = timingBuilder()
      .lap(1, 1, lap(0, [30_000, 40_000, 30_000]))
      .lap(2, 1, lap(0, [31_000, 41_000, 31_000]))
      .lap(2, 2, lap(103_000, [30_500, 41_000, 31_500]))
      .build()
    const st = new SectorTimes(buildLapTable('fp1', timing, []))
    expect(show(st.lastLap('2', 103_000))).toBe('p31000 p41000 p31000')
    // S1 mejora su marca (verde); S2 la iguala (amarillo: un empate no es mejora); S3 peor (amarillo).
    expect(show(st.lastLap('2', 206_000))).toBe('p30500 n41000 n31500')
  })

  it('un empate con el mejor de la sesión no es morado', () => {
    const timing = timingBuilder()
      .lap(1, 1, lap(0, [30_000, 40_000, 30_000]))
      .lap(2, 1, lap(5_000, [30_000, 39_000, 31_000]))
      .build()
    const st = new SectorTimes(buildLapTable('fp1', timing, []))
    expect(show(st.lastLap('2', 200_000))).toBe('p30000 b39000 p31000')
  })

  it('sin tiempo de sector (−1): gris «sin dato», y no cuenta', () => {
    const timing = timingBuilder()
      .lap(1, 1, { startMs: 0, endMs: 100_000, lapMs: 100_000, sectors: [-1, 40_000, 30_000] })
      .lap(1, 2, lap(100_000, [31_000, 40_500, -1]))
      .build()
    const st = new SectorTimes(buildLapTable('fp1', timing, []))
    expect(st.lastLap('1', 100_000)!.sectors[0]).toEqual({ ms: null, status: 'none' })
    expect(show(st.lastLap('1', 100_000))).toBe('n- b40000 b30000')
    // S1 de la vuelta 2: el primero con tiempo (morado); S3 sin dato.
    expect(show(st.lastLap('1', 171_500))).toBe('b31000 n40500 n-')
    expect(st.timedSectors).toBe(4)
  })

  it('solo vueltas completadas en t: antes de la primera, null; y nada del futuro', () => {
    const timing = timingBuilder()
      .lap(1, 1, lap(0, [30_000, 40_000, 30_000]))
      .lap(1, 2, lap(100_000, [29_000, 39_000, 29_000]))
      .build()
    const st = new SectorTimes(buildLapTable('fp1', timing, []))
    expect(st.lastLap('1', 99_999)).toBeNull()
    expect(st.lastLap('1', 100_000)!.lap).toBe(1)
    // Con la vuelta 2 ya en curso (S1 y S2 completados), se sigue mostrando la última completa: la 1.
    expect(st.lastLap('1', 180_000)!.lap).toBe(1)
    expect(st.lastLap('1', 197_000)!.lap).toBe(2)
    expect(st.lastLap('99', 197_000)).toBeNull()
  })

  it('una «vuelta» sin paso por meta real (registro residual) no se muestra ni cuenta', () => {
    const timing = timingBuilder()
      .lap(1, 1, lap(0, [30_000, 40_000, 30_000]))
      .lap(1, 2, lap(100_000, [29_000, 40_000, 30_000]))
      // Coche 2: un registro de 5 s con un S1 «rapidísimo» (menos de la mitad de la mediana: no es una vuelta).
      .lap(2, 1, { startMs: 50_000, endMs: 55_000, lapMs: 5_000, sectors: [5_000, -1, -1] })
      .build()
    const st = new SectorTimes(buildLapTable('fp1', timing, []))
    expect(st.lastLap('2', 60_000)).toBeNull()
    expect(show(st.lastLap('1', 199_000))).toBe('b29000 n40000 n30000')
  })

  it('el instante de cada sector sale de la meta hacia atrás (S2 = meta − S3, S1 = meta − S3 − S2)', () => {
    // El coche 2 acaba su vuelta antes que el 1, pero su S1 se completa después (34 500 > 30 000).
    const timing = timingBuilder()
      .lap(1, 1, lap(0, [30_000, 40_000, 30_000])) // S1 en 30 000, fin 100 000
      .lap(2, 1, lap(5_000, [29_500, 30_000, 30_500])) // S1 en 34 500, fin 95 000
      .build()
    const st = new SectorTimes(buildLapTable('fp1', timing, []))
    // Por fin de vuelta, el S1 del coche 1 habría sido verde; por el instante real del sector, fue morado.
    expect(show(st.lastLap('1', 100_000))).toBe('b30000 p40000 b30000')
    expect(show(st.lastLap('2', 95_000))).toBe('b29500 b30000 b30500')
  })

  it('sin un tiempo posterior, el instante del sector es el paso por meta (cota superior)', () => {
    // Coche 1: S3 sin dato, así que su S2 (y su S1) se completan «en meta» (110 000), no en 70 000 (inicio + S1 + S2).
    const timing = timingBuilder()
      .lap(1, 1, { startMs: 0, endMs: 110_000, lapMs: 110_000, sectors: [30_000, 40_000, -1] })
      .lap(2, 1, lap(10_000, [31_000, 41_000, 30_000])) // S1 en 41 000, S2 en 82 000
      .build()
    const st = new SectorTimes(buildLapTable('fp1', timing, []))
    // El S2 del coche 2 es el primero que se sabe completado: morado (no se supone el del coche 1 antes).
    expect(show(st.lastLap('2', 112_000))).toBe('b31000 b41000 b30000')
    expect(show(st.lastLap('1', 112_000))).toBe('b30000 b40000 n-')
  })

  it('vuelta anulada: cuenta hasta el mensaje que la anula; desde entonces no cuenta y se muestra anulada', () => {
    const timing = timingBuilder()
      .lap(1, 1, lap(0, [30_000, 40_000, 30_000]))
      .lap(1, 2, lap(100_000, [29_000, 39_000, 29_000], { deleted: true })) // fin 197 000
      .lap(2, 1, lap(60_000, [29_500, 39_500, 29_500])) // S1 en 89 500 … fin 158 500
      .lap(2, 2, lap(158_500, [29_200, 39_200, 29_200])) // S1 en 187 700, S2 en 226 900, fin 256 100
      .build()
    // El mensaje llega a los 230 000: entre el S2 (226 900) y el S3 (256 100) de la vuelta 2 del coche 2.
    const rc = [lapDeletedMessage(230_000, '1', 97_000)]
    const st = new SectorTimes(buildLapTable('fp1', timing, rc))
    // Antes del mensaje, la vuelta 2 del coche 1 cuenta y es morada.
    expect(show(st.lastLap('1', 200_000))).toBe('b29000 b39000 b29000')
    // Desde el mensaje: anulada (mismos tiempos, sin color de mejora en pantalla).
    expect(show(st.lastLap('1', 230_000))).toBe('b29000 b39000 b29000 anulada')
    // Coche 2, vuelta 2: S1 y S2 se completan con la anulada vigente (verdes, no morados); el S3, ya sin ella, morado.
    expect(show(st.lastLap('2', 256_100))).toBe('p29200 p39200 b29200')
  })

  it('vuelta anulada sin mensaje: desde su final (su S3 ya no cuenta)', () => {
    const timing = timingBuilder()
      .lap(1, 1, lap(0, [30_000, 40_000, 30_000], { deleted: true }))
      .lap(2, 1, lap(50_000, [31_000, 41_000, 31_000])) // fin 153 000
      .build()
    const st = new SectorTimes(buildLapTable('fp1', timing, []))
    expect(show(st.lastLap('1', 100_000))).toBe('b30000 b40000 n30000 anulada')
    // El S1 del coche 2 (81 000) llega con la vuelta del coche 1 aún vigente: verde. El S2 y el S3, ya sin ella: morados.
    expect(show(st.lastLap('2', 153_000))).toBe('p31000 b41000 b31000')
  })

  it('la consulta devuelve siempre el mismo objeto para la misma vuelta y estado (sin reservar memoria)', () => {
    const timing = timingBuilder()
      .lap(1, 1, lap(0, [30_000, 40_000, 30_000], { deleted: true }))
      .lap(1, 2, lap(100_000, [30_000, 40_000, 30_000]))
      .build()
    const st = new SectorTimes(buildLapTable('fp1', timing, []))
    expect(st.lastLap('1', 120_000)).toBe(st.lastLap('1', 150_000))
    expect(Object.isFrozen(st.lastLap('1', 120_000))).toBe(true)
  })

  it('fixture de Spa (libres 1): sectores con datos y colores coherentes', async () => {
    const s = await loadFixture()
    const { type, playback } = s.manifest.session
    const st = new SectorTimes(buildLapTable(type, s.timing, s.events.raceControl))
    expect(st.timedSectors).toBeGreaterThan(1000)
    // COL (43), vuelta 19 (meta antes del extracto): S1 y S3 son su mejor personal, S2 no.
    expect(show(st.lastLap('43', playback.startMs))).toBe('p31237 n49112 p29144')
    // RUS (63), vuelta 20: sin tiempo de S1 → «sin dato».
    expect(st.lastLap('63', playback.startMs + 195_000)!.sectors[0]).toEqual({ ms: null, status: 'none' })
    // ALB (23), vuelta 20: anulada desde el mensaje de dirección de carrera.
    expect(st.lastLap('23', playback.startMs + 40_000)!.deleted).toBe(false)
    expect(st.lastLap('23', playback.startMs + 60_000)!.deleted).toBe(true)
  })
})
