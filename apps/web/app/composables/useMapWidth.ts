import { useLoop, useTres } from '@tresjs/core'
import { type PerspectiveCamera, Vector3 } from 'three'
import { screenHalfWidth, viewDistance, widthChanged } from '~/engine/track/mapWidth'

/**
 * Anchura «de mapa» de una cinta (pista, pit lane, capas de banderas): antes de cada render calcula la
 * semianchura visible (la real de cerca; de lejos, `minPx` en pantalla) y llama a `apply` solo si ha cambiado.
 * Va dentro de TresCanvas. Todas las capas con los mismos parámetros obtienen el mismo valor en cada frame.
 */
export function useMapWidth(realHalf: number, minPx: number, groundY: number, apply: (half: number) => void): void {
  const { sizes } = useTres()
  const { onBeforeRender } = useLoop()
  const dir = new Vector3()
  let current = realHalf
  onBeforeRender(({ camera }) => {
    const cam = camera.value as PerspectiveCamera | undefined
    if (!cam) return
    cam.getWorldDirection(dir)
    const half = screenHalfWidth(realHalf, viewDistance(cam.position, dir, groundY), cam.fov, sizes.height.value, minPx)
    if (!widthChanged(current, half)) return
    current = half
    apply(half)
  })
}
