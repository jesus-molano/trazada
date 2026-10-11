/**
 * Posición de un coche en la escena (ejes de three, Y arriba, antes de la exageración de altura), con el
 * desplazamiento lateral de la separación visual (opción Estimado) a lo largo de la normal izquierda del
 * rumbo. La comparten los coches, sus siglas y la cámara de seguimiento, para que coincidan.
 */
export interface CarPoseInput {
  x: number
  y: number
  z: number
  heading: number
}

export interface CarPose {
  x: number
  /** Altura (m) sin exagerar: quien la dibuja la multiplica por la escala de altura. */
  y: number
  z: number
}

export function carPose(st: CarPoseInput, offset: number, flat: boolean, out: CarPose): CarPose {
  out.x = st.x - Math.sin(st.heading) * offset
  out.y = flat ? 0 : st.z
  out.z = -(st.y + Math.cos(st.heading) * offset)
  return out
}
