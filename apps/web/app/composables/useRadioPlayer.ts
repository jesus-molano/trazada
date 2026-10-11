/**
 * Reproductor único de la radio de los equipos (D51): en toda la página suena un solo clip a la vez (empezar otro para
 * el anterior). Estado grueso para Vue: qué clip es, si suena y su progreso, que cambia con `timeupdate` del audio
 * (unas 4 veces por segundo), nunca por frame. Sin `Audio` (SSR, tests sin DOM de audio), no hace nada.
 */
import { readonly, ref, shallowRef } from 'vue'

export interface RadioNowPlaying {
  /** Clave del clip (su `file`). */
  readonly key: string
  /** Lo puso «Escuchar en directo» (y no el usuario): solo esos se paran al saltar, pausar o subir de ×2. */
  readonly live: boolean
}

const now = shallowRef<RadioNowPlaying | null>(null)
const playing = ref(false)
const progress = ref(0)
let audio: HTMLAudioElement | null = null

function element(): HTMLAudioElement | null {
  if (audio) return audio
  if (typeof Audio === 'undefined') return null
  const a = new Audio()
  a.preload = 'auto'
  a.addEventListener('timeupdate', () => {
    progress.value = a.duration > 0 ? Math.min(1, a.currentTime / a.duration) : 0
  })
  a.addEventListener('playing', () => (playing.value = true))
  a.addEventListener('pause', () => (playing.value = false))
  a.addEventListener('ended', () => {
    playing.value = false
    progress.value = 0
    now.value = null
  })
  a.addEventListener('error', () => {
    playing.value = false
    now.value = null
  })
  audio = a
  return a
}

/** Hace sonar el clip `key` de `url` (si ya era el actual, sigue donde iba). */
function play(url: string, key: string, live = false): void {
  const a = element()
  if (!a) return
  if (now.value?.key !== key) {
    a.src = url
    progress.value = 0
  }
  now.value = { key, live }
  playing.value = true
  const p = a.play() as Promise<void> | undefined
  p?.catch(() => (playing.value = false))
}

function pause(): void {
  audio?.pause()
}

function toggle(url: string, key: string): void {
  if (now.value?.key === key && playing.value) pause()
  else play(url, key)
}

/** Para y olvida el clip (al cambiar de sesión, o «Escuchar en directo» al saltar). */
function stop(): void {
  audio?.pause()
  now.value = null
  playing.value = false
  progress.value = 0
}

export function useRadioPlayer() {
  return { now: readonly(now), playing: readonly(playing), progress: readonly(progress), play, pause, toggle, stop }
}
