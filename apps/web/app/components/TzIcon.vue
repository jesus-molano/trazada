<script setup lang="ts">
/**
 * Icono del registro semántico (design/icons.ts). Sin `label` es decorativo (aria-hidden): el texto de al lado
 * lo dice todo. Con `label` (ya traducido) es una imagen con nombre, para cuando va solo dentro de un control.
 * Un icono nunca sustituye al texto honesto («Estimado:», «sin dato»): lo acompaña.
 */
import { type IconName, type IconProps, ICONS } from '~/design/icons'

const props = withDefaults(defineProps<{ name: IconName; size?: 'sm' | 'md' | 'lg'; label?: string }>(), {
  size: 'md',
  label: undefined,
})

const icon = computed(() => ICONS[props.name])
/** Atributos del <svg> (Lucide pasa los que no conoce tal cual). */
const attrs = computed<IconProps & { [data: `data-${string}`]: string }>(() => ({
  class: ['tz-icon', `tz-icon--${props.size}`],
  'data-icon': props.name,
  ...(props.label ? { role: 'img', 'aria-label': props.label } : { 'aria-hidden': 'true', focusable: 'false' }),
}))
</script>

<template>
  <component :is="icon" v-bind="attrs" />
</template>
