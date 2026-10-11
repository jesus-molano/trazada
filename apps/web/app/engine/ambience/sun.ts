/**
 * Altura del sol (ambiente de la escena, D37) con las fórmulas de la NOAA (las de su calculadora solar, basadas en
 * Meeus): un instante UTC y una posición (latitud y longitud en grados) bastan. Nunca la hora local ni el huso
 * (`gmtOffset` no es fiable: +00:00 en sesiones dev y cuando FastF1 no lo trae): la hora UTC lo dice todo.
 *
 * Altura geométrica del centro del sol, sin corregir la refracción (≤ 0,6° junto al horizonte): para elegir el cielo
 * da igual, y así los umbrales (crepúsculo civil a −6°) son los de la definición. Precisión del orden de 0,01° entre
 * 1900 y 2100; las coordenadas del circuito van a 0,01°.
 */

const RAD = Math.PI / 180
const DEG = 180 / Math.PI
const DAY_MS = 86_400_000

const mod = (x: number, m: number) => ((x % m) + m) % m

/** Día juliano de un instante UTC (ms desde 1970). */
export function julianDay(utcMs: number): number {
  return utcMs / DAY_MS + 2_440_587.5
}

export interface SolarPosition {
  /** Altura sobre el horizonte (°): positiva de día, −6° al final del crepúsculo civil. */
  elevationDeg: number
  /** Declinación del sol (°). */
  declinationDeg: number
  /** Ecuación del tiempo (min). */
  equationOfTimeMin: number
  /** Ángulo horario (°): 0 al mediodía solar, negativo por la mañana. */
  hourAngleDeg: number
}

/** Posición del sol vista desde (`latDeg`, `lonDeg`; este positivo) en el instante `utcMs`. */
export function solarPosition(utcMs: number, latDeg: number, lonDeg: number): SolarPosition {
  // Siglos julianos desde J2000.0.
  const jc = (julianDay(utcMs) - 2_451_545) / 36_525
  const meanLong = mod(280.46646 + jc * (36000.76983 + jc * 0.0003032), 360)
  const meanAnom = 357.52911 + jc * (35999.05029 - 0.0001537 * jc)
  const ecc = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc)
  const center =
    Math.sin(meanAnom * RAD) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
    Math.sin(2 * meanAnom * RAD) * (0.019993 - 0.000101 * jc) +
    Math.sin(3 * meanAnom * RAD) * 0.000289
  const omega = 125.04 - 1934.136 * jc
  const apparentLong = meanLong + center - 0.00569 - 0.00478 * Math.sin(omega * RAD)
  const meanObliq = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60
  const obliq = meanObliq + 0.00256 * Math.cos(omega * RAD)
  const declination = Math.asin(Math.sin(obliq * RAD) * Math.sin(apparentLong * RAD)) * DEG

  const y = Math.tan((obliq / 2) * RAD) ** 2
  const l0 = meanLong * RAD
  const m = meanAnom * RAD
  const equationOfTime =
    4 *
    DEG *
    (y * Math.sin(2 * l0) -
      2 * ecc * Math.sin(m) +
      4 * ecc * y * Math.sin(m) * Math.cos(2 * l0) -
      0.5 * y * y * Math.sin(4 * l0) -
      1.25 * ecc * ecc * Math.sin(2 * m))

  // Tiempo solar verdadero (min) en la longitud del circuito: el huso no interviene.
  const minutesUtc = mod(utcMs, DAY_MS) / 60_000
  const trueSolar = mod(minutesUtc + equationOfTime + 4 * lonDeg, 1440)
  const hourAngle = trueSolar / 4 - 180

  const lat = latDeg * RAD
  const dec = declination * RAD
  const cosZenith = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(hourAngle * RAD)
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZenith))) * DEG
  return { elevationDeg: 90 - zenith, declinationDeg: declination, equationOfTimeMin: equationOfTime, hourAngleDeg: hourAngle }
}

/** Altura del sol (°) en (`latDeg`, `lonDeg`) en el instante `utcMs`; NaN si alguna entrada no es un número finito. */
export function solarElevationDeg(utcMs: number, latDeg: number, lonDeg: number): number {
  if (!Number.isFinite(utcMs) || !Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return Number.NaN
  return solarPosition(utcMs, latDeg, lonDeg).elevationDeg
}
