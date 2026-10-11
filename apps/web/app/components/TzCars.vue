<script setup lang="ts">
/**
 * Los coches (D28). De lejos, una cuña con el color del equipo y sus caras sombreadas
 * (engine/car/wedgeGeometry.ts), que crece para verse a escala de mapa; de cerca, un monoplaza genérico
 * generado por código (engine/car/carGeometry.ts) a tamaño real, con la carrocería del color del equipo y
 * el color del compuesto que lleva en los neumáticos (dato de timing; gris sin dato). El cambio entre los
 * dos tiene histéresis (engine/car/carLod.ts).
 *
 * Todo instanciado: la cuña (una instancia por coche, en el orden de los estados), el modelo detallado en
 * tres capas que comparten matrices (solo los coches de cerca, compactados al principio) y un proxy
 * invisible para elegir coche con un clic o un toque. Las matrices se escriben antes de cada render desde el
 * ReplayModel (`useSceneFrame`; nada en pausa ni con la escena tapada), sin reactividad. Va dentro de TresCanvas, en
 * el grupo con la escala de altura.
 *
 * Los coches se dibujan siempre por encima de la pista y de las banderas de sector: van en la pasada de
 * transparentes (con opacidad 1), después de las capas de banderas, y antes del primero se borra la
 * profundidad. Las cuñas no usan profundidad (a escala de mapa, sus techos casi coplanarios parpadearían
 * entre sí); el modelo detallado sí (sus piezas y los coches cercanos se tapan bien). Colores sin tone
 * mapping: la carrocería coincide con la franja de la sigla.
 */
import { useTres } from '@tresjs/core'
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  type PerspectiveCamera,
  Quaternion,
  Vector3,
  type WebGLRenderer,
} from 'three'
import { useSceneFrame } from '~/composables/useSceneFrame'
import { useCarTap } from '~/composables/useSceneGestures'
import { token } from '~/design/tokens'
import { buildCar, CAR_PARTS, type CarLayerGeometry, type CarPart } from '~/engine/car/carGeometry'
import { carSizeScale, nextDetail, screenLengthPx } from '~/engine/car/carLod'
import { buildWedge } from '~/engine/car/wedgeGeometry'
import { carPose } from '~/engine/replay/carPose'
import { compoundToken } from '~/engine/timing/compound'
import { sceneStats } from '~/replay/debug'
import { getRuntime, usePlaybackStore } from '~/stores/playback'
import { useSessionStore } from '~/stores/session'

/** `detail`: false para dibujar siempre la cuña (`?car=wedge`, para comparar en el bench). */
const props = defineProps<{ yScale: number; flat: boolean; detail: boolean }>()

const rt = getRuntime()!
const playback = usePlaybackStore()
const states = rt.model.states
const offsets = rt.offsets
const N = states.length

/** Elevación sobre la pista (m): poca, porque los coches no compiten en profundidad con ella. */
const LIFT_M = 0.02
/** Escala de la cuña del coche elegido (de lejos; de cerca el coche se ve con su tamaño real). */
const SELECTED_SCALE = 1.35
/** Longitud del coche (m) para el nivel de detalle. */
const CAR_LENGTH_M = 5.25

/** Cuña (engine/car/wedgeGeometry.ts): su sombreado horneado va en el color por vértice, como en el coche. */
function wedgeGeometry(): BufferGeometry {
  const w = buildWedge()
  const colors = new Float32Array(w.shade.length * 3)
  for (let i = 0; i < w.shade.length; i++) colors.fill(w.shade[i]!, i * 3, i * 3 + 3)
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(w.positions, 3))
  g.setAttribute('color', new BufferAttribute(colors, 3))
  return g
}

/** Color de cada clase neutra (lineal, como espera three en los colores por vértice). */
const NEUTRAL: Partial<Record<CarPart, Color>> = {
  carbon: new Color(token('--tz-car-carbon')),
  dark: new Color(token('--tz-car-dark')),
  tyre: new Color(token('--tz-car-tyre')),
  rim: new Color(token('--tz-car-rim')),
  halo: new Color(token('--tz-car-halo')),
  helmet: new Color(token('--tz-car-helmet')),
}

/** Geometría de una capa del coche: sombreado horneado × color de la clase (blanco en pintura y banda). */
function layerGeometry(l: CarLayerGeometry): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(l.positions, 3))
  const colors = new Float32Array(l.shade.length * 3)
  const c = new Color()
  for (let i = 0; i < l.shade.length; i++) {
    const base = NEUTRAL[CAR_PARTS[l.part[i]!]!]
    c.setRGB(1, 1, 1)
    if (base) c.copy(base)
    c.multiplyScalar(l.shade[i]!).toArray(colors, i * 3)
  }
  g.setAttribute('color', new BufferAttribute(colors, 3))
  return g
}

/**
 * Pasada de transparentes (opacidad 1): después de las capas de banderas de la pista (ver arriba). Sin la niebla del
 * ambiente (D37): el color del equipo y el del compuesto no se atenúan con la distancia.
 */
const material = (vertexColors: boolean, depth: boolean) =>
  new MeshBasicMaterial({
    color: 0xffffff,
    vertexColors,
    toneMapped: false,
    transparent: true,
    depthTest: depth,
    depthWrite: depth,
    fog: false,
  })

// Cuña: una instancia por coche (índice = estado), con el color del equipo.
// Convexa: sin profundidad, sus caras no se pisan (solo se dibujan las de delante).
const wedge = new InstancedMesh(wedgeGeometry(), material(true, false), N)
wedge.frustumCulled = false
wedge.renderOrder = 10
// Se dibuja antes que el modelo detallado (y nunca se oculta con `visible`, o no se llamaría): borra la
// profundidad para que los coches queden por encima de la pista, pero se tapen entre ellos.
wedge.onBeforeRender = (renderer) => (renderer as WebGLRenderer).clearDepth()

const car = buildCar()
const layers = (['paint', 'neutral', 'band'] as const).map((layer) => {
  const mesh = new InstancedMesh(layerGeometry(car.layers[layer]), material(true, true), N)
  mesh.frustumCulled = false
  mesh.renderOrder = 11
  mesh.count = 0
  mesh.visible = false
  return mesh
})
const [paint, , band] = layers as [(typeof layers)[number], (typeof layers)[number], (typeof layers)[number]]
// Las tres capas comparten matrices: se suben una vez por frame.
for (const mesh of layers) mesh.instanceMatrix = paint.instanceMatrix
paint.instanceColor = new InstancedBufferAttribute(new Float32Array(N * 3), 3)
band.instanceColor = new InstancedBufferAttribute(new Float32Array(N * 3), 3)

// Proxy de selección: una caja invisible por coche (no se dibuja, pero sí recibe el clic o el toque).
const proxy = new InstancedMesh(new BoxGeometry(5.6, 1.2, 2.2).translate(0, 0.6, 0), new MeshBasicMaterial({ visible: false, fog: false }), N)
proxy.frustumCulled = false

const teamColor = states.map((st) => new Color(st.driver?.color ?? token('--tz-team-unknown')))
states.forEach((_, i) => wedge.setColorAt(i, teamColor[i]!))
wedge.instanceColor!.needsUpdate = true
/** Color de cada compuesto según la temporada (el de la clasificación); gris sin dato. */
const season = useSessionStore().data?.manifest.session.season ?? 0
const compoundColors = new Map<string, Color>()
function compoundColor(compound: string): Color {
  let c = compoundColors.get(compound)
  if (!c) compoundColors.set(compound, (c = new Color(token(compoundToken(season, compound)))))
  return c
}

const color = new Color()
sceneStats.instances = wedge.count
sceneStats.instanceColors = states.map((_, i) => {
  wedge.getColorAt(i, color)
  return `#${color.getHexString().toUpperCase()}`
})
sceneStats.instanceCars = states.map((st) => st.car)
sceneStats.carTriangles = car.triangles

const m = new Matrix4()
const zero = new Matrix4().makeScale(0, 0, 0)
const q = new Quaternion()
const p = new Vector3()
const sc = new Vector3()
const up = new Vector3(0, 1, 0)
const world = new Vector3()
const pose = { x: 0, y: 0, z: 0 }
/** Nivel de detalle de cada coche (1 = modelo detallado), con histéresis. */
const lod = new Uint8Array(N)

const { sizes } = useTres()
useSceneFrame(({ camera }) => {
  const cam = camera as PerspectiveCamera | undefined
  const yInv = 1 / Math.max(1e-3, props.yScale)
  const projY = cam?.projectionMatrix.elements[5] ?? 1
  const height = sizes.height.value
  const t = rt.clock.timeMs
  let shown = 0
  for (let i = 0; i < N; i++) {
    const st = states[i]!
    if (!st.visible) {
      wedge.setMatrixAt(i, zero)
      proxy.setMatrixAt(i, zero)
      lod[i] = 0
      continue
    }
    carPose(st, offsets[i]!, props.flat, pose)
    p.set(pose.x, pose.y + LIFT_M * yInv, pose.z)
    q.setFromAxisAngle(up, st.heading)
    // Tamaño visual: real de cerca y con un mínimo en pantalla al alejarse (solo visual, no la posición).
    const dist = cam ? cam.position.distanceTo(world.set(p.x, p.y * props.yScale, p.z)) : Infinity
    const k = carSizeScale(dist)
    const near = props.detail && cam !== undefined && nextDetail(lod[i] === 1, screenLengthPx(CAR_LENGTH_M * k, dist, projY, height))
    lod[i] = near ? 1 : 0
    // La escala Y compensa la exageración de altura del grupo (el coche no se estira).
    sc.set(k, k * yInv, k)
    m.compose(p, q, sc)
    if (near) {
      paint.setMatrixAt(shown, m)
      paint.setColorAt(shown, teamColor[i]!)
      band.setColorAt(shown, compoundColor(rt.leaderboard.compoundAt(st.car, t)))
      shown++
      wedge.setMatrixAt(i, zero)
    } else {
      if (playback.selectedCar === st.car) {
        sc.multiplyScalar(SELECTED_SCALE)
        m.compose(p, q, sc)
      }
      wedge.setMatrixAt(i, m)
    }
    // El proxy, con el tamaño con el que se dibuja el coche (también la cuña ampliada del elegido).
    proxy.setMatrixAt(i, m)
  }
  for (const mesh of layers) {
    mesh.count = shown
    mesh.visible = shown > 0
  }
  wedge.instanceMatrix.needsUpdate = true
  proxy.instanceMatrix.needsUpdate = true
  if (shown > 0) {
    paint.instanceMatrix.needsUpdate = true
    paint.instanceColor!.needsUpdate = true
    band.instanceColor!.needsUpdate = true
  }
  sceneStats.carLod = { detail: shown, wedge: states.reduce((n, st, i) => n + (st.visible && !lod[i] ? 1 : 0), 0) }
  // three cachea la esfera envolvente de las instancias en el primer raycast: se invalida al moverlas,
  // o un raycast hecho con los coches ocultos (escala 0) dejaría una esfera diminuta y nunca acertaría.
  proxy.boundingSphere = null
})

/**
 * Selección con clic o toque sobre el coche (raycast de Tres sobre el proxy, un frame después del evento): lo elige o lo
 * deja como siempre, salvo que sea el segundo toque de un doble toque, que ya lo sigue (ítem 17, `useCarTap`).
 */
const carTap = useCarTap()
function onClick(event: {
  instanceId?: number
  stopPropagation?: () => void
  nativeEvent?: { clientX?: number; clientY?: number; timeStamp: number }
}) {
  const i = event.instanceId
  if (i === undefined) return
  const st = states[i]
  if (!st?.visible) return
  event.stopPropagation?.()
  const n = event.nativeEvent
  carTap(st.car, { x: n?.clientX ?? Number.NaN, y: n?.clientY ?? Number.NaN, t: n?.timeStamp ?? performance.now() })
}

onBeforeUnmount(() => {
  for (const mesh of [wedge, ...layers, proxy]) {
    mesh.geometry.dispose()
    ;(mesh.material as MeshBasicMaterial).dispose()
    mesh.dispose()
  }
  sceneStats.carLod = { detail: 0, wedge: 0 }
})
</script>

<template>
  <TresGroup>
    <primitive :object="wedge" />
    <primitive v-for="(mesh, i) in layers" :key="i" :object="mesh" />
    <primitive :object="proxy" @click="onClick" />
  </TresGroup>
</template>
