<script setup lang="ts">
/**
 * Cámara: vista general (MapControls) o seguimiento del coche seleccionado (FollowCamera), con
 * transiciones GSAP entre ambas (instantáneas con prefers-reduced-motion). Va dentro de TresCanvas y
 * escribe la cámara antes de cada render.
 */
import { useLoop } from '@tresjs/core'
import gsap from 'gsap'
import { type Camera, Vector3 } from 'three'
import type { MapControls } from 'three/examples/jsm/controls/MapControls.js'
import { duration, GSAP_EASE } from '~/design/motion'
import { FollowCamera } from '~/engine/camera/FollowCamera'
import { carPose } from '~/engine/replay/carPose'
import { sceneStats } from '~/replay/debug'
import { getRuntime, usePlaybackStore } from '~/stores/playback'
import { useSettingsStore } from '~/stores/settings'

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
const follow = new FollowCamera(settings.followDistance)
const pose = { x: 0, y: 0, z: 0 }

type Mode = 'overview' | 'to-follow' | 'follow' | 'to-overview'
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

/** Los MapControls son un objeto de three que el rig gobierna (no estado de Vue). */
function mapControls(): MapControls | null {
  return props.controls
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

function transition(to: 'follow' | 'overview') {
  tween?.kill()
  tween = null
  if (to === 'follow') {
    // Solo desde la vista general: si se vuelve a seguir a mitad del regreso, la vista guardada sigue valiendo.
    saveOverview = mode === 'overview'
    follow.reset()
    hasFix = false
    pendingFollow = true
    blend.k = 0
    setMode('to-follow')
    emit('invalidate') // el seguimiento arranca en el primer render con el coche visible
    return
  }
  if (pendingFollow || !hasOverview) {
    // El seguimiento no llegó a mover la cámara (esperaba al coche) o no hay vista guardada:
    // se cancela sin tween y la cámara se queda donde está, con los controles del usuario.
    pendingFollow = false
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

watch(
  () => [playback.following, playback.selectedCar] as const,
  ([following], [wasFollowing]) => {
    if (following && !wasFollowing) transition('follow')
    else if (!following && wasFollowing) transition('overview')
    else if (following) {
      // Otro coche: la cámara salta a él en cuanto se vea (hasta entonces, se queda donde está).
      follow.reset()
      hasFix = false
    }
  },
)

const { onBeforeRender } = useLoop()
onBeforeRender(({ camera, delta }) => {
  const cam = camera.value
  if (!cam) return
  cameraRef = cam
  if (mode === 'overview' || pendingFollow) {
    // El usuario mueve el mapa (también mientras el seguimiento espera al coche).
    const c = mapControls()
    if (c) lookTarget.copy(c.target)
  }
  if (mode !== 'overview') {
    const i = rt.model.states.findIndex((s) => s.car === playback.selectedCar)
    const st = rt.model.states[i]
    follow.distance = settings.followDistance
    if (mode !== 'to-overview' && st?.visible) {
      // Misma pose que el coche dibujado (con la separación visual, si está activa).
      carPose(st, rt.offsets[i]!, props.flat, pose)
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
  sceneStats.camera = [cam.position.x, cam.position.y, cam.position.z]
})

// Un rig nuevo (p. ej. tras recuperar el contexto WebGL) se sincroniza con el seguimiento en curso.
onMounted(() => {
  if (playback.following) transition('follow')
})

onBeforeUnmount(() => {
  tween?.kill()
  setMode('overview')
})
</script>

<template>
  <TresGroup />
</template>
