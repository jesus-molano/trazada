/**
 * Banderas en SVG (country-flag-icons, MIT), empaquetadas con la app: nada se pide fuera. Los emoji de bandera no
 * sirven: en Windows (Chrome/Edge) se ven como dos letras.
 */
import {
  AE, AT, AU, AZ, BE, BH, BR, CA, CN, DE, ES, FR, GB, HU,
  IT, JP, MC, MX, MY, NL, PT, QA, RU, SA, SG, TR, US,
} from 'country-flag-icons/string/3x2' // prettier-ignore
import type { IsoCode } from './countries'

const SVG: Record<IsoCode, string> = {
  AE, AT, AU, AZ, BE, BH, BR, CA, CN, DE, ES, FR, GB, HU,
  IT, JP, MC, MX, MY, NL, PT, QA, RU, SA, SG, TR, US,
} // prettier-ignore

/** SVG de la bandera como URI `data:` (para un <img>, sin v-html). */
export function flagSrc(iso: IsoCode): string {
  return `data:image/svg+xml,${encodeURIComponent(SVG[iso])}`
}

/** Solo para los tests: el SVG en crudo. */
export function flagSvg(iso: IsoCode): string {
  return SVG[iso]
}
