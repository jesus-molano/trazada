<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'
import type { SheetState, SheetTab } from '~/composables/useReplayLayout'
import { parseSessionId } from '~/data/session-id'
import { installDebugHandle } from '~/replay/debug'
import {
  parseTimeParam,
  planResume,
  RESUME_EXT,
  type ResumeApplied,
  resumeInfo,
  resumeStore,
  type ResumeTracker,
  trackResume,
} from '~/replay/resume'
import { createReplayRuntime, defaultInitialMs } from '~/replay/runtime'
import { REPLAY_HEADER, REPLAY_OVERLAYS } from '~/slots/replay'
import { useLayoutStore } from '~/stores/layout'
import { getRuntime, usePlaybackStore } from '~/stores/playback'
import { useSessionStore } from '~/stores/session'

/**
 * El replay (la página /replay, que lo monta tras ceder el hilo en una navegación desde la portada: pages/replay.vue).
 */
const { t, locale } = useI18n()
const route = useRoute()
const session = useSessionStore()
const playback = usePlaybackStore()
const layout = useLayoutStore()
useReplayShortcuts()

/**
 * Diseños y anchos de los paneles (ítem 15): «Espectador» o «Análisis» y los anchos de las asas, recortados para que
 * el mapa conserve su mínimo; en tablet vertical, sin anchos (la franja de abajo de siempre). Solo con el runtime
 * enganchado, que es cuando hay paneles.
 */
const root = ref<HTMLElement | null>(null)
const { widths, ranges, vars: layoutVars, resizable, compact } = useReplayLayout(() => playback.attached)

/**
 * Modo compacto (móvil y ventanas pequeñas; `COMPACT_QUERY`): el mapa ocupa todo el escenario y los paneles van en una
 * hoja inferior (TzSheetHead) con tres alturas y una pestaña por panel; la cabecera, en una fila, con «⋯» para las
 * herramientas. Elegir un coche abre su pestaña; quitarlo vuelve a la clasificación. Estado grueso (Vue).
 */
const stageEl = ref<HTMLElement | null>(null)
const sheet = ref<SheetState>('peek')
const sheetTab = ref<SheetTab>('lb')
const moreOpen = ref(false)
const selectedTla = computed(() => {
  const n = playback.selectedCar
  if (!n) return null
  return getRuntime()?.drivers.find((d) => d.number === n)?.tla ?? n
})
watch(
  () => playback.selectedCar,
  (car, before) => {
    if (car && car !== before) {
      sheetTab.value = 'car'
      if (sheet.value === 'peek') sheet.value = 'half'
    } else if (!car && sheetTab.value === 'car') sheetTab.value = 'lb'
  },
)
watch(compact, (on) => {
  if (!on) moreOpen.value = false
})

/**
 * Ventana del mapa (D50): empieza justo después de la clasificación, que se ensancha con sus columnas extra (las de
 * «Detallados» y las de otras funciones): se mide al cambiar de tamaño y se escribe directo en la raíz de la página
 * (así lo ven el escenario y la cabecera, con el chip de la realización), sin pasar por Vue. Con estado reactivo, cada medida durante el arrastre del asa rehacía la página, y su
 * `:style` volvía a poner el ancho guardado encima del que escribe el asa: el panel no crecía hasta soltar.
 */
const lbComp = ref<ComponentPublicInstance | null>(null)
let lbObserver: ResizeObserver | null = null
watch(lbComp, (c) => {
  lbObserver?.disconnect()
  lbObserver = null
  const el = c?.$el as HTMLElement | undefined
  if (!(el instanceof HTMLElement) || typeof ResizeObserver === 'undefined') return
  lbObserver = new ResizeObserver(() =>
    root.value?.style.setProperty('--replay-window-left', `${el.offsetLeft + el.offsetWidth}px`),
  )
  lbObserver.observe(el)
})
onBeforeUnmount(() => lbObserver?.disconnect())

/** Prioridad del título en la cabecera (D44): lo secundario se acorta antes que el título (useHeaderFit). */
const bar = ref<HTMLElement | null>(null)
const titleEl = ref<HTMLElement | null>(null)
useHeaderFit(bar, titleEl, () => session.status === 'ready')

const id = computed(() => (typeof route.query.s === 'string' ? route.query.s : ''))
const parsed = computed(() => parseSessionId(id.value))

// La página se prerenderiza sin `?s=`: al hidratar, hasta montar, el título es el genérico (sin desajuste de
// hidratación). Al llegar desde la portada no hay nada que hidratar: el título bueno sale ya en el primer render (sin una
// segunda pasada en la misma tarea).
const mounted = ref(import.meta.client && !useNuxtApp().isHydrating)
onMounted(() => {
  mounted.value = true
  // El diseño guardado (por navegador, D41), ya en el cliente: el HTML prerenderizado es el de por defecto.
  layout.hydrate()
})
const title = computed(() => {
  const m = session.manifest
  if (m) return `${m.session.event} · ${t(`session.${m.session.type}`)} · ${m.session.season}`
  return mounted.value && parsed.value ? `${parsed.value.season} · ${t(`session.${parsed.value.type}`)}` : t('replay.title')
})
useHead({ title })
/** El título en dos partes: el Gran Premio y, en el color secundario, «· Sprint · 2026» (D50). */
const titleParts = computed<[string, string]>(() => {
  const m = session.manifest
  if (!m) return [title.value, '']
  return [m.session.event, ` · ${t(`session.${m.session.type}`)} · ${m.session.season}`]
})
/** Piezas del hueco replay-header de un grupo de la cabecera (las que no dicen grupo, a «Escena y cámara»). */
const headerOf = (group: string) => REPLAY_HEADER.filter((h) => (h.module.group ?? 'scene') === group)

/** `?bench=1`: bench de rendimiento (docs/PERFORMANCE.md). */
const benchMode = computed(() => route.query.bench === '1')
/** `?t=<ms de sesión>`: instante de arranque explícito; manda sobre la posición guardada (ítem 13). */
const urlTime = computed(() => parseTimeParam(route.query.t))

// La escena (y three.js) se monta un frame después de "listo": su coste no entra en la carga de datos.
const sceneEnabled = ref(false)
let removeDebug: (() => void) | null = null
/** Guardado de la posición de la sesión abierta (ítem 13). */
let tracker: ResumeTracker | null = null
/** Guarda por última vez la sesión que se deja; antes de soltar su runtime. */
function stopTracking() {
  tracker?.stop()
  tracker = null
}

watch(
  () => session.status,
  (status) => {
    removeDebug?.()
    removeDebug = null
    if (status !== 'ready' || !session.data) {
      stopTracking()
      sceneEnabled.value = false
      playback.detach()
      return
    }
    // El montaje (modelo, controles y escena) va en frames posteriores a "listo": así el mensaje de datos
    // listos se procesa en un instante y la interfaz no se bloquea.
    const data = session.data
    requestAnimationFrame(() => {
      if (session.data !== data) return
      stopTracking()
      // Reanudar donde se dejó (ítem 13): en pausa, en ese instante, con el coche (si sigue en la sesión), el
      // seguimiento y la velocidad. `?t=` manda sobre lo guardado; el bench ni lo usa ni guarda nada.
      const pb = data.manifest.session.playback
      const defaultMs = defaultInitialMs(pb)
      const plan =
        benchMode.value || urlTime.value !== null
          ? null
          : planResume(resumeStore.get(data.id), {
              t0Utc: data.manifest.session.t0Utc,
              startMs: pb.startMs,
              endMs: pb.endMs,
              defaultMs,
              cars: data.manifest.drivers.map((d) => d.number),
            })
      const rt = createReplayRuntime(data, { initialMs: urlTime.value ?? plan?.t })
      const info = resumeInfo(data, rt.markers, defaultMs)
      // Lo retomado, para el aviso (components/replay-overlays/TzResumeToast.vue), antes de que se monte.
      rt.ext<ResumeApplied | null>(RESUME_EXT, () => (plan ? { plan, info } : null))
      if (plan) rt.clock.setRate(plan.rate)
      playback.attach(rt)
      if (plan?.car) {
        playback.selectCar(plan.car)
        playback.setFollowing(plan.follow)
      }
      removeDebug = installDebugHandle(rt, () => playback.selectedCar)
      if (!benchMode.value) {
        tracker = trackResume(rt, info, () => ({ car: playback.selectedCar, follow: playback.following }))
      }
      requestAnimationFrame(() => (sceneEnabled.value = session.data === data))
    })
  },
)
// Elegir otro coche o dejar de seguirlo también se recuerda (1 s después del último cambio).
watch(
  () => [playback.selectedCar, playback.following],
  () => tracker?.touch(),
)

const readyDetail = computed(() => {
  const timings = session.data?.timings
  if (!timings) return ''
  return t('replay.readyDetail', {
    size: formatBytes(timings.bytes, locale.value),
    seconds: formatSeconds(timings.totalMs, locale.value),
  })
})
/** Nombre del estado (empieza por lo que se ve, «Listo») y su detalle, que se abre al pulsar el punto. */
const readyName = computed(() => (readyDetail.value ? `${t('replay.ready')} · ${readyDetail.value}` : t('replay.ready')))

// La carga empieza en otra tarea: montar el replay ya es una (con la CPU ×4, juntas pasaban de 50 ms; perf.spec). Si
// entre medias ya la lanzó el watch (al hidratar una carga directa, Nuxt pone la `?s=` de la URL después de montar),
// no se repite.
let unmounted = false
onMounted(async () => {
  await yieldToMain()
  if (!unmounted && session.id !== id.value) void session.load(id.value)
})
watch(id, (value) => void session.load(value))
onBeforeUnmount(() => {
  unmounted = true
  stopTracking()
  removeDebug?.()
  playback.detach()
  session.unload()
})
</script>

<template>
  <section ref="root" class="tz-replay" :class="`is-${layout.preset}`" :style="layoutVars" :data-layout="layout.preset">
    <LazyTzScene v-if="sceneEnabled" />

    <!--
      Cabecera en una sola fila (D44): marca, título, estado, avisos, estado de pista, botones del hueco y herramientas
      de la escena. El título tiene prioridad: por debajo de 1600 px lo secundario va solo con su icono (el estado, los
      avisos y «Cómo se dibuja», por debajo de 1920 px) y, si aun así el título no cabe entero, lo secundario pasa antes
      a su forma corta (`data-fit`, useHeaderFit); solo con todo en su forma más corta se acorta el título con «…». Si
      ni así cabe la fila con las banderas, el estado de pista pasa a una fila propia debajo (como mucho, una fila más;
      nunca una columna de chips). Las etiquetas «Estimado» y las banderas nunca se esconden (las de la escena flotan
      justo debajo, sobre el mapa).
    -->
    <header ref="bar" class="tz-replay__bar" :data-more="compact && moreOpen ? 'open' : undefined">
      <!-- 1 · Sesión: ← Trazada, el título («Gran Premio» y, en secundario, «· Sprint · 2026») y el punto de estado. -->
      <div class="tz-hgroup is-session" role="group" :aria-label="t('replay.groups.session')" data-group="session">
        <TzBrandBar />
        <h1 ref="titleEl" class="tz-replay__title" :title="title" data-testid="replay-title">
          <span class="tz-replay__event">{{ titleParts[0] }}</span><span class="tz-replay__sub">{{ titleParts[1] }}</span>
        </h1>
        <p
          v-if="session.status === 'ready'"
          class="tz-replay__status"
          role="status"
          data-testid="replay-status"
          data-state="ready"
        >
          <!-- Un punto que se pulsa para ver el detalle de la carga; desde 1920 px, también «Listo» y el detalle. -->
          <TzHint plain :label="readyName" :text="readyName" testid="replay-status-detail" :title="readyName">
            <template #button>
              <span class="tz-replay__dot" aria-hidden="true" />
              <span class="tz-replay__ready">{{ t('replay.ready') }}</span>
              <span class="tz-replay__detail tz-tabular" aria-hidden="true">{{ readyDetail }}</span>
            </template>
          </TzHint>
        </p>
      </div>
      <!-- Modo compacto: vista, escena, ayuda e idioma, en filas bajo la cabecera al pulsar «⋯». -->
      <button
        v-if="compact"
        type="button"
        class="tz-iconbtn tz-replay__more"
        :aria-expanded="moreOpen"
        :aria-label="t('replay.more')"
        :title="t('replay.moreHint')"
        data-testid="header-more"
        @click="moreOpen = !moreOpen"
      >
        <TzIcon name="more" />
      </button>
      <!--
        2 · Condiciones de la sesión (lecturas): estado de pista, meteorología y avisos. Si no caben en la fila (varias
        banderas a la vez) o por debajo de 1360 px, bajan juntas a una segunda fila a lo ancho (nivel 4 de useHeaderFit).
      -->
      <div class="tz-hgroup is-conditions" role="group" :aria-label="t('replay.groups.conditions')" data-group="conditions">
        <TzTrackStatus v-if="playback.attached" :key="`ts-${session.id}`" />
        <template v-if="playback.attached">
          <component :is="h.component" v-for="h in headerOf('conditions')" :key="`${h.name}-${session.id}`" />
        </template>
        <!-- Avisos de calidad del pipeline (quality.notes del manifest) y, desde 2026, el del reglamento (por la temporada). -->
        <TzSessionNotes
          v-if="session.status === 'ready'"
          :key="`notes-${session.id}`"
          :notes="session.manifest?.quality.notes"
          :season="session.manifest?.session.season"
        />
      </div>
      <!-- 3 · Vista: «Paneles: Compactos | Detallados» y la hoja «Análisis». -->
      <div class="tz-hgroup is-view" role="group" :aria-label="t('replay.groups.view')" data-group="view">
        <template v-if="playback.attached">
          <component :is="h.component" v-for="h in headerOf('view')" :key="`${h.name}-${session.id}`" />
        </template>
      </div>
      <!-- 4 · Escena y cámara: la escena teletransporta aquí sus herramientas (altura, separar coches, capas, cámara, ⓘ). -->
      <div class="tz-hgroup is-scene" role="group" :aria-label="t('replay.groups.scene')" data-group="scene">
        <div id="tz-scene-tools" class="tz-replay__tools" />
        <template v-if="playback.attached">
          <component :is="h.component" v-for="h in headerOf('scene')" :key="`${h.name}-${session.id}`" />
        </template>
      </div>
      <!-- 5 · Ayuda e idioma. -->
      <div class="tz-hgroup is-help" role="group" :aria-label="t('replay.groups.help')" data-group="help">
        <template v-if="playback.attached">
          <component :is="h.component" v-for="h in headerOf('help')" :key="`${h.name}-${session.id}`" />
        </template>
        <TzLangToggle />
      </div>
    </header>

    <div v-if="session.status === 'loading' || session.status === 'error'" class="tz-replay__center">
      <TzLoadPanel />
    </div>

    <!--
      Escenario: la clasificación a la izquierda y la columna derecha, cada una con su asa en el borde que da al mapa
      (ítem 15; en tablet vertical, sin asas). Al montarse, aparecen escalonados con un fundido (solo opacidad: la escena
      los mide para encuadrar, D42).
    -->
    <div
      v-if="playback.attached"
      ref="stageEl"
      class="tz-replay__stage"
      :data-sheet="compact ? sheet : undefined"
      :data-tab="compact ? sheetTab : undefined"
    >
      <TzSheetHead v-if="compact" v-model:state="sheet" v-model:tab="sheetTab" :car="selectedTla" :target="stageEl" :root="root" />
      <!--
        Ventana del mapa (D50, «marco continuo»): el hueco entre las columnas, con radio 18 px y un filo de 1 px; fuera de
        ella, el cromo (una sombra del color de fondo, estática: nunca se repinta). Cabecera, columnas y dock van por
        encima, así que la interfaz rodea al mapa como el bisel de un monitor; el texto sigue plano y nítido.
      -->
      <div class="tz-replay__window" aria-hidden="true" data-testid="map-window" />
      <TzLeaderboard ref="lbComp" :key="`lb-${session.id}`" class="tz-replay__lb" :preset="layout.preset">
        <TzResizeHandle
          v-if="resizable"
          class="tz-replay__resize is-lb"
          panel="lb"
          edge="end"
          :value="widths.lb"
          :min="ranges.lb.min"
          :max="ranges.lb.max"
          :label="t('layout.resize.lb')"
          :hint="t('layout.resize.hint')"
          controls="tz-leaderboard"
          :target="root"
          css-var="--replay-lb-w"
          @commit="(w: number) => layout.setWidth('lb', w)"
          @reset="layout.setWidth('lb', null)"
        />
      </TzLeaderboard>
      <aside id="tz-replay-side" class="tz-replay__side">
        <TzTelemetry v-if="playback.selectedCar" :key="`tel-${session.id}`" :preset="layout.preset" />
        <!-- Con un piloto elegido, su telemetría (con sus radios) ocupa la columna: la dirección de carrera general se oculta. -->
        <!-- En el modo compacto es otra pestaña de la hoja: se queda. -->
        <TzRaceControl v-if="!playback.selectedCar || compact" :key="`rc-${session.id}`" />
      </aside>
      <TzResizeHandle
        v-if="resizable"
        class="tz-replay__resize is-side"
        panel="side"
        edge="start"
        :value="widths.side"
        :min="ranges.side.min"
        :max="ranges.side.max"
        :label="t('layout.resize.side')"
        :hint="t('layout.resize.hint')"
        controls="tz-replay-side"
        :target="root"
        css-var="--replay-side-w"
        @commit="(w: number) => layout.setWidth('side', w)"
        @reset="layout.setWidth('side', null)"
      />
    </div>
    <TzReplayDock v-if="playback.attached" :key="session.id ?? undefined" class="tz-replay__dock" />
    <!-- Hojas, tarjetas y avisos de otras funciones (hueco components/replay-overlays/, D29). -->
    <template v-if="playback.attached">
      <component :is="o.component" v-for="o in REPLAY_OVERLAYS" :key="`${o.name}-${session.id}`" />
    </template>
    <TzBench v-if="benchMode && sceneEnabled" :key="`bench-${session.id}`" />
  </section>
</template>

<style scoped>
/*
 * Columna a toda la ventana (layouts/replay.vue): cabecera, escenario (paneles laterales) y dock; la escena 3D ocupa
 * todo el fondo. Anchos de los paneles con los tokens de densidad (D44) o los del diseño y las asas (ítem 15: la página
 * pone `--replay-lb-w` y `--replay-side-w` en línea, salvo en tablet vertical); las etiquetas «Estimado» de la escena
 * flotan bajo la cabecera, a la izquierda de la columna derecha (`--replay-over-*`, que usa TzSceneTools).
 */
.tz-replay {
  --replay-side-w: var(--tz-panel-w);
  /* Separación entre la ventana del mapa y lo que la rodea (columnas y dock). */
  --replay-window-gap: 10px;
  /*
   * Borde derecho de la clasificación (con sus columnas extra), relativo al escenario: el script lo mide y lo escribe
   * en línea; esto es lo que vale hasta la primera medida.
   */
  --replay-window-left: calc(var(--replay-lb-w, var(--tz-panel-w)) + var(--replay-lb-more, 0px));
  /*
   * Lo que flota dentro de la ventana, bajo la cabecera (relativo a ella): el chip de la realización arriba a la
   * izquierda y las etiquetas «Estimado» de la escena arriba a la derecha (margen de la página + columna + separación +
   * aire), en la misma fila; con el chip, cada lado tiene como mucho la mitad del ancho y no se pisan.
   */
  --replay-over-left: calc(var(--tz-space-4) + var(--replay-window-left) + var(--replay-window-gap) + var(--tz-space-3));
  --replay-over-right: calc(var(--tz-space-4) + var(--replay-side-w) + var(--replay-window-gap) + var(--tz-space-3));
  --replay-over-top: var(--tz-space-3);
  --replay-over-max: calc(100% - var(--replay-over-left) - var(--replay-over-right));
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  /*
   * Todo el replay se pulsa o se arrastra (filas, coches, mapa, timeline): nada se selecciona por accidente. Se puede
   * seleccionar lo que se lee para copiarlo (el texto original de dirección de carrera) y los campos de texto.
   */
  user-select: none;
}

.tz-replay :is(input, textarea, [contenteditable='true']) {
  user-select: text;
}

/*
 * Cabecera: una sola fila (si se parte, la escena y los paneles pierden alto). Para decidir si cabe, el título cuenta
 * solo con su mínimo (6 em) y el estado de pista con todos sus chips en una línea: el título crece hasta su contenido
 * y se acorta con «…» si no llega. Antes de eso, lo secundario pasa a su forma corta por niveles (`data-fit`, más
 * abajo). Si ni así cabe con las banderas, el estado de pista va en su propia fila (nivel 4); solo si la fila se parte
 * igualmente (tablet en vertical), se parte. Nunca se esconde una bandera ni una etiqueta «Estimado».
 */
.tz-replay__bar {
  position: relative;
  /* Por encima del marco del mapa (que pinta el cromo alrededor de su ventana, D50). */
  z-index: calc(var(--tz-z-panels) + 1);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tz-space-2) var(--tz-space-3);
  padding: var(--tz-space-3) var(--tz-space-4);
  pointer-events: none;
}

/*
 * Grupos por función (D50), de izquierda a derecha: sesión; condiciones; (hueco); vista; escena y cámara; ayuda. Cada
 * grupo es un role=group con su nombre (para los lectores de pantalla; sin rótulo visible, como en la lámina) y un
 * filete vertical separa escena y ayuda. Sin cajas.
 */
.tz-hgroup {
  /* Sin posición propia: las etiquetas «Estimado» de la escena se colocan respecto a la cabecera. */
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-2);
}

.tz-replay__bar > .is-session {
  flex: 0 1 auto;
  min-width: 0;
}

/* El hueco flexible: vista, escena y ayuda, a la derecha. */
.tz-replay__bar > .is-view {
  margin-left: auto;
}

.tz-replay__bar > .is-scene,
.tz-replay__bar > .is-help {
  padding-left: var(--tz-space-3);
  border-left: 1px solid var(--tz-border);
}

.tz-replay__bar > * {
  flex: none;
  pointer-events: auto;
}

/* Con un panel desplegado (avisos, «Cómo se dibuja»), la cabecera pasa por encima de los paneles laterales. */
.tz-replay__bar:has([aria-expanded='true']) {
  z-index: var(--tz-z-header);
}

/* Con el chip de la realización automática, a la izquierda, las etiquetas «Estimado» se quedan con la otra mitad. */
.tz-replay__bar:has([data-testid='tv-chip']) {
  --replay-over-max: calc((100% - var(--replay-over-left) - var(--replay-over-right) - var(--tz-space-3)) / 2);
}

/*
 * Con la hoja de análisis abierta, la escena está tapada entera (`rt.setSceneHidden`): sus etiquetas «Estimado» no
 * describen nada que se vea y no flotan sobre la hoja (con la hoja, la cabecera pasa por encima de ella, por su
 * botón desplegado). Al cerrarla vuelven; lo estimado de cada pestaña lleva su propia etiqueta.
 */
.tz-replay:has([data-testid='analysis-sheet']) {
  --replay-over-display: none;
}

/* Base 0 y crece hasta su texto: cede sitio antes que nadie (con «…» y el texto entero en su título). 16/600 (D50). */
.tz-replay__title {
  flex: 1 1 0;
  min-width: min(6em, 100%);
  max-width: max-content;
  margin: 0;
  overflow: hidden;
  font-size: var(--tz-text-lg);
  font-weight: var(--tz-weight-semibold);
  line-height: var(--tz-leading-tight);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/*
 * Estado de pista: entero, con sus chips en una línea (nunca encoge hasta su chip más ancho: sería una columna de chips
 * que alarga la cabecera); como mucho, el ancho de la cabecera, y entonces sus chips pasan a otra línea, en horizontal.
 */
.tz-replay__sub {
  font-weight: var(--tz-weight-medium);
  color: var(--tz-text-muted);
}

.is-conditions > [data-testid='track-status'] {
  flex: none;
  max-width: 100%;
}

/*
 * Nivel 4 (useHeaderFit): con las banderas no cabe la fila ni con todo lo secundario en su forma más corta. El estado de
 * pista pasa a una fila propia, debajo de todo lo demás y a todo el ancho (sus chips, en horizontal), y lo demás vuelve
 * a la primera fila, con el título.
 */
.tz-replay__bar[data-fit~='4'] > .is-conditions {
  order: 99;
  flex: 1 0 100%;
  flex-wrap: wrap;
}

/*
 * Portátiles y tablet (< 1360 px), como en la lámina de D50: huecos más justos y las condiciones siempre en su fila, a
 * todo el ancho. Con su alto mínimo, la cabecera tiene su alto definitivo desde el primer frame, antes de que entren los
 * avisos y el estado de pista: la escena encuadra una vez con él y no tiene que moverse después (la barra no reencuadra).
 */
@media (width < 1360px) {
  .tz-replay__bar {
    column-gap: var(--tz-space-2);
  }

  .tz-replay__bar > .is-conditions {
    order: 99;
    flex: 1 0 100%;
    flex-wrap: wrap;
    min-height: 28px;
  }
}

/* Estado: un punto (el texto «Listo» sigue en el DOM, accesible); desde 1920 px, también «Listo» y el detalle. */
.tz-replay__status {
  margin: 0;
}

/* Lectura (D50): parece texto hasta que se pasa por encima. */
.tz-replay__status :deep(.tz-hint__trigger) {
  gap: var(--tz-space-2);
  height: 28px;
  padding: 0 var(--tz-space-2);
  border: 1px solid transparent;
  border-radius: var(--tz-radius-md);
  background: transparent;
  font-size: var(--tz-text-sm);
  font-weight: var(--tz-weight-medium);
  white-space: nowrap;
}

.tz-replay__dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--tz-success);
}

.tz-replay__detail {
  font-weight: var(--tz-weight-regular);
  color: var(--tz-text-muted);
}

@media (width < 1920px) {
  .tz-replay__ready {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .tz-replay__detail {
    display: none;
  }
}

@media (width < 640px) {
  .tz-replay__title {
    font-size: var(--tz-text-lg);
  }
}

/*
 * Prioridad del título (D44, useHeaderFit): si el título no cabe entero con lo que dicen las media queries, lo
 * secundario adelanta su forma corta por niveles acumulativos (`data-fit="1 2 3"`), los mismos cortes que por ancho (y
 * el 4, el estado de pista en su fila, arriba):
 *   1 → las formas de por debajo de 1920 px (estado sin «Listo», avisos con la cifra, «Cómo se dibuja» y meteorología
 *       sin lo de 1920, «≈ Estimado» corto);
 *   2 → las de por debajo de 1600 px (botones y menús solo con su icono, también «Altura» y «Separar coches»;
 *       meteorología solo con el suyo);
 *   3 → las de por debajo de 1360 px (huecos más justos y el cambio de
 *       diseño compacto: en táctil, un solo botón que alterna; con ratón, más estrecho, como el botón «?»).
 * Lo que se acorta sigue en el nombre accesible y en el título de cada control. «Estimado» y las banderas, siempre.
 * Un elemento nuevo de la cabecera (hueco replay-header) se suma sin tocar esto: su texto largo lleva
 * `data-fit-hide="N"` (se oculta desde el nivel N, como con su media query) y su forma corta, si la tiene,
 * `data-fit-show="N"` (se ve desde el nivel N).
 */
.tz-replay__bar[data-fit~='1'] :deep([data-fit-hide='1']),
.tz-replay__bar[data-fit~='2'] :deep([data-fit-hide='2']),
.tz-replay__bar[data-fit~='3'] :deep([data-fit-hide='3']) {
  display: none !important;
}

.tz-replay__bar[data-fit~='1'] :deep([data-fit-show='1']),
.tz-replay__bar[data-fit~='2'] :deep([data-fit-show='2']),
.tz-replay__bar[data-fit~='3'] :deep([data-fit-show='3']) {
  display: inline !important;
}

.tz-replay__bar[data-fit~='1'] .tz-replay__ready,
.tz-replay__bar[data-fit~='1'] :deep(.tz-estimated.is-compact .tz-estimated__tag),
.tz-replay__bar[data-fit~='1'] :deep(.tz-estimated.is-compact .tz-estimated__label) {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.tz-replay__bar[data-fit~='1'] .tz-replay__detail,
.tz-replay__bar[data-fit~='1'] :deep(.tz-notes__word),
.tz-replay__bar[data-fit~='1'] :deep(.tz-tools__how-text),
.tz-replay__bar[data-fit~='1'] :deep(.tz-weather__piece.is-wide) {
  display: none;
}

.tz-replay__bar[data-fit~='1'] :deep(.tz-estimated.is-compact .tz-estimated__short) {
  display: inline;
}

.tz-replay__bar[data-fit~='2'] :deep(.tz-analysis-btn),
.tz-replay__bar[data-fit~='2'] :deep(.tz-tv-btn) {
  padding: 0 var(--tz-space-2);
}

.tz-replay__bar[data-fit~='2'] :deep(.tz-analysis-btn__text),
.tz-replay__bar[data-fit~='2'] :deep(.tz-tv-btn__text),
.tz-replay__bar[data-fit~='2'] :deep(.tz-tools__menu-text),
.tz-replay__bar[data-fit~='2'] :deep(.tz-weather__pieces),
.tz-replay__bar[data-fit~='2'] :deep(.tz-weather__piece.is-mid),
.tz-replay__bar[data-fit~='2'] :deep(.tz-weather__nodata-long) {
  display: none;
}

/* Con lluvia, «Lluvia» se queda (sola, sin separador delante), como por debajo de 1600 px. */
.tz-replay__bar[data-fit~='2'] :deep(.tz-weather__pieces.has-always) {
  display: inline-flex;
}

.tz-replay__bar[data-fit~='2'] :deep(.tz-weather__piece.is-always)::before {
  content: none;
}

.tz-replay__bar[data-fit~='2'] :deep(.tz-weather__nodata-short) {
  display: inline;
}

.tz-replay__bar[data-fit~='3'] {
  column-gap: var(--tz-space-2);
}

.tz-replay__bar[data-fit~='2'] :deep(.tz-tools__label),
.tz-replay__bar[data-fit~='2'] :deep(.tz-tools__toggle-text) {
  display: none;
}

.tz-replay__bar[data-fit~='2'] :deep(.tz-tools__label-icon),
.tz-replay__bar[data-fit~='2'] :deep(.tz-tools__toggle-icon) {
  display: inline-block;
}

/*
 * El cambio de diseño y el botón «?» (Tanda 6), como por debajo de 1360 px (sus media queries): en táctil, el cambio de
 * diseño pasa a un solo botón que alterna (con su zona táctil); con ratón, los dos van con botones de 24 px de ancho
 * (el mínimo de WCAG 2.2).
 */
.tz-replay__bar[data-fit~='3'] :deep(.tz-layout-switch__group) {
  display: none;
}

.tz-replay__bar[data-fit~='3'] :deep(.tz-layout-switch__toggle) {
  display: inline-flex;
}

@media (hover: hover) and (pointer: fine) {
  .tz-replay__bar[data-fit~='3'] :deep(.tz-layout-switch__group) {
    display: inline-flex;
  }

  .tz-replay__bar[data-fit~='3'] :deep(.tz-layout-switch__toggle) {
    display: none;
  }

  .tz-replay__bar[data-fit~='3'] :deep(.tz-layout-switch__btn),
  .tz-replay__bar[data-fit~='3'] :deep(.tz-help-btn) {
    padding-inline: var(--tz-space-1);
  }
}


.tz-replay__stage {
  /* 1 si los paneles van en una franja inferior (tablet vertical): la escena encuadra por encima. */
  --replay-panels-bottom: 0;
  position: relative;
  z-index: var(--tz-z-panels);
  flex: 1 1 auto;
  min-height: 0;
  margin: 0 var(--tz-space-4) var(--replay-window-gap);
  pointer-events: none;
}

.tz-replay__stage > * {
  pointer-events: auto;
}

.tz-replay__window {
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(var(--replay-window-left) + var(--replay-window-gap));
  right: calc(var(--replay-side-w) + var(--replay-window-gap));
  border-radius: var(--tz-radius-xl);
  box-shadow:
    0 0 0 4000px var(--tz-bg),
    inset 0 0 0 1px var(--tz-canvas-edge);
  pointer-events: none !important;
}

/* Con la hoja de análisis abierta, la ventana es la hoja (mismo radio): el marco no hace falta. */
.tz-replay:has([data-testid='analysis-sheet']) .tz-replay__window {
  display: none;
}

/* Columna derecha: telemetría (si hay coche seleccionado) y, debajo, dirección de carrera. */
.tz-replay__side {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  gap: var(--tz-panel-gap);
  width: var(--replay-side-w);
  pointer-events: none;
  /*
   * Alto mínimo de la dirección de carrera bajo la telemetría (`--replay-rc-floor`, que leen las dos): el del diseño
   * (`--replay-rc-min`, más abajo) o, si con él no caben enteras las gráficas o las celdas de la telemetría, lo que esta
   * le pida (`--replay-rc-fit`, TzTelemetry): un mensaje (`--replay-rc-one`; con menos alto, la lista no asoma) o solo
   * la cabecera (`--replay-rc-head`). Nunca más que el del diseño.
   */
  --replay-rc-one: 6rem;
  --replay-rc-head: 48px;
  --replay-rc-floor: min(var(--replay-rc-min, 150px), var(--replay-rc-fit, 100vh));
}

.tz-replay__side > * {
  pointer-events: auto;
}

/* Con un coche elegido, la dirección de carrera general no está: la telemetría tiene toda la columna. */
.tz-replay__side:has([data-testid='telemetry']) {
  --replay-rc-floor: 0px;
}

/* Portátiles bajos (≤ 860 px de alto): con un coche elegido, de la dirección de carrera solo queda su cabecera. */
@media (height <= 860px) {
  .tz-replay__side:has([data-testid='telemetry']) {
    --replay-rc-min: var(--replay-rc-head);
  }
}

/* «Análisis»: con un coche elegido, la dirección de carrera conserva más alto (unos cuantos mensajes a la vista). */
.tz-replay.is-analysis .tz-replay__side:has([data-testid='telemetry']) {
  --replay-rc-min: 200px;
}

@media (height <= 860px) {
  .tz-replay.is-analysis .tz-replay__side:has([data-testid='telemetry']) {
    --replay-rc-min: 120px;
  }
}

/*
 * Asas de los anchos (ítem 15): sobre el borde que da al mapa, la mitad sobre el panel. La de la clasificación va
 * dentro de ella (su hueco por defecto); la de la columna derecha, en el escenario, a su izquierda.
 */
.tz-replay__resize.is-lb {
  right: calc(var(--tz-resize-hit) / -2);
}

.tz-replay__resize.is-side {
  right: calc(var(--replay-side-w) - var(--tz-resize-hit) / 2);
}

/*
 * Al montarse el replay, la clasificación, la columna derecha y el dock aparecen escalonados con un fundido (21b): solo
 * opacidad, porque la escena los mide para encuadrar (D42). Con reduced motion, la duración y el paso valen 0. Relleno
 * solo hacia atrás (invisibles mientras esperan su turno): al acabar, la animación no deja nada puesto.
 */
.tz-replay__lb,
.tz-replay__side,
.tz-replay__dock {
  animation: tz-fade var(--tz-dur-base) var(--tz-ease-enter) backwards;
}

.tz-replay__side {
  animation-delay: var(--tz-stagger);
}

.tz-replay__dock {
  animation-delay: calc(2 * var(--tz-stagger));
}

/* Tablet en horizontal y portátiles pequeños: paneles más estrechos. */
@media (width <= 1100px) {
  .tz-replay {
    --replay-side-w: var(--tz-panel-w-narrow);
  }
}

/*
 * Tablet en vertical: el mapa arriba y los paneles en una franja inferior, en dos columnas. La escena
 * encuadra el circuito por encima de esa franja (TzScene mide los paneles que ocupan la parte baja).
 */
@media (width <= 900px) and (orientation: portrait) {
  .tz-replay {
    --replay-over-left: var(--tz-space-6);
    --replay-over-right: var(--tz-space-6);
    --replay-over-max: calc(100% - 2 * var(--tz-space-6));
  }

  /* Sin ventana en vertical: el mapa va arriba y los paneles en la franja de abajo. */
  .tz-replay__window {
    display: none;
  }

  .tz-replay__stage {
    --replay-panels-bottom: 1;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-content: end;
    gap: var(--tz-panel-gap);
  }

  .tz-replay__stage > * {
    position: relative;
    max-height: 34vh;
  }

  .tz-replay__side {
    position: relative;
    inset: auto;
    width: auto;
    height: 34vh;
  }

  /* «Análisis» (ítem 15): sin anchos ni asas en vertical; la clasificación, con sus columnas extra, toma más franja. */
  .tz-replay.is-analysis .tz-replay__stage {
    grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  }

  /*
   * Con un coche elegido, la telemetría manda: la franja crece (en 34vh no cabían sus cifras) y de la dirección de
   * carrera queda al menos su cabecera (también en «Análisis»). Las mini gráficas que no quepan enteras no van.
   */
  .tz-replay__stage:has([data-testid='telemetry']) > * {
    max-height: 46vh;
  }

  .tz-replay__stage:has([data-testid='telemetry']) > .tz-replay__side {
    height: 46vh;
  }

  .tz-replay .tz-replay__side:has([data-testid='telemetry']),
  .tz-replay.is-analysis .tz-replay__side:has([data-testid='telemetry']) {
    --replay-rc-min: var(--replay-rc-head);
  }
}

/*
 * Carga y error: el panel, centrado en toda la página. La capa la cubre entera (cabecera incluida) y va después en el
 * DOM, así que solo el panel recibe el puntero: la marca (volver al selector) y el cambio de idioma de la cabecera
 * siguen pulsándose mientras se carga o con el error a la vista.
 */
.tz-replay__center {
  position: absolute;
  inset: 0;
  z-index: var(--tz-z-panels);
  display: grid;
  place-items: center;
  pointer-events: none;
}

.tz-replay__center > * {
  pointer-events: auto;
}

/*
 * Modo compacto (móvil y ventanas pequeñas; `COMPACT_QUERY` de useReplayLayout): una fila de cabecera con «⋯», el mapa
 * en todo el escenario y los paneles en una hoja inferior (TzSheetHead): asomada (solo la cabecera de la hoja), media o
 * entera, con un panel a la vista (`data-tab`). La escena encuadra por encima de la hoja (`--replay-panels-bottom`).
 */
@media (width < 768px), (height < 500px) {
  .tz-replay {
    --replay-over-left: var(--tz-space-3);
    --replay-over-right: var(--tz-space-3);
    --replay-over-max: calc(100% - 2 * var(--tz-space-3));
  }

  /* Opaca: en móvil no hay ventana del mapa y la escena ocupa toda la pantalla por detrás. */
  .tz-replay__bar {
    padding: var(--tz-space-2) var(--tz-space-3);
    background: var(--tz-bg);
  }

  /* Solo el Gran Premio: el resto del título sigue en su `title`. */
  .tz-replay__sub {
    display: none;
  }

  .tz-replay__more {
    margin-left: auto;
  }

  /*
   * Cerrada, la fila de las condiciones solo con el estado de pista y solo si dice algo (SC, banderas, «Estimado»): la
   * meteorología y los avisos van con lo demás al pulsar «⋯».
   */
  .tz-replay__bar > .is-conditions {
    min-height: 0;
  }

  .tz-replay__bar:not([data-more='open']) > .is-conditions > :not([data-testid='track-status']),
  .tz-replay__bar:not([data-more='open']) > .is-conditions:not(:has(.tz-ts > *)) {
    display: none;
  }

  /* Vista, escena y ayuda: fuera hasta pulsar «⋯»; entonces, una fila cada una, a todo el ancho. */
  .tz-replay__bar:not([data-more='open']) > :is(.is-view, .is-scene, .is-help) {
    display: none;
  }

  /*
   * Abierta («⋯»): un panel bajo la fila del título con una fila por grupo (condiciones, vista, escena y cámara, ayuda),
   * su rótulo encima (el nombre del grupo) y un filete; los botones, con su texto, que aquí cabe.
   */
  .tz-replay__bar[data-more='open'] > :is(.is-conditions, .is-view, .is-scene, .is-help) {
    order: 100;
    flex: 1 0 100%;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--tz-space-2);
    margin-left: 0;
    padding: var(--tz-space-2) 0 var(--tz-space-1);
    border-left: 0;
    border-top: 1px solid var(--tz-border);
  }

  .tz-replay__bar[data-more='open'] > :is(.is-conditions, .is-view, .is-scene, .is-help)::before {
    content: attr(aria-label);
    flex: 1 0 100%;
    color: var(--tz-text-faint);
    font-size: var(--tz-text-2xs);
  }

  .tz-replay__bar[data-more='open'] :deep(:is(.tz-tools__menu-text, .tz-analysis-btn__text, .tz-tools__label, .tz-tools__toggle-text, .tz-tv-btn__text, .tz-notes__word)) {
    display: inline;
  }

  .tz-replay__bar[data-more='open'] :deep(.tz-tools) {
    justify-content: flex-start;
  }

  .tz-replay__bar[data-more='open'] :deep(:is(.tz-tools__label-icon, .tz-tools__toggle-icon)) {
    display: none;
  }

  /*
   * Los desplegables (capas, cámara, «Cómo se dibuja», meteorología, avisos), a lo ancho bajo la cabecera: anclados a
   * su botón, con hasta 460 px, se salían de la pantalla.
   */
  .tz-replay__bar :deep(.tz-disclosure) {
    position: static;
  }

  .tz-replay__bar :deep(.tz-disclosure__panel) {
    top: 100%;
    right: var(--tz-space-3);
    left: var(--tz-space-3);
    width: auto;
    max-height: 60vh;
  }

  /* Con la hoja no hay paneles que elegir. */
  .tz-replay__bar :deep(.tz-layout-switch) {
    display: none;
  }

  .tz-replay__window,
  .tz-replay__resize {
    display: none;
  }

  .tz-replay__stage {
    --replay-panels-bottom: 1;
    --sheet-body: 0px;
    display: block;
    margin: 0;
  }

  .tz-replay__stage[data-sheet='half'] {
    --sheet-body: calc(50% - 56px);
  }

  .tz-replay__stage[data-sheet='full'] {
    --sheet-body: calc(100% - 64px);
  }

  .tz-replay__stage > .tz-sheet {
    position: absolute;
    left: 0;
    right: 0;
    bottom: var(--sheet-body);
    z-index: 1;
  }

  /* Más específicas que las de la tablet en vertical (alto de 34 o 46vh), que también se aplican por debajo de 900 px. */
  .tz-replay .tz-replay__stage[data-sheet] > :is(.tz-replay__lb, .tz-replay__side) {
    position: absolute;
    top: auto;
    left: 0;
    right: 0;
    bottom: 0;
    width: auto;
    height: var(--sheet-body);
    max-height: none;
    padding: 0 var(--tz-space-3);
    background: var(--tz-surface-1);
    animation: none;
  }

  .tz-replay .tz-replay__stage[data-sheet='peek'] > :is(.tz-replay__lb, .tz-replay__side),
  .tz-replay .tz-replay__stage[data-sheet]:not([data-tab='lb']) > .tz-replay__lb,
  .tz-replay .tz-replay__stage[data-tab='lb'] > .tz-replay__side {
    display: none;
  }

  /* En la columna derecha, solo el panel de la pestaña: la telemetría del coche o la dirección de carrera. */
  .tz-replay__stage[data-tab='car'] > .tz-replay__side :deep([data-testid='race-control']),
  .tz-replay__stage[data-tab='rc'] > .tz-replay__side :deep([data-testid='telemetry']) {
    display: none;
  }

  .tz-replay__side > :deep(*) {
    flex: 1 1 auto;
    min-height: 0;
  }

  /* En la hoja, la pestaña ya dice qué panel es: su título, solo para los lectores de pantalla. */
  .tz-replay__stage[data-sheet] :deep(:is(.tz-lb__title, .tz-rc__title)) {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
}
</style>
