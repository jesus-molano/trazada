<script setup lang="ts">
/**
 * «Escuchar en directo» de la radio de los equipos (D51), sin nada que pintar: va en el hueco de las capas del replay
 * para estar montado siempre (con un piloto elegido, el panel de dirección de carrera se oculta). Con reproducción a
 * ×1 o ×2 y sin salto, suena el clip más reciente publicado desde la última actualización gruesa (del coche elegido o,
 * sin coche, de todos). Lo que puso el directo se para al saltar, pausar o subir de ×2. Al dejar la sesión, nada sigue
 * sonando.
 */
import { manifestPath } from '~/data/session-id'
import { clipUrl, LIVE_MAX_RATE, liveClip, radioClips } from '~/engine/radio/radio'
import { getRuntime, usePlaybackStore } from '~/stores/playback'
import { useRadioStore } from '~/stores/radio'

const rt = getRuntime()!
const playback = usePlaybackStore()
const radio = useRadioStore()
const player = useRadioPlayer()
const dataUrl = useDataUrl()
const clips = radioClips(rt.session.events ?? {})
const times = clips.map((c) => c.t)

/** Margen (ms de pared) sobre lo que avanza el reloj entre dos actualizaciones gruesas antes de llamarlo salto. */
const JUMP_SLACK_MS = 250
let lastT = playback.timeMs
let lastWall = performance.now()

function stopLive() {
  if (player.now.value?.live) player.stop()
}

watch(
  () => playback.timeMs,
  (t) => {
    const now = performance.now()
    const dt = t - lastT
    const jump = !playback.playing || dt < 0 || dt > (now - lastWall + JUMP_SLACK_MS) * playback.rate
    const from = lastT
    lastT = t
    lastWall = now
    if (!radio.live || !clips.length) return
    if (jump || playback.rate > LIVE_MAX_RATE) {
      stopLive()
      return
    }
    const i = liveClip(clips, times, from, t, playback.selectedCar)
    const url = i >= 0 ? clipUrl(dataUrl(manifestPath(rt.session.id)), clips[i]!) : null
    if (url) player.play(url, clips[i]!.file, true)
  },
)
watch(
  () => [playback.playing, playback.rate, radio.live] as const,
  ([playing, rate, live]) => {
    if (!playing || rate > LIVE_MAX_RATE || !live) stopLive()
  },
)
onBeforeUnmount(() => player.stop())
</script>

<script lang="ts">
/** Hueco `replay-overlays` (D29): sin nada que pintar. */
export const order = 99
</script>

<template>
  <span hidden />
</template>
