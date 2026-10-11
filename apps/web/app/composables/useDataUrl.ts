/** URL absoluta de un recurso de datos versionado: `${dataBaseUrl}/v1/${path}` (solo en el cliente). */
export function useDataUrl(): (path: string) => string {
  const base = useRuntimeConfig().public.dataBaseUrl as string
  return (path: string) => new URL(`${base.replace(/\/$/, '')}/v1/${path}`, window.location.href).href
}
