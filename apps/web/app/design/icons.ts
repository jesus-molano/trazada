/**
 * Registro semántico de iconos (D30): nombres de Trazada, no de Lucide. Es el único sitio que importa
 * `@lucide/vue` (lo comprueba icons.test.ts): los componentes usan `<TzIcon name="…">`, así cambiar un dibujo
 * es tocar una línea. Lucide (ISC; los derivados de Feather, MIT) va dentro del bundle, con importaciones con
 * nombre: solo se empaqueta lo registrado y no hay ninguna petición externa.
 *
 * Honestidad: un icono acompaña al texto («Estimado:», «sin dato», «sin señal»), nunca lo sustituye.
 * Legal: nada de iconos de marcas, coches, banderas a cuadros ni con connotación de IA (destellos, robots).
 */
import {
  ArrowDown,
  ArrowLeft,
  ArrowLeftRight,
  ArrowUp,
  ChartLine,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleQuestionMark,
  Clapperboard,
  CloudRain,
  Columns3,
  Command,
  Copy,
  Download,
  EqualApproximately,
  Eye,
  Flag,
  Ghost,
  GripVertical,
  History,
  Info,
  Languages,
  Layers,
  ListOrdered,
  LoaderCircle,
  LocateFixed,
  type LucideIcon,
  Map as MapIcon,
  MonitorX,
  Mountain,
  MoveHorizontal,
  PanelsTopLeft,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Scan,
  Search,
  SignalZero,
  SkipBack,
  SkipForward,
  Thermometer,
  TriangleAlert,
  Video,
  Wind,
  X,
} from '@lucide/vue'

export const ICONS = {
  // Acciones y navegación
  close: X,
  chevron: ChevronDown,
  next: ChevronRight,
  prev: ChevronLeft,
  back: ArrowLeft,
  play: Play,
  pause: Pause,
  jumpBack: SkipBack,
  jumpForward: SkipForward,
  download: Download,
  retry: RotateCcw,
  copy: Copy,
  check: Check,
  search: Search,
  command: Command,
  language: Languages,
  resume: History,
  layout: PanelsTopLeft,
  /** Asa para cambiar el ancho de un panel. */
  grip: GripVertical,
  // Información y estados (siempre junto a su texto)
  info: Info,
  help: CircleQuestionMark,
  alert: TriangleAlert,
  error: CircleAlert,
  estimated: EqualApproximately,
  noSignal: SignalZero,
  loading: LoaderCircle,
  webgl: MonitorX,
  // Escena y cámara
  follow: LocateFixed,
  overview: MapIcon,
  recenter: Scan,
  layers: Layers,
  camera: Video,
  director: Clapperboard,
  elevation: Mountain,
  separation: MoveHorizontal,
  // Carrera y análisis
  radio: Radio,
  flag: Flag,
  gain: ArrowUp,
  loss: ArrowDown,
  compare: ArrowLeftRight,
  ghost: Ghost,
  analysis: ChartLine,
  summary: ListOrdered,
  // Diseños del replay (ítem 15): «Espectador» (el mapa primero) y «Análisis» (más columnas)
  spectator: Eye,
  columns: Columns3,
  // Meteorología
  rain: CloudRain,
  temperature: Thermometer,
  wind: Wind,
} as const satisfies Record<string, LucideIcon>

export type IconName = keyof typeof ICONS
/** Atributos que acepta un icono de Lucide (para TzIcon, que no importa @lucide/vue). */
export type { LucideProps as IconProps } from '@lucide/vue'

export const ICON_NAMES = Object.keys(ICONS) as IconName[]

export function isIconName(value: string): value is IconName {
  return Object.hasOwn(ICONS, value)
}
