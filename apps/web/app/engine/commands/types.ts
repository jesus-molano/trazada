/**
 * Paleta de comandos (ítem 14, D43): lo que comparten el registro, los comandos (`builtin/*.ts`) y quien los ejecuta
 * (`replay-overlays/TzCommandPalette.vue`). TS puro: los comandos no importan Vue ni stores; leen una foto del estado
 * (`CommandContext`) y actúan a través de servicios que pone el anfitrión (`CommandServices`, registrados en
 * `replay/commands.ts`). Así un comando nuevo es un fichero nuevo en `builtin/` y, si necesita algo que aún no existe,
 * declara su servicio (ver `CommandServices`) y quien lo tenga lo registra.
 *
 * Honestidad: lo que no se puede hacer (vuelta 70 de 53, un piloto que no está, ninguna parada…) sale deshabilitado
 * con su motivo («sin dato»), nunca con un destino inventado. Nada es irreversible: todo es mover el reloj, elegir,
 * seguir o comparar pilotos, o la velocidad.
 */
import type { DriverInfo, SessionType } from '@trazada/schema'
import type { LapTable } from '../analysis/lapTable'
import type { Rate } from '../clock/SessionClock'
import type { EstimatedField } from '../estimated'
import type { DuelsResult } from '../moments/duels'
import type { Overtake } from '../moments/overtakes'
import type { TimelineMarkers } from '../timeline/markers'
import type { Query } from './parse'

/** Un texto por traducir: clave de i18n (namespace `palette`) y sus parámetros. La paleta lo traduce. */
export interface Text {
  readonly key: string
  readonly params?: Readonly<Record<string, string | number>>
  /** Para los mensajes con plural. */
  readonly plural?: number
}

/**
 * Marca una clave de i18n y la devuelve sin traducir (el motor no traduce). Se llama `t` a propósito: así ESLint
 * (`@intlify/vue-i18n/no-missing-keys` y `no-unused-keys`) comprueba también las claves que usan los comandos.
 */
export function t(key: string, params?: Readonly<Record<string, string | number>>, plural?: number): Text {
  return plural === undefined ? (params ? { key, params } : { key }) : { key, params, plural }
}

/** Grupos de la lista, en este orden a igual puntuación. `layout` y `help` los usan otras funciones (ítems 15 y 18). */
export const COMMAND_GROUPS = ['drivers', 'goto', 'playback', 'compare', 'layout', 'help'] as const
export type CommandGroup = (typeof COMMAND_GROUPS)[number]

export const GROUP_LABELS: Readonly<Record<CommandGroup, Text>> = {
  drivers: t('palette.group.drivers'),
  goto: t('palette.group.goto'),
  playback: t('palette.group.playback'),
  compare: t('palette.group.compare'),
  layout: t('palette.group.layout'),
  help: t('palette.group.help'),
}

/** Una sugerencia de la paleta: qué hará (antes de pulsar Enter) o por qué no se puede. */
export interface Suggestion {
  /** Única en la lista (también da el id del DOM de la opción). */
  readonly key: string
  readonly group: CommandGroup
  /** 0–1: cuánto encaja con lo escrito; con la consulta vacía, el orden de las destacadas. */
  readonly score: number
  readonly title: Text
  /** Qué pasará al pulsar Enter, en concreto (destino, piloto, hora…). */
  readonly detail?: Text
  /** Por qué no se puede: la sugerencia sale deshabilitada, sin `run`. */
  readonly disabled?: Text
  /** Lo que hace. Solo en las habilitadas. */
  readonly run?: () => void
  /** Instante al que lleva (ms de sesión): la paleta enseña la vista previa de ese instante. */
  readonly seekTo?: number
  /** Coche al que se refiere (su color, solo como marca, nunca como color de texto). */
  readonly car?: string
  /** Texto con el que Tab completa la consulta. */
  readonly complete?: string
  /**
   * El detalle enseña una estimación (`engine/estimated.ts`): la paleta le pone su etiqueta «Estimado»
   * (`<TzEstimated>`). P. ej., el instante GPS de un adelantamiento (`overtakeTime`).
   */
  readonly estimated?: EstimatedField
}

/** Lo fijo de la sesión abierta (se construye una vez con `commandSessionInfo`). */
export interface CommandSessionInfo {
  readonly type: SessionType
  /** Carrera o sprint: hay vueltas del líder. */
  readonly race: boolean
  readonly drivers: readonly DriverInfo[]
  /** Intervalo de reproducción (ms de sesión). */
  readonly startMs: number
  readonly endMs: number
  /** Origen del reloj visible del dock: lo que se ve es t − origen. */
  readonly originMs: number
  /** Instante por defecto al abrir (el inicio o, en carrera, poco antes de la salida). */
  readonly defaultMs: number
  /** Vueltas de la carrera según el manifest; null fuera de carrera o sin dato. */
  readonly totalLaps: number | null
  readonly markers: TimelineMarkers
  /** Vueltas de cada coche (el índice de la clasificación). */
  readonly laps: LapTable
}

/** Foto del estado en el momento de escribir. */
export interface CommandState {
  readonly timeMs: number
  readonly playing: boolean
  readonly rate: Rate
  readonly selectedCar: string | null
  readonly following: boolean
  /** Orden de los coches en la clasificación (el de ↑/↓); para listar pilotos. */
  readonly order: readonly string[]
}

/** Reproducción, selección y cámara (stores/playback). */
export interface PlaybackService {
  play(): void
  pause(): void
  setRate(rate: Rate): void
  seek(t: number): void
  select(car: string | null): void
  follow(on: boolean): void
}

/** Comparar dos pilotos (stores/compare, ítem 1). */
export interface CompareService {
  /** El coche B de la comparación abierta (null si no hay ninguna). */
  readonly comparing: string | null
  /** Selecciona A y abre «Comparar» con B. */
  compare(a: string, b: string): void
  close(): void
}

/** Reanudar donde lo dejaste (ítem 13). */
export interface ResumeService {
  /** Instante retomado al abrir la sesión (ms de sesión); null si no se retomó nada. */
  readonly resumedMs: number | null
}

/**
 * Momentos de la sesión (ítem 5, D35), si esa función está (lo registran los botones de salto del dock con su
 * precálculo, `stores/moments.ts`). Sin el servicio, los comandos de momentos no se ofrecen.
 */
export interface MomentsService {
  /** Adónde saltan ⏮ ⏭ (de la clase elegida en la pestaña «Momentos»), en orden de t: «siguiente momento». */
  list(): readonly { readonly t: number }[]
  /**
   * Adelantamientos de toda la sesión: cambios del orden oficial en la línea de meta, con su instante GPS aproximado
   * (`atMs`) o sin él. Solo en carrera y sprint (si no, ninguno); la vuelta 1, nunca.
   */
  overtakes(): readonly Overtake[]
  /** Duelos a menos de 1 s de toda la sesión, o por qué no se buscan (`status`). */
  duels(): DuelsResult
  /**
   * «Sin spoilers» de la hoja de análisis (activo por defecto): los textos no dicen quién adelanta a quién ni quiénes
   * pelean hasta que la línea de meta lo confirma.
   */
  readonly noSpoilers: boolean
}

/**
 * Lo que el anfitrión pone a disposición de los comandos (`replay/commands.ts`). Una función nueva que necesite otro
 * servicio lo declara junto a su comando:
 *
 *   declare module '../types' { interface CommandServices { layout: LayoutService } }
 *
 * y lo registra donde tenga el estado (`registerCommandService('layout', …)`). Un comando con `needs` solo se ofrece
 * con todos sus servicios registrados.
 */
export interface CommandServices {
  playback: PlaybackService
  compare: CompareService
  resume: ResumeService
  moments: MomentsService
}
export type ServiceName = keyof CommandServices

export interface CommandContext {
  readonly session: CommandSessionInfo
  readonly state: CommandState
  readonly services: Partial<CommandServices>
}

/** Un comando: de la consulta y el contexto, sus sugerencias (ninguna si no tiene nada que ver). */
export interface CommandDef {
  /** Estable y único entre todos los comandos. */
  readonly id: string
  /** Servicios sin los que no se ofrece. */
  readonly needs?: readonly ServiceName[]
  suggest(query: Query, ctx: CommandContext): readonly Suggestion[]
}

/** Contrato de cada fichero de `builtin/`: `export const commands: CommandDef[] = [...]`. */
export interface CommandModule {
  readonly commands: readonly CommandDef[]
}
