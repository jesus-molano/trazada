/**
 * Radio de los equipos (D51): qué enseña el panel de dirección de carrera (todo, solo dirección de carrera o solo la
 * radio) y «Escuchar en directo», apagado por defecto (no se recuerda: al abrir otra sesión vuelve a estar apagado).
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

export type RadioFilter = 'all' | 'rc' | 'radio'

export const useRadioStore = defineStore('radio', () => {
  const filter = ref<RadioFilter>('all')
  const live = ref(false)
  return { filter, live }
})
