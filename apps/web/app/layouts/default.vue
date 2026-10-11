<script setup lang="ts">
const { t, locale, setLocale } = useI18n()

useHead(() => ({ htmlAttrs: { lang: locale.value } }))

async function toggleLocale() {
  await setLocale(locale.value === 'es' ? 'en' : 'es')
}
</script>

<template>
  <div class="tz-shell">
    <header class="tz-header">
      <NuxtLink to="/" class="tz-brand" data-testid="brand">{{ t('app.name') }}</NuxtLink>
      <!-- El icono acompaña al código del otro idioma («EN»); el nombre accesible es la acción completa. -->
      <button
        type="button"
        class="tz-lang"
        :aria-label="t('app.switchLanguage')"
        data-testid="lang-toggle"
        @click="toggleLocale"
      >
        <TzIcon name="language" size="sm" />
        <span>{{ t('app.otherLocaleShort') }}</span>
      </button>
    </header>
    <main class="tz-main">
      <slot />
    </main>
    <TzFooter />
  </div>
</template>

<style scoped>
.tz-shell {
  display: grid;
  grid-template-rows: auto 1fr auto;
  min-height: 100vh;
  /* Safari de iPad: con sus barras a la vista, 100vh es más alto que la ventana (D44). 100vh queda de respaldo. */
  min-height: 100dvh;
}

.tz-header {
  position: relative;
  z-index: var(--tz-z-header);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--tz-space-3) var(--tz-space-6);
  border-bottom: 1px solid var(--tz-border);
  background: var(--tz-surface-1);
}

/*
 * Piano bajo la marca (D47): diez bloques rojo/blanco sobre el borde de la cabecera. Decorativo (sin texto ni
 * eventos) y en uno de sus dos únicos sitios; lo vigila tokens.test.ts. Con colores forzados desaparece, y no pasa
 * nada: no dice nada que no diga la marca.
 */
.tz-header::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: var(--tz-space-6);
  width: calc(10 * var(--tz-kerb-block));
  height: 3px;
  background: var(--tz-kerb);
  pointer-events: none;
}

/* Marca: rótulo condensado en mayúsculas, como la rotulación pintada de un muro de boxes. */
.tz-brand {
  font-family: var(--tz-font-display);
  font-size: var(--tz-text-lg);
  font-weight: var(--tz-weight-bold);
  letter-spacing: var(--tz-tracking-display);
  text-transform: uppercase;
  color: var(--tz-text);
  transition: color var(--tz-dur-fast) var(--tz-ease-standard);
}

/* Cambio de idioma: placa de contorno; con puntero grueso, la zona táctil crece sin mover la cabecera. */
.tz-lang {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-1);
  padding: var(--tz-space-1) var(--tz-space-3);
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-pill);
  background: transparent;
  font-family: var(--tz-font-display);
  /* xs: con el icono, la cabecera conserva su alto (la escena del replay no pierde ni un píxel). */
  font-size: var(--tz-text-xs);
  font-weight: var(--tz-weight-semibold);
  letter-spacing: var(--tz-tracking-caps);
  cursor: pointer;
  transition:
    background-color var(--tz-dur-fast) var(--tz-ease-standard),
    border-color var(--tz-dur-fast) var(--tz-ease-standard),
    transform var(--tz-dur-fast) var(--tz-ease-standard);
}

.tz-lang::after {
  content: '';
  position: absolute;
  inset: min(0px, calc((100% - var(--tz-hit-min)) / 2));
}

.tz-lang:active {
  transform: scale(var(--tz-press-scale));
}

/* Hover solo con un puntero que puede «flotar»: en táctil se quedaría pegado tras tocar. */
@media (hover: hover) {
  .tz-brand:hover {
    text-decoration: none;
    color: var(--tz-accent-strong);
  }

  .tz-lang:hover {
    border-color: var(--tz-accent);
    background: var(--tz-accent-soft);
  }
}

.tz-main {
  position: relative;
  min-height: 0;
}
</style>
