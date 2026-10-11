<script setup lang="ts">
/**
 * Cámara: vista general (MapControls), seguimiento del coche seleccionado (FollowCamera) o realización automática
 * (ítem 9, D39), con transiciones GSAP al entrar y al salir (instantáneas con prefers-reduced-motion). Va dentro de
 * TresCanvas y escribe la cámara antes de cada render (`useSceneFrame`). En la vista general, solo entonces (la mueven
 * los controles del mapa, que piden su frame); siguiendo a un coche o en la realización, en cada tick, porque se anima
 * sola y pide los frames que le faltan (también en pausa, mientras se acomoda).
 *
 * Realización automática: `engine/camera/Director.ts` decide el plano (unas 4 veces por segundo y al momento tras un
 * seek) y aquí se coloca la cámara. Dentro de ella, los cambios de plano y de cámara son siempre cortes secos (la pose
 * se copia de golpe); solo se vuela al entrar y al salir.
 * - Persecución: la cámara de seguimiento detrás del coche de atrás en pista, mirando al centro de la pareja y más
 *   lejos cuanto más separados (`pairChaseDistance`); el líder, solo.
 * - Cámara fija de curva (`cornerCams`): por fuera de la curva, mirando a la pareja; con reduced motion, al vértice y
 *   sin girar.
 * - Vista general: la que había al entrar.
 * - Tocar o arrastrar la escena, o la rueda sobre ella, la apaga y deja la cámara donde está, con los controles del
 *   mapa (que atienden ya ese mismo gesto). Las demás salidas (botón, T, Esc, elegir un coche) vuelven a la vista
 *   general; seguir a un coche lleva al seguimiento.
 */
import gsap from 'gsap'
import { type Camera, Vector3 } from 'three'
import type { MapControls } from 'three/examples/jsm/controls/MapControls.js'
import { useSceneFrame } from '~/composables/useSceneFrame'
import { duration, GSAP_EASE, useReducedMotion } from '~/design/motion'
import { CAM_HEIGHT_M, type CornerCam, cornerCams } from '~/engine/camera/cornerCams'
import { Director, type DirectorInput } from '~/engine/camera/Director'
import { CHASE_LEADER_DISTANCE_M, CHASE_MIN_DISTANCE_M, FollowCamera, pairChaseDistance } from '~/engine/camera/FollowCamera'
import type { TowerEntry } from '~/engine/leaderboard/leaderboard'
import { carPose } from '~/engine/replay/carPose'
import type { CarState } from '~/engine/replay/ReplayModel'
import { registerSceneStat, sceneStats } from '~/replay/debug'
import { getRuntime, usePlaybackStore } from '~/stores/playback'
import { useSettingsStore } from '~/stores/settings'
import { useTvStore } from '~/stores/tv'

const props = defineProps<{
  controls: MapControls | null
  yScale: number
  flat: boolean
  /** Vista general recalculada (si el lienzo cambió mientras se seguía a un coche); null para volver a la guardada. */
  refreshOverview?: () => { position: Vector3; target: Vector3 } | null
}>()
const emit = defineEmits<{ invalidate: []; overview: [] }>()

const rt = getRuntime()!
const playback = usePlaybackStore()
const settings = useSettingsStore()
const tv = useTvStore()
const reduced = useReducedMotion()
const follow = new FollowCamera(settings.followDistance)
const pose = { x: 0, y: 0, z: 0 }
/**
 * Desplazamiento lateral de la separación visual (Estimado) que sigue la cámara, suavizado: el del coche
 * cambia a saltos (al juntarse o separarse de otro) y la vista entera saltaría de lado.
 */
let camOffset = 0
let camOffsetSet = false
const OFFSET_RATE = 8 // 1/s

type Mode = 'overview' | 'to-follow' | 'follow' | 'to-overview' | 'to-tv' | 'tv'
let mode: Mode = 'overview'
const blend = { k: 0 }
let tween: gsap.core.Tween | null = null
const fromPos = new Vector3()
const fromTarget = new Vector3()
const overviewPos = new Vector3()
const overviewTarget = new Vector3()
const followPos = new Vector3()
const followTarget = new Vector3()
const tmpTarget = new Vector3()
/** Hacia dónde mira la cámara en el último render: punto de partida de cualquier transición. */
const lookTarget = new Vector3()
let cameraRef: Camera | null = null
/** Hay posición de seguimiento válida (el coche se ha visto desde el último reset). */
let hasFix = false
/** Seguimiento pedido, a la espera de la primera posición visible del coche para arrancar. */
let pendingFollow = false
/** Guardar la vista general al arrancar el seguimiento (solo si se sale de la vista general). */
let saveOverview = false
/** Hay una vista general guardada a la que volver (nunca se vuela a una sin guardar). */
let hasOverview = false

// --- Realización automática ---------------------------------------------------------------------------------------
/** Una decisión del director cada este tiempo de pared (y al momento tras un seek): los cortes van de 6 s en 6 s. */
const TV_DECIDE_MS = 250
/** Ritmo (1/s) al que la persecución se aleja o se acerca cuando la pareja se separa o se junta. */
const CHASE_DISTANCE_RATE = 1.5
const NO_TOWER: readonly TowerEntry[] = []
const director = new Director()
const chase = new FollowCamera(CHASE_MIN_DISTANCE_M)
let chaseDistance = CHASE_MIN_DISTANCE_M
/** Cámaras de curva del circuito: se calculan la primera vez que se enciende (y viven lo que el runtime). */
let cams: readonly CornerCam[] = []
const input: DirectorInput = {
  wallMs: 0,
  timeMs: 0,
  rate: 1,
  race: rt.leaderboard.race,
  cars: rt.model.states,
  tower: NO_TOWER,
  leader: () => leaderAt(input.timeMs),
  neutral: null,
  trackLength: rt.circuit.centerline.length,
  corners: [],
}
let lastDecision = -Infinity
/** Hubo un seek: el director decide en el próximo frame, sin esperar su turno. */
let jumpPending = false
/** Último corte del director ya aplicado a la cámara. */
let seenCut = -1
/** Encendida, a la espera de la primera pose del plano para volar hacia ella. */
let pendingTv = false
const shotPos = new Vector3()
const shotTarget = new Vector3()
const shotMid = new Vector3()
const poseA = { x: 0, y: 0, z: 0 }
const poseB = { x: 0, y: 0, z: 0 }
const chasePos = { x: 0, y: 0, z: 0 }

/** Líder de la clasificación (posición 1 conocida: torre o, sin ella, pasos por meta), nunca deducido de la pista. */
function leaderAt(t: number): string | null {
  const first = rt.leaderboard.compute(t, rt.model.states)[0]
  return first && first.position === 1 && first.positionKnown ? first.car : null
}

/** Los MapControls son un objeto de three que el rig gobierna (no estado de Vue). */
function mapControls(): MapControls | null {
  return props.controls
}

function resetFollow() {
  follow.reset()
  camOffsetSet = false
}

function setMode(m: Mode) {
  mode = m
  sceneStats.cameraMode = m
}

function startTween(to: 'follow' | 'overview') {
  tween?.kill()
  tween = null
  const cam = cameraRef
  if (!cam) return
  const c = mapControls()
  if (to === 'follow') {
    if (saveOverview) {
      // Se guarda la vista general para volver exactamente a ella.
      overviewPos.copy(cam.position)
      overviewTarget.copy(c?.target ?? tmpTarget.set(0, 0, 0))
      saveOverview = false
      hasOverview = true
    }
    if (c) c.enabled = false
  }
  fromPos.copy(cam.position)
  fromTarget.copy(lookTarget)
  const done = () => {
    tween = null
    setMode(to === 'follow' ? 'follow' : 'overview')
    if (to === 'overview') {
      cam.position.copy(overviewPos)
      cam.lookAt(overviewTarget)
      lookTarget.copy(overviewTarget)
      if (c) {
        c.target.copy(overviewTarget)
        c.enabled = true
        c.update()
      }
      emit('overview')
    }
    emit('invalidate')
  }
  const d = duration('camera')
  blend.k = 0
  setMode(to === 'follow' ? 'to-follow' : 'to-overview')
  if (d === 0) {
    blend.k = 1
    done()
    return
  }
  tween = gsap.to(blend, {
    k: 1,
    duration: d,
    ease: GSAP_EASE.standard,
    onUpdate: () => emit('invalidate'),
    onComplete: done,
  })
  emit('invalidate')
}

/** Vuelo de entrada a la realización: de donde esté la cámara a la pose del primer plano (que se recalcula en vivo). */
function startTvTween(cam: Camera) {
  tween?.kill()
  tween = null
  fromPos.copy(cam.position)
  fromTarget.copy(lookTarget)
  blend.k = 0
  const d = duration('camera')
  if (d === 0) {
    blend.k = 1
    setMode('tv')
    emit('invalidate')
    return
  }
  tween = gsap.to(blend, {
    k: 1,
    duration: d,
    ease: GSAP_EASE.standard,
    onUpdate: () => emit('invalidate'),
    onComplete: () => {
      tween = null
      setMode('tv')
      emit('invalidate')
    },
  })
}

function enterTv() {
  tween?.kill()
  tween = null
  // Desde la vista general, o desde un seguimiento que aún esperaba al coche (la cámara no se ha movido).
  const atOverview = mode === 'overview' || pendingFollow
  pendingFollow = false
  saveOverview = false
  const cam = cameraRef
  const c = mapControls()
  if (atOverview && cam) {
    // La vista general a la que se vuelve al salir (o que se enseña cuando no hay nada mejor).
    overviewPos.copy(cam.position)
    overviewTarget.copy(c?.target ?? lookTarget)
    hasOverview = true
  }
  if (c) c.enabled = false
  if (cams.length === 0 && rt.circuit.centerline.closed) {
    cams = rt.ext('tv:cornerCams', (r) => cornerCams(r.circuit))
    input.corners = cams.map((k) => k.s)
  }
  director.reset()
  lastDecision = -Infinity
  seenCut = -1
  pendingTv = true
  blend.k = 0
  setMode('to-tv')
  emit('invalidate') // la realización arranca en el primer render
}

function transition(to: 'follow' | 'overview' | 'tv') {
  tween?.kill()
  tween = null
  if (to === 'tv') {
    enterTv()
    return
  }
  const fromTv = mode === 'tv' || mode === 'to-tv'
  if (fromTv) director.reset()
  if (to === 'follow') {
    // Solo desde la vista general: si se vuelve a seguir a mitad del regreso, la vista guardada sigue valiendo.
    saveOverview = mode === 'overview'
    pendingTv = false
    resetFollow()
    hasFix = false
    pendingFollow = true
    blend.k = 0
    setMode('to-follow')
    emit('invalidate') // el seguimiento arranca en el primer render con el coche visible
    return
  }
  if (mode === 'overview') {
    // Ya en la vista general (el usuario tomó el mapa al salir de la realización): nada que hacer.
    pendingFollow = false
    pendingTv = false
    return
  }
  if (pendingFollow || pendingTv || !hasOverview) {
    // El seguimiento (o la realización) no llegó a mover la cámara, o no hay vista guardada: se cancela sin tween y la
    // cámara se queda donde está, con los controles del usuario.
    pendingFollow = false
    pendingTv = false
    saveOverview = false
    setMode('overview')
    const c = mapControls()
    if (c) c.enabled = true
    emit('overview')
    emit('invalidate')
    return
  }
  saveOverview = false
  const fresh = props.refreshOverview?.()
  if (fresh) {
    overviewPos.copy(fresh.position)
    overviewTarget.copy(fresh.target)
  }
  startTween('overview')
}

/**
 * El usuario toca, arrastra o hace zoom sobre la escena en plena realización: se apaga y la cámara se queda donde
 * está, con los controles del mapa encendidos antes de que les llegue el gesto (este oyente va en captura). El centro
 * de giro queda en la línea de mirada y a la distancia mínima de los controles como poco, para que el gesto no acerque
 * la cámara de golpe.
 */
function handOver() {
  if (!tv.active) return
  tween?.kill()
  tween = null
  pendingTv = false
  director.reset()
  setMode('overview')
  const c = mapControls()
  const cam = cameraRef
  if (c) {
    if (cam) {
      const dir = tmpTarget.copy(lookTarget).sub(cam.position)
      const dist = Math.max(dir.length(), c.minDistance * 1.01)
      if (dir.lengthSq() > 0) c.target.copy(cam.position).addScaledVector(dir.normalize(), dist)
    }
    c.enabled = true
  }
  tv.stop('camera')
  emit('invalidate')
}

watch(
  () => [playback.following, playback.selectedCar, tv.active] as const,
  ([following, , tvOn], [wasFollowing, , wasTv]) => {
    if (following) {
      if (!wasFollowing) transition('follow')
      else {
        // Otro coche: la cámara salta a él en cuanto se vea (hasta entonces, se queda donde está).
        resetFollow()
        hasFix = false
      }
      return
    }
    if (tvOn) {
      if (!wasTv || wasFollowing) transition('tv')
      return
    }
    if (wasFollowing || wasTv) transition('overview')
  },
)

/** Coche en ejes de three (altura ya exagerada), sobre la línea central (sin la separación visual). */
function place(st: CarState, out: { x: number; y: number; z: number }) {
  carPose(st, 0, props.flat, out)
  out.y *= props.yScale
}

/** Una decisión del director con el estado de este frame; el plano llega a Vue (chip) solo si ha cambiado. */
function tvDecide(now: number) {
  input.wallMs = now
  input.timeMs = rt.clock.timeMs
  input.rate = rt.clock.rate
  input.neutral = rt.trackState.snapshot.neutral
  input.tower = input.race && rt.leaderboard.hasTower ? rt.leaderboard.towerAt(input.timeMs) : NO_TOWER
  director.update(input)
  const shot = director.shot
  if (!shot) {
    tv.publish(null)
    return
  }
  const live = director.live
  const tower = shot.basis === 'tower'
  // En un duelo de la torre, delante va quien la torre pone delante ahora (pudo adelantar dentro del plano).
  const cars = tower && live.ahead && live.ahead !== shot.cars[0] ? [shot.cars[1]!, shot.cars[0]!] : shot.cars
  const cue = director.camera
  tv.publish({
    id: shot.id,
    kind: shot.kind,
    cars,
    basis: shot.basis,
    reason: shot.reason,
    neutral: shot.neutral,
    intervalMs: tower ? live.intervalMs : null,
    positions: tower ? live.positions : null,
    camera: cue.kind,
    corner: cue.kind === 'corner' ? (cams[cue.corner]?.label ?? null) : null,
  })
}

/**
 * Pose del plano actual en `shotPos`/`shotTarget`. false si todavía no hay nada que enseñar (coches sin señal): la
 * cámara se queda donde está. `cut`: el plano o la cámara acaban de cambiar (la persecución arranca ya colocada).
 */
function tvPose(delta: number, cut: boolean): boolean {
  const shot = director.shot
  const cue = director.camera
  if (!shot) return false
  if (cue.kind === 'overview') {
    if (!hasOverview) return false
    shotPos.copy(overviewPos)
    shotTarget.copy(overviewTarget)
    return true
  }
  const states = rt.model.states
  const chased = director.chased(states, input.race, input.trackLength) as CarState | null
  if (!chased) return false
  const other = shot.cars.length > 1 ? states.find((s) => s.visible && s.car !== chased.car && shot.cars.includes(s.car)) : undefined
  place(chased, poseA)
  let gap = 0
  if (other) {
    place(other, poseB)
    shotMid.set((poseA.x + poseB.x) / 2, (poseA.y + poseB.y) / 2, (poseA.z + poseB.z) / 2)
    gap = Math.hypot(poseA.x - poseB.x, poseA.z - poseB.z)
  } else shotMid.set(poseA.x, poseA.y, poseA.z)

  if (cue.kind === 'corner') {
    const c = cams[cue.corner]
    if (!c) return false
    const k = props.yScale
    shotPos.set(c.x, (props.flat ? 0 : c.z) * k + CAM_HEIGHT_M, -c.y)
    // Con reduced motion, plano fijo sobre el vértice: la cámara no gira siguiendo a los coches.
    if (reduced.value) shotTarget.set(c.apexX, (props.flat ? 0 : c.apexZ) * k, -c.apexY)
    else shotTarget.copy(shotMid)
    return true
  }

  const goal = other ? pairChaseDistance(gap) : CHASE_LEADER_DISTANCE_M
  if (cut) {
    chase.reset()
    chaseDistance = goal
  } else chaseDistance += (goal - chaseDistance) * (1 - Math.exp(-CHASE_DISTANCE_RATE * delta))
  chase.distance = chaseDistance
  chase.update(shotMid, chased.heading, delta)
  chase.position(chasePos)
  shotPos.set(chasePos.x, chasePos.y, chasePos.z)
  shotTarget.set(chase.target.x, chase.target.y, chase.target.z)
  return true
}

function tvFrame(cam: Camera, delta: number) {
  const now = performance.now()
  if (jumpPending || director.shot === null || now - lastDecision >= TV_DECIDE_MS) {
    jumpPending = false
    lastDecision = now
    tvDecide(now)
  }
  const cut = director.camera.cut !== seenCut
  seenCut = director.camera.cut
  if (!tvPose(delta, cut)) return
  if (pendingTv) {
    pendingTv = false
    startTvTween(cam)
  }
  if (mode === 'to-tv') {
    const k = blend.k
    cam.position.lerpVectors(fromPos, shotPos, k)
    cam.lookAt(tmpTarget.lerpVectors(fromTarget, shotTarget, k))
    lookTarget.copy(tmpTarget)
  } else {
    cam.position.copy(shotPos)
    cam.lookAt(shotTarget)
    lookTarget.copy(shotTarget)
  }
}

function followFrame(cam: Camera, delta: number) {
  const i = rt.model.states.findIndex((s) => s.car === playback.selectedCar)
  const st = rt.model.states[i]
  follow.distance = settings.followDistance
  if (mode !== 'to-overview' && st?.visible) {
    // La pose del coche dibujado, con la separación visual suavizada (ver camOffset).
    const goal = rt.offsets[i]!
    if (!camOffsetSet) {
      camOffset = goal
      camOffsetSet = true
    } else camOffset += (goal - camOffset) * (1 - Math.exp(-OFFSET_RATE * delta))
    if (Math.abs(goal - camOffset) > 0.01) emit('invalidate') // sigue acomodándose también en pausa
    carPose(st, camOffset, props.flat, pose)
    follow.update({ x: pose.x, y: pose.y * props.yScale, z: pose.z }, st.heading, delta)
    follow.position(followPos)
    followTarget.set(follow.target.x, follow.target.y, follow.target.z)
    hasFix = true
  }
  if (pendingFollow && hasFix) {
    pendingFollow = false
    startTween('follow')
  }
  const k = blend.k
  if (mode === 'to-overview') {
    cam.position.lerpVectors(fromPos, overviewPos, k)
    cam.lookAt(tmpTarget.lerpVectors(fromTarget, overviewTarget, k))
    lookTarget.copy(tmpTarget)
  } else if (!hasFix || pendingFollow) {
    // Sin posición del coche (sin señal, oculto o aún no visto): la cámara se queda donde está.
  } else if (mode === 'follow') {
    cam.position.copy(followPos)
    cam.lookAt(followTarget)
    lookTarget.copy(followTarget)
  } else {
    cam.position.lerpVectors(fromPos, followPos, k)
    cam.lookAt(tmpTarget.lerpVectors(fromTarget, followTarget, k))
    lookTarget.copy(tmpTarget)
  }
}

useSceneFrame(
  ({ camera, delta, pending }) => {
    // Vista general sin render pendiente: nada que poner al día (los controles piden su frame al mover el mapa).
    if (!pending && mode === 'overview') return
    rigFrame(camera, delta)
  },
  { everyTick: true },
)

function rigFrame(cam: Camera | undefined, delta: number) {
  if (!cam) return
  cameraRef = cam
  if (mode === 'overview' || pendingFollow) {
    // El usuario mueve el mapa (también mientras el seguimiento espera al coche).
    const c = mapControls()
    if (c) lookTarget.copy(c.target)
  }
  if (mode === 'to-tv' || mode === 'tv') tvFrame(cam, delta)
  else if (mode !== 'overview') followFrame(cam, delta)
  // En su sitio: en cada tick siguiendo a un coche, sin reservar memoria.
  const out = sceneStats.camera
  out[0] = cam.position.x
  out[1] = cam.position.y
  out[2] = cam.position.z
}

// Un seek: el director elige de cero en el próximo frame (la escena entera ha cambiado igualmente).
const offClock = rt.clock.on((event) => {
  if (event !== 'seek') return
  director.jump()
  jumpPending = true
})

// Para los e2e (`window.__trazada.scene.tv`): el plano, la cámara y los últimos cortes (reloj de pared).
const offStat = registerSceneStat('tv', () => {
  const shot = director.shot
  const cue = director.camera
  return {
    active: tv.active,
    shot: shot
      ? { id: shot.id, kind: shot.kind, cars: [...shot.cars], basis: shot.basis, reason: shot.reason, neutral: shot.neutral }
      : null,
    camera: cue.kind,
    corner: cue.kind === 'corner' ? (cams[cue.corner]?.s ?? null) : null,
    intervalMs: director.live.intervalMs,
    cuts: [...director.cuts],
    cams: cams.length,
    camsFrom: rt.circuit.corners.length > 0 ? 'corners' : 'curvature',
  }
})

/** Escena (lienzo y siglas): un toque, un arrastre o la rueda sobre ella en plena realización devuelven el mapa. */
let sceneRoot: HTMLElement | null = null
function onSceneInput() {
  if (tv.active) handOver()
}
function detachScene() {
  sceneRoot?.removeEventListener('pointerdown', onSceneInput, true)
  sceneRoot?.removeEventListener('wheel', onSceneInput, true)
  sceneRoot = null
}
watch(
  () => props.controls,
  (c) => {
    detachScene()
    const el = (c?.domElement ?? null) as HTMLElement | null
    sceneRoot = el?.closest<HTMLElement>('[data-testid="scene"]') ?? el
    sceneRoot?.addEventListener('pointerdown', onSceneInput, true)
    sceneRoot?.addEventListener('wheel', onSceneInput, { capture: true, passive: true })
  },
  { immediate: true },
)

// Un rig nuevo (p. ej. tras recuperar el contexto WebGL) se sincroniza con el seguimiento en curso.
let detachRig: (() => void) | null = null
onMounted(() => {
  detachRig = tv.attachRig()
  if (playback.following) transition('follow')
})

onBeforeUnmount(() => {
  tween?.kill()
  offClock()
  offStat()
  detachScene()
  setMode('overview')
})
// Después del desmontaje: sin rig no hay realización (se apaga sin que este rig, ya parado, reaccione).
onUnmounted(() => detachRig?.())
</script>

<template>
  <TresGroup />
</template>
