<script setup lang="ts">
import { isoForCountry } from '~/venues/countries'
import { flagSrc } from '~/venues/flags'

/** Bandera del país (decorativa: el nombre del país va siempre en texto al lado). Sin código conocido, nada. */
const props = defineProps<{ country: string }>()
const iso = computed(() => isoForCountry(props.country))
</script>

<template>
  <img
    v-if="iso"
    class="tz-flag"
    :src="flagSrc(iso)"
    alt=""
    aria-hidden="true"
    width="21"
    height="14"
    :data-iso="iso"
    data-testid="flag"
  >
</template>

<style scoped>
.tz-flag {
  flex: none;
  width: 21px;
  height: 14px;
  border-radius: 2px;
  /* Contorno para banderas claras (Japón, Mónaco, Singapur) sobre el fondo oscuro. */
  box-shadow: 0 0 0 1px var(--tz-border-strong);
  object-fit: cover;
}
</style>
