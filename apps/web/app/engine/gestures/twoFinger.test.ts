import { describe, expect, it } from 'vitest'
import { classifyTwoFinger, type FingerPair, fingerMidX, fingerSpan, SCRUB_WINDOW_MS, scrubOffsetMs, TWO_FINGER } from './twoFinger'

/** Dos dedos uno al lado del otro, a 200 px, en el centro de una escena de 1000 px. */
const START: FingerPair = { ax: 400, ay: 400, bx: 600, by: 400 }

/** Desplaza cada dedo (a y b) desde `start`. */
function move(start: FingerPair, [dax, day]: [number, number], [dbx, dby]: [number, number]): FingerPair {
  return { ax: start.ax + dax, ay: start.ay + day, bx: start.bx + dbx, by: start.by + dby }
}

/** Clasificación de una traza: cada paso es el desplazamiento acumulado de los dos dedos. */
function trace(start: FingerPair, steps: [[number, number], [number, number]][]) {
  return steps.map(([a, b]) => classifyTwoFinger(start, move(start, a, b)))
}

describe('classifyTwoFinger', () => {
  it('sin decidir hasta que un dedo recorre 12 px', () => {
    expect(classifyTwoFinger(START, START)).toBeNull()
    expect(classifyTwoFinger(START, move(START, [6, 0], [6, 0]))).toBeNull()
    expect(classifyTwoFinger(START, move(START, [0, 11], [8, 8]))).toBeNull()
    expect(classifyTwoFinger(START, move(START, [TWO_FINGER.decidePx, 0], [TWO_FINGER.decidePx, 0]))).toBe('scrub')
  })

  it('deslizar los dos dedos en paralelo y en horizontal mueve el reloj (a los dos lados)', () => {
    expect(trace(START, [[[4, 0], [4, 1]], [[14, 1], [13, 2]], [[40, 3], [38, 2]]])).toEqual([null, 'scrub', 'scrub'])
    expect(classifyTwoFinger(START, move(START, [-20, 2], [-19, -1]))).toBe('scrub')
    // También con los dedos uno encima del otro y algo de ruido.
    const stacked: FingerPair = { ax: 500, ay: 300, bx: 500, by: 500 }
    expect(classifyTwoFinger(stacked, move(stacked, [30, 4], [26, -3]))).toBe('scrub')
  })

  it('arrastrar en vertical (inclinar) o en diagonal no es el reloj: es el mapa', () => {
    expect(classifyTwoFinger(START, move(START, [0, 30], [1, 30]))).toBe('map')
    expect(classifyTwoFinger(START, move(START, [0, -30], [0, -28]))).toBe('map')
    expect(classifyTwoFinger(START, move(START, [20, 20], [20, 20]))).toBe('map')
    // A poco más de 27° de la horizontal, ya no.
    expect(classifyTwoFinger(START, move(START, [20, 11], [20, 11]))).toBe('map')
  })

  it('girar los dedos es el mapa (ni zoom ni reloj)', () => {
    // Giro alrededor del punto medio: un dedo sube y el otro baja.
    expect(classifyTwoFinger(START, move(START, [0, 20], [0, -20]))).toBe('map')
    // Un dedo quieto y el otro girando alrededor de él (la separación apenas cambia).
    expect(classifyTwoFinger(START, move(START, [0, 0], [-1, 20]))).toBe('map')
  })

  it('juntar o separar los dedos es un pellizco, también si uno se queda quieto o el punto medio deriva', () => {
    expect(classifyTwoFinger(START, move(START, [-12, 0], [12, 0]))).toBe('pinch')
    expect(classifyTwoFinger(START, move(START, [12, 0], [-12, 0]))).toBe('pinch')
    expect(classifyTwoFinger(START, move(START, [0, 0], [16, 0]))).toBe('pinch')
    expect(classifyTwoFinger(START, move(START, [-4, 2], [14, 1]))).toBe('pinch')
    // En diagonal, con los dedos en diagonal.
    const diag: FingerPair = { ax: 400, ay: 400, bx: 540, by: 540 }
    expect(classifyTwoFinger(diag, move(diag, [-10, -10], [10, 10]))).toBe('pinch')
  })

  it('un deslizamiento horizontal en el que los dedos se separan no mueve el reloj', () => {
    // Los dos a la derecha, pero uno el doble que el otro: la separación cambia demasiado.
    expect(classifyTwoFinger(START, move(START, [12, 0], [30, 0]))).not.toBe('scrub')
    // Uno se mueve y el otro casi nada: no es paralelo.
    expect(classifyTwoFinger(START, move(START, [20, 0], [3, 0]))).not.toBe('scrub')
  })

  it('los umbrales se pueden ajustar', () => {
    const strict = { ...TWO_FINGER, decidePx: 30 }
    expect(classifyTwoFinger(START, move(START, [20, 0], [20, 0]), strict)).toBeNull()
    expect(classifyTwoFinger(START, move(START, [30, 0], [30, 0]), strict)).toBe('scrub')
  })
})

describe('scrubOffsetMs', () => {
  it('todo el ancho son 2 minutos, lineal y con signo', () => {
    expect(SCRUB_WINDOW_MS).toBe(120_000)
    expect(scrubOffsetMs(1000, 1000)).toBe(120_000)
    expect(scrubOffsetMs(500, 1000)).toBe(60_000)
    expect(scrubOffsetMs(-250, 1000)).toBe(-30_000)
    expect(scrubOffsetMs(0, 1000)).toBe(0)
  })

  it('sin ancho o sin desplazamiento válido, nada', () => {
    expect(scrubOffsetMs(100, 0)).toBe(0)
    expect(scrubOffsetMs(Number.NaN, 1000)).toBe(0)
  })

  it('separación y punto medio de los dedos', () => {
    expect(fingerSpan(START)).toBe(200)
    expect(fingerMidX(START)).toBe(500)
  })
})
