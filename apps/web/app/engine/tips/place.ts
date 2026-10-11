/**
 * Dónde va una burbuja de la guía de primer uso (ítem 18): junto a su ancla, en el primer lado donde cabe entera
 * (debajo, encima, a la derecha, a la izquierda), alineada con el centro del ancla y dentro de la ventana; sin ancla
 * visible (un panel plegado, otra disposición en tablet) o si no cabe en ningún lado, centrada. Nunca tapa el ancla.
 * TS puro (rectángulos en px CSS de la ventana): el componente mide y coloca; esto solo decide. Se llama al abrir, al
 * cambiar de paso y al redimensionar o girar la tablet, nunca por frame.
 */

export interface TipBox {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export interface TipSize {
  readonly width: number
  readonly height: number
}

/** Lado del ancla en el que queda la burbuja; `center`, sin ancla. */
export type TipSide = 'bottom' | 'top' | 'right' | 'left' | 'center'

export interface TipPlacement {
  readonly left: number
  readonly top: number
  readonly side: TipSide
  /**
   * Flecha hacia el ancla: px desde el borde izquierdo (arriba y abajo) o superior (a los lados) de la burbuja; null
   * centrada.
   */
  readonly arrow: number | null
}

/** Margen mínimo con los bordes de la ventana. */
export const TIP_MARGIN_PX = 12
/** Separación entre el ancla y la burbuja (deja sitio a la flecha y al anillo del ancla). */
export const TIP_GAP_PX = 14
/** La flecha no llega a las esquinas redondeadas. */
export const TIP_ARROW_PAD_PX = 16

/** Orden de preferencia de los lados. */
export const TIP_SIDES: readonly Exclude<TipSide, 'center'>[] = ['bottom', 'top', 'right', 'left']

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Centrada en la ventana (sin salirse por arriba ni por la izquierda si no cabe). */
export function centerTip(size: TipSize, viewport: TipSize): TipPlacement {
  return {
    left: Math.max(TIP_MARGIN_PX, Math.round((viewport.width - size.width) / 2)),
    top: Math.max(TIP_MARGIN_PX, Math.round((viewport.height - size.height) / 2)),
    side: 'center',
    arrow: null,
  }
}

/** La burbuja de tamaño `size` junto al ancla (o centrada, sin ella o si no cabe en ningún lado). */
export function placeTip(
  anchor: TipBox | null,
  size: TipSize,
  viewport: TipSize,
  sides: readonly Exclude<TipSide, 'center'>[] = TIP_SIDES,
): TipPlacement {
  if (!anchor) return centerTip(size, viewport)
  const m = TIP_MARGIN_PX
  const g = TIP_GAP_PX
  const right = anchor.left + anchor.width
  const bottom = anchor.top + anchor.height
  const cx = anchor.left + anchor.width / 2
  const cy = anchor.top + anchor.height / 2
  const fitsAcross = size.width <= viewport.width - 2 * m
  const fitsDown = size.height <= viewport.height - 2 * m

  for (const side of sides) {
    if (side === 'bottom' || side === 'top') {
      if (!fitsAcross) continue
      const room = side === 'bottom' ? viewport.height - bottom - g - m : anchor.top - g - m
      if (room < size.height) continue
      const left = Math.round(clamp(cx - size.width / 2, m, viewport.width - m - size.width))
      const top = Math.round(side === 'bottom' ? bottom + g : anchor.top - g - size.height)
      return { left, top, side, arrow: Math.round(clamp(cx - left, TIP_ARROW_PAD_PX, size.width - TIP_ARROW_PAD_PX)) }
    }
    if (!fitsDown) continue
    const room = side === 'right' ? viewport.width - right - g - m : anchor.left - g - m
    if (room < size.width) continue
    const top = Math.round(clamp(cy - size.height / 2, m, viewport.height - m - size.height))
    const left = Math.round(side === 'right' ? right + g : anchor.left - g - size.width)
    return { left, top, side, arrow: Math.round(clamp(cy - top, TIP_ARROW_PAD_PX, size.height - TIP_ARROW_PAD_PX)) }
  }
  return centerTip(size, viewport)
}

/** ¿Se ve el rectángulo en la ventana (con tamaño y al menos en parte dentro)? */
export function boxOnScreen(box: TipBox, viewport: TipSize): boolean {
  return (
    box.width > 0 &&
    box.height > 0 &&
    box.left + box.width > 0 &&
    box.top + box.height > 0 &&
    box.left < viewport.width &&
    box.top < viewport.height
  )
}
