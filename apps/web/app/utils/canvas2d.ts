/** ¿Hay Canvas 2D? (en los tests no). Se prueba una vez por página: no se crea un lienzo y un contexto en cada gráfica. */
let drawable: boolean | null = null

export function canDraw2d(): boolean {
  if (drawable === null) {
    try {
      drawable = typeof document !== 'undefined' && !!document.createElement('canvas').getContext('2d')
    } catch {
      drawable = false
    }
  }
  return drawable
}
