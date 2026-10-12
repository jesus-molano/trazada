<script setup lang="ts">
/**
 * Acciones de una sesión ya descargada, junto a su fila (que entera es el enlace al replay): volver a descargarla (con
 * el pipeline de ahora: trae lo que una versión anterior no traía, como la radio) y borrarla, con confirmación en el
 * sitio («¿Borrar Libres 1? Sí / No»). Solo con el gestor de datos (D26), que solo atiende a este PC.
 */
import type { SessionType } from '@trazada/schema'
import { useCatalogStore } from '~/stores/catalog'
import { useManagerStore } from '~/stores/manager'

const props = defineProps<{
  season: number
  round: number
  session: SessionType
  /** Prefijo de los `data-testid` (las mismas acciones en otro sitio de la portada). */
  scope?: string
}>()
const tid = (id: string) => (props.scope ? `${props.scope}-${id}` : id)
const { t } = useI18n()
const manager = useManagerStore()
const catalog = useCatalogStore()
const name = computed(() => t(`session.${props.session}`))
const confirming = ref(false)
const busy = ref(false)
const yes = ref<HTMLButtonElement | null>(null)
const del = ref<HTMLButtonElement | null>(null)

function redownload() {
  void manager.enqueue([{ season: props.season, round: props.round, session: props.session }])
}

async function ask() {
  confirming.value = true
  await nextTick()
  yes.value?.focus()
}

async function cancel() {
  confirming.value = false
  await nextTick()
  del.value?.focus()
}

async function remove() {
  busy.value = true
  const ok = await manager.removeSession({ season: props.season, round: props.round, session: props.session })
  busy.value = false
  confirming.value = false
  if (ok) await catalog.load(true)
}
</script>

<template>
  <span class="tz-session-actions" :data-testid="tid(`session-actions-${session}`)">
    <template v-if="!confirming">
      <button
        type="button"
        class="tz-iconbtn"
        :aria-label="t('manager.redownloadSession', { session: name })"
        :title="t('manager.redownloadHint')"
        :data-testid="tid(`redownload-${session}`)"
        @click="redownload"
      >
        <TzIcon name="retry" size="sm" />
      </button>
      <button
        ref="del"
        type="button"
        class="tz-iconbtn"
        :aria-label="t('manager.deleteSession', { session: name })"
        :title="t('manager.deleteSession', { session: name })"
        :data-testid="tid(`delete-${session}`)"
        @click="ask"
      >
        <TzIcon name="delete" size="sm" />
      </button>
    </template>
    <span v-else class="tz-session-actions__confirm" role="group" :aria-label="t('manager.deleteConfirm', { session: name })">
      <span class="tz-session-actions__question">{{ t('manager.deleteConfirm', { session: name }) }}</span>
      <button
        ref="yes"
        type="button"
        class="tz-button tz-session-actions__yes"
        :disabled="busy"
        :data-testid="tid(`delete-yes-${session}`)"
        @click="remove"
      >
        {{ t('manager.deleteYes') }}
      </button>
      <button type="button" class="tz-button tz-button--quiet" :data-testid="tid(`delete-no-${session}`)" @click="cancel">
        {{ t('manager.deleteNo') }}
      </button>
    </span>
  </span>
</template>

<style scoped>
.tz-session-actions {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--tz-space-1);
}

.tz-session-actions__confirm {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tz-space-2);
  font-size: var(--tz-text-xs);
}

.tz-session-actions__question {
  color: var(--tz-text);
}

/* Borrar es la acción peligrosa: su «Sí», con el tono de peligro (el texto lo dice igual). */
.tz-session-actions__yes {
  background: var(--tz-danger);
  color: var(--tz-text-inverse);
}
</style>
