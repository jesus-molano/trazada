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
      <NuxtLink to="/" class="tz-brand">{{ t('app.name') }}</NuxtLink>
      <button
        type="button"
        class="tz-lang"
        :aria-label="t('app.switchLanguage')"
        data-testid="lang-toggle"
        @click="toggleLocale"
      >
        {{ t('app.otherLocaleShort') }}
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

.tz-brand {
  font-weight: var(--tz-weight-bold);
  font-size: var(--tz-text-lg);
  letter-spacing: 0.04em;
  color: var(--tz-text);
}

.tz-brand:hover {
  text-decoration: none;
  color: var(--tz-accent-strong);
}

.tz-lang {
  padding: var(--tz-space-1) var(--tz-space-3);
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-pill);
  background: transparent;
  font-size: var(--tz-text-xs);
  font-weight: var(--tz-weight-semibold);
  cursor: pointer;
  transition: border-color var(--tz-dur-fast) var(--tz-ease-standard);
}

.tz-lang:hover {
  border-color: var(--tz-accent);
}

.tz-main {
  position: relative;
  min-height: 0;
}
</style>
