/**
 * Cede el hilo principal: lo que va detrás corre en otra tarea, y el navegador puede atender entre medias un clic, una
 * tecla o un frame. Con `scheduler.yield()` (Chromium) la continuación pasa por delante de otras tareas; sin él,
 * `setTimeout(0)`. Para partir trabajo que, junto, sería una tarea larga (perf.spec: > 50 ms con la CPU ×4).
 */
export function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler
  if (typeof scheduler?.yield === 'function') return scheduler.yield()
  return new Promise((resolve) => setTimeout(resolve, 0))
}
