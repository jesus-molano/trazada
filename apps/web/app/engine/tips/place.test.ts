import { describe, expect, it } from 'vitest'
import { boxOnScreen, placeTip, TIP_ARROW_PAD_PX, TIP_GAP_PX, TIP_MARGIN_PX, type TipBox } from './place'

const VIEW = { width: 1440, height: 900 }
const SIZE = { width: 340, height: 200 }

/** ¿Se solapan la burbuja colocada y el ancla? */
const overlaps = (a: TipBox, p: { left: number; top: number }) =>
  p.left < a.left + a.width && p.left + SIZE.width > a.left && p.top < a.top + a.height && p.top + SIZE.height > a.top

const inside = (p: { left: number; top: number }, view = VIEW) =>
  p.left >= TIP_MARGIN_PX &&
  p.top >= TIP_MARGIN_PX &&
  p.left + SIZE.width <= view.width - TIP_MARGIN_PX &&
  p.top + SIZE.height <= view.height - TIP_MARGIN_PX

describe('placeTip', () => {
  it('sin ancla: centrada, sin flecha', () => {
    expect(placeTip(null, SIZE, VIEW)).toEqual({ left: 550, top: 350, side: 'center', arrow: null })
  })

  it('un botón de la cabecera: debajo, centrada en él y con la flecha apuntándolo', () => {
    const button = { left: 1100, top: 12, width: 28, height: 28 }
    const p = placeTip(button, SIZE, VIEW)
    expect(p.side).toBe('bottom')
    expect(p.top).toBe(12 + 28 + TIP_GAP_PX)
    expect(p.left + p.arrow!).toBe(1114)
    expect(inside(p)).toBe(true)
    expect(overlaps(button, p)).toBe(false)
  })

  it('pegado al borde derecho: se queda dentro y la flecha sigue al ancla (sin llegar a la esquina)', () => {
    const button = { left: 1410, top: 12, width: 28, height: 28 }
    const p = placeTip(button, SIZE, VIEW)
    expect(p.left).toBe(VIEW.width - TIP_MARGIN_PX - SIZE.width)
    expect(p.arrow).toBe(SIZE.width - TIP_ARROW_PAD_PX)
  })

  it('el timeline, abajo: encima', () => {
    const timeline = { left: 300, top: 820, width: 900, height: 40 }
    const p = placeTip(timeline, SIZE, VIEW)
    expect(p.side).toBe('top')
    expect(p.top + SIZE.height).toBe(820 - TIP_GAP_PX)
    expect(overlaps(timeline, p)).toBe(false)
  })

  it('la clasificación, alta y a la izquierda: a su derecha, a media altura', () => {
    const board = { left: 24, top: 60, width: 300, height: 720 }
    const p = placeTip(board, SIZE, VIEW)
    expect(p.side).toBe('right')
    expect(p.left).toBe(24 + 300 + TIP_GAP_PX)
    expect(p.top + p.arrow!).toBe(420)
    expect(overlaps(board, p)).toBe(false)
  })

  it('un panel alto a la derecha: a su izquierda', () => {
    const side = { left: 1116, top: 60, width: 300, height: 720 }
    expect(placeTip(side, SIZE, VIEW).side).toBe('left')
  })

  it('si no cabe en ningún lado (ancla enorme o ventana pequeña): centrada', () => {
    const huge = { left: 0, top: 0, width: 1440, height: 900 }
    expect(placeTip(huge, SIZE, VIEW).side).toBe('center')
    const small = { width: 320, height: 480 }
    expect(placeTip({ left: 10, top: 10, width: 20, height: 20 }, SIZE, small).side).toBe('center')
  })

  it('centrada en una ventana más pequeña que la burbuja: no se sale por arriba ni por la izquierda', () => {
    const p = placeTip(null, { width: 500, height: 900 }, { width: 400, height: 600 })
    expect([p.left, p.top]).toEqual([TIP_MARGIN_PX, TIP_MARGIN_PX])
  })
})

describe('boxOnScreen', () => {
  it('con tamaño y al menos en parte dentro de la ventana', () => {
    expect(boxOnScreen({ left: 10, top: 10, width: 20, height: 20 }, VIEW)).toBe(true)
    expect(boxOnScreen({ left: 10, top: 10, width: 0, height: 20 }, VIEW)).toBe(false)
    expect(boxOnScreen({ left: -40, top: 10, width: 20, height: 20 }, VIEW)).toBe(false)
    expect(boxOnScreen({ left: 10, top: 900, width: 20, height: 20 }, VIEW)).toBe(false)
    expect(boxOnScreen({ left: 1430, top: 10, width: 20, height: 20 }, VIEW)).toBe(true)
  })
})
