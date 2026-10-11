/**
 * Vista del mapa (D53): si se ha movido respecto a la vista general por defecto y la acción «Centrar», que la escena
 * registra (`register`) y lanzan el botón del mapa, el menú «Cámara», la tecla C, la paleta y el doble toque en el
 * vacío. Estado grueso: `moved` cambia al empezar a mover el mapa y al centrar, nunca por frame.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useViewStore = defineStore('view', () => {
  /** El usuario ha movido el mapa a mano desde la última vista general por defecto. */
  const moved = ref(false)
  let handler: (() => void) | null = null

  /** La escena da su «Centrar»; devuelve la baja (que no quita un registro posterior). */
  function register(fn: () => void): () => void {
    handler = fn
    return () => {
      if (handler === fn) handler = null
    }
  }

  /** Vuelve a la vista general por defecto (desde el seguimiento o la realización, también). Sin escena, nada. */
  function recenter(): void {
    handler?.()
  }

  return { moved, register, recenter }
})
