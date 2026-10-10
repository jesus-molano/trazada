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
import { sceneStats } from '~/replay/debug'
import { getRuntime, usePlaybackStore } from '~/stores/playback'

const props = defineProps<{ controls: MapControls | null; yScale: number; flat: boolean }>()
const emit = defineEmits<{ invalidate: [] }>()

const rt = getRuntime()!
const playback = usePlaybackStore()
const follow = new FollowCamera()

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
let cameraRef: Camera | null = null

/** Los MapControls son un objeto de three que el rig gobierna (no estado de Vue). */
function mapControls(): MapControls | null {
  return props.controls
}

function setMode(m: Mode) {
  mode = m
  sceneStats.cameraMode = m
}

function transition(to: 'follow' | 'overview') {
  tween?.kill()
  const cam = cameraRef
  if (!cam) return
  fromPos.copy(cam.position)
  const c = mapControls()
  fromTarget.copy(to === 'follow' ? (c?.target ?? tmpTarget.set(0, 0, 0)) : followTarget)
  if (to === 'follow') {
    // Se guarda la vista general para volver exactamente a ella.
    overviewPos.copy(cam.position)
    overviewTarget.copy(c?.target ?? tmpTarget.set(0, 0, 0))
    follow.reset()
    if (c) c.enabled = false
  }
  const done = () => {
    setMode(to === 'follow' ? 'follow' : 'overview')
    if (to === 'overview') {
      cam.position.copy(overviewPos)
      cam.lookAt(overviewTarget)
      if (c) {
        c.target.copy(overviewTarget)
        c.enabled = true
        c.update()
      }
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

watch(
  () => [playback.following, playback.selectedCar] as const,
  ([following], [wasFollowing]) => {
    if (following && !wasFollowing) transition('follow')
    else if (!following && wasFollowing) transition('overview')
    else if (following) follow.reset() // otro coche: la cámara salta a él
  },
)

const { onBeforeRender } = useLoop()
onBeforeRender(({ camera, delta }) => {
  const cam = camera.value
  if (!cam) return
  cameraRef = cam
  if (mode !== 'overview') {
    const st = rt.model.states.find((s) => s.car === playback.selectedCar)
    if (st?.visible) {
      follow.update({ x: st.x, y: (props.flat ? 0 : st.z) * props.yScale, z: -st.y }, st.heading, delta)
      follow.position(followPos)
      followTarget.set(follow.target.x, follow.target.y, follow.target.z)
    }
    const k = blend.k
    if (mode === 'follow') {
      cam.position.copy(followPos)
      cam.lookAt(followTarget)
    } else if (mode === 'to-follow') {
      cam.position.lerpVectors(fromPos, followPos, k)
      cam.lookAt(tmpTarget.lerpVectors(fromTarget, followTarget, k))
    } else {
      cam.position.lerpVectors(fromPos, overviewPos, k)
      cam.lookAt(tmpTarget.lerpVectors(fromTarget, overviewTarget, k))
    }
  }
  sceneStats.camera = [cam.position.x, cam.position.y, cam.position.z]
})

onBeforeUnmount(() => {
  tween?.kill()
  setMode('overview')
})
</script>

<template>
  <TresGroup />
</template>
