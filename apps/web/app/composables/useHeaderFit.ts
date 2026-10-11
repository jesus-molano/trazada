/**
 * Prioridad del título en la cabecera del replay (D44): mide si el título cabe entero y la cabecera va en una fila y,
 * si no, adelanta las formas cortas de lo secundario por niveles (engine/layout/fit.ts) con el atributo `data-fit` de
 * la cabecera (los estilos de cada nivel están en pages/replay.vue); el último pasa el estado de pista a su propia fila
 * si la cabecera se parte de todos modos. Las etiquetas «Estimado» y las banderas no se esconden en ningún nivel: solo
 * pasan a su forma corta, como por debajo de 1920 px.
 *
 * Se vuelve a medir cuando cambia el tamaño de la cabecera o de alguno de sus elementos (un chip de bandera que
 * entra, la meteorología que cambia de medida, el idioma, la ventana) o cuando entra o sale un elemento en cualquier
 * punto de ella (en su fila propia, el estado de pista no cambia de tamaño al perder un chip, y quizá ya quepa en la
 * del título), como mucho una vez por frame y nunca por cada frame de la reproducción. El atributo se escribe directo
 * en el DOM: cada nivel se mide en el mismo frame, sin pintar los intermedios.
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

  function fits(): boolean {
    const b = bar.value
    const t = title.value
    if (!b || !t) return true
    if (t.scrollWidth > t.clientWidth + 1) return false
    const items = [...b.children].filter(inFlow)
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

  /** La cabecera y cada uno de sus elementos (el destino de las herramientas de la escena, incluido). */
  function observe() {
    const b = bar.value
    if (!resize || !b) return
    resize.disconnect()
    resize.observe(b)
    for (const child of b.children) resize.observe(child)
  }

  onMounted(() => {
    if (typeof ResizeObserver === 'undefined' || typeof MutationObserver === 'undefined' || !bar.value) return
    resize = new ResizeObserver(schedule)
    mutation = new MutationObserver(() => {
      observe()
      schedule()
    })
    mutation.observe(bar.value, { childList: true, subtree: true })
    observe()
    schedule()
  })

  onBeforeUnmount(() => {
    resize?.disconnect()
    mutation?.disconnect()
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  })

  return readonly(level)
}
