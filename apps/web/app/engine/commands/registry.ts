/**
 * Registro de comandos de la paleta (ítem 14, D43): cada fichero de `builtin/*.ts` exporta `commands` y aquí se
 * juntan por glob, en orden de fichero. Una función nueva añade su comando soltando un fichero (D29), sin tocar la
 * paleta. De la consulta a la lista: cada comando propone sus sugerencias, se ordenan por puntuación (a igualdad, por
 * grupo y en el orden en que llegaron), se quitan las repetidas y se agrupan para pintarlas. TS puro.
 */
import { parseQuery } from './parse'
import {
  COMMAND_GROUPS,
  type CommandContext,
  type CommandDef,
  type CommandGroup,
  type CommandModule,
  type Suggestion,
} from './types'

/** Por debajo de esto, una sugerencia no sale (encaja demasiado poco con lo escrito). */
export const MIN_SCORE = 0.3
/** Sugerencias como mucho. */
export const MAX_SUGGESTIONS = 12

/** Valida los ficheros de comandos (cada uno con su lista, ids únicos) y los junta en orden de fichero. */
export function collectCommands(modules: Readonly<Record<string, Partial<CommandModule>>>): readonly CommandDef[] {
  const seen = new Set<string>()
  const out: CommandDef[] = []
  for (const [path, mod] of Object.entries(modules).sort(([a], [b]) => a.localeCompare(b))) {
    if (!Array.isArray(mod.commands)) throw new Error(`${path}: falta «export const commands: CommandDef[] = [...]»`)
    for (const cmd of mod.commands) {
      if (typeof cmd.id !== 'string' || !cmd.id || typeof cmd.suggest !== 'function') {
        throw new Error(`${path}: cada comando necesita «id» y «suggest»`)
      }
      if (seen.has(cmd.id)) throw new Error(`${path}: el comando «${cmd.id}» está repetido`)
      seen.add(cmd.id)
      out.push(cmd)
    }
  }
  return Object.freeze(out)
}

/** ¿Tiene el anfitrión todos los servicios que necesita el comando? */
export function available(cmd: CommandDef, ctx: CommandContext): boolean {
  return (cmd.needs ?? []).every((name) => ctx.services[name] !== undefined)
}

const groupRank = (g: CommandGroup) => COMMAND_GROUPS.indexOf(g)

/**
 * Sugerencias para lo escrito: de los comandos disponibles, las que encajan (≥ `MIN_SCORE`), de la que más a la que
 * menos (a igualdad, por grupo y por orden de llegada), sin repetir clave y como mucho `limit`. Con la consulta vacía,
 * las destacadas de cada comando.
 */
export function suggest(
  commands: readonly CommandDef[],
  input: string,
  ctx: CommandContext,
  limit = MAX_SUGGESTIONS,
): Suggestion[] {
  const query = parseQuery(input)
  const all: { s: Suggestion; i: number }[] = []
  for (const cmd of commands) {
    if (!available(cmd, ctx)) continue
    for (const s of cmd.suggest(query, ctx)) {
      if (s.score >= MIN_SCORE) all.push({ s, i: all.length })
    }
  }
  all.sort((a, b) => b.s.score - a.s.score || groupRank(a.s.group) - groupRank(b.s.group) || a.i - b.i)
  const seen = new Set<string>()
  const out: Suggestion[] = []
  for (const { s } of all) {
    if (seen.has(s.key)) continue
    seen.add(s.key)
    out.push(s)
    if (out.length >= limit) break
  }
  return out
}

export interface SuggestionGroup {
  readonly group: CommandGroup
  readonly items: readonly Suggestion[]
}

/**
 * Agrupadas para pintarlas: cada grupo donde aparece por primera vez su mejor sugerencia (la lista ya viene ordenada)
 * y, dentro, en el mismo orden. Recorrer los grupos en orden da el orden de ↑/↓.
 */
export function groupSuggestions(list: readonly Suggestion[]): SuggestionGroup[] {
  const groups = new Map<CommandGroup, Suggestion[]>()
  for (const s of list) {
    const items = groups.get(s.group)
    if (items) items.push(s)
    else groups.set(s.group, [s])
  }
  return [...groups].map(([group, items]) => ({ group, items }))
}

/** El orden de ↑/↓: los grupos en orden y, dentro, sus sugerencias. */
export function flatten(groups: readonly SuggestionGroup[]): Suggestion[] {
  return groups.flatMap((g) => g.items)
}

/** Los comandos de serie (`builtin/*.ts`, sin sus tests). */
export const BUILTIN_COMMANDS = collectCommands(
  import.meta.glob<CommandModule>(['./builtin/*.ts', '!./builtin/*.test.ts'], { eager: true }),
)
