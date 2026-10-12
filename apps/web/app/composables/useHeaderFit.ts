/**
 * Prioridad del título en la cabecera del replay (D44): mide si el título cabe entero y la cabecera va en una fila y,
 * si no, adelanta las formas cortas de lo secundario por niveles (engine/layout/fit.ts) con el atributo `data-fit` de
 * la cabecera (los estilos de cada nivel están en pages/replay.vue); el último pasa el estado de pista a su propia fila
 * si la cabecera se parte de todos modos. Las etiquetas «Estimado» y las banderas no se esconden en ningún nivel: solo
 * pasan a su forma corta, como por debajo de 1920 px.
 *
 * Se vuelve a medir cuando cambia el tamaño de la cabecera, de alguno de sus elementos (la meteorología que cambia
 * de medida, el idioma, la ventana) o de alguno de los chips del estado de pista, o cuando entra o sale uno de ellos (en
 * su fila propia, el estado de pista no cambia de tamaño al perder una bandera, y quizá ya quepa en la del título);
 * como mucho una vez por frame y nunca por cada frame de la reproducción (nada más hondo: el texto que cambia dentro de
 * un elemento, como la edad de la medida de la meteorología, no obliga a medir). El atributo se escribe directo en el
 * DOM: cada nivel se mide en el mismo frame, sin pintar los intermedios.
 */
import type { Ref } from 'vue'
import { chooseLevel, fitAttribute, HEADER_FIT_MAX, type HeaderFit } from '~/engine/layout/fit'

/** Un elemento está en otra fila si su borde de arriba queda más abajo que esto del de la primera (px). */
const ROW_TOLERANCE_PX = 12

export function useHeaderFit(bar: Ref<HTMLElement | null>, title: Ref<HTMLElement | null>): Readonly<Ref<number>> {
  const level = ref(0)
  let raf = 0
  let resize: ResizeObserver | null = null
  let mutation: MutationObserver | null = null

  const inFlow = (el: Element): el is HTMLElement =>
    el instanceof HTMLElement && el.offsetWidth > 0 && getComputedStyle(el).position !== 'absolute'

  /** ¿El título cabe entero y todo va en una fila? Y el alto de la cabecera (lo que le quita a la escena). */
  function fit(): HeaderFit {
    return { fits: fits(), height: bar.value?.offsetHeight ?? 0 }
  }

  /**
   * Lo que va en su propia fila a propósito (las condiciones por debajo de 1360 px o en el nivel 4, a todo el ancho):
   * no cuenta para saber si la primera fila cabe. Si contara, la cabecera nunca «cabría» y lo secundario pasaría a su
   * forma más corta sin necesidad.
   */
  const ownRow = (el: HTMLElement) => getComputedStyle(el).flexBasis === '100%'

  function fits(): boolean {
    const b = bar.value
    const t = title.value
    if (!b || !t) return true
    if (t.scrollWidth > t.clientWidth + 1) return false
    const items = [...b.children].filter(inFlow).filter((e) => !ownRow(e))
    if (items.length < 2) return true
    const top = Math.min(...items.map((e) => e.offsetTop))
    return items.every((e) => e.offsetTop < top + ROW_TOLERANCE_PX)
  }

  function apply(l: number) {
    const attr = fitAttribute(l)
    if (attr === null) bar.value?.removeAttribute('data-fit')
    else bar.value?.setAttribute('data-fit', attr)
  }

  function measure() {
    raf = 0
    if (!bar.value || !title.value) return
    level.value = chooseLevel(HEADER_FIT_MAX, apply, fit)
  }

  function schedule() {
    if (!raf) raf = requestAnimationFrame(measure)
  }

  /**
   * La cabecera, cada uno de sus elementos (el destino de las herramientas de la escena, incluido) y los chips del
   * estado de pista; los elementos que entran o salen en la cabecera y en el estado de pista.
   */
  function observe() {
    const b = bar.value
    if (!resize || !mutation || !b) return
    resize.disconnect()
    mutation.disconnect()
    resize.observe(b)
    mutation.observe(b, { childList: true })
    // Cada grupo (D50) y lo que entra o sale en él (el estado de pista, los avisos, la meteorología).
    for (const child of b.children) {
      resize.observe(child)
      mutation.observe(child, { childList: true })
    }
    // Dentro de su grupo (D50: condiciones), que en su fila propia no cambia de tamaño al perder un chip.
    const status = b.querySelector('[data-testid="track-status"]')
    if (status) {
      mutation.observe(status, { childList: true })
      for (const chip of status.children) resize.observe(chip)
    }
  }

  onMounted(() => {
    if (typeof ResizeObserver === 'undefined' || typeof MutationObserver === 'undefined' || !bar.value) return
    resize = new ResizeObserver(schedule)
    mutation = new MutationObserver(() => {
      observe()
      schedule()
    })
    observe()
    schedule()
    // La ventana también avisa: el ResizeObserver de la cabecera llega con el siguiente frame, y con la escena en pausa
    // un navegador sin pantalla puede no pintar ninguno tras cambiar de tamaño (la cabecera se quedaba con el nivel de
    // antes, sin medir).
    window.addEventListener('resize', schedule, { passive: true })
  })

  onBeforeUnmount(() => {
    window.removeEventListener('resize', schedule)
    resize?.disconnect()
    mutation?.disconnect()
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  })

  return readonly(level)
}
