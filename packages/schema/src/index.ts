import version from '../version.json'

/** Versión del contrato de datos (semver). El major forma parte de la ruta de datos: /v1/. */
export const SCHEMA_VERSION: string = version.schemaVersion
export const SCHEMA_MAJOR: number = Number(version.schemaVersion.split('.')[0])
/** Versión mínima de lector que exigen los datos que generamos. */
export const MIN_READER: string = version.minReader
/** Versión del enmarcado binario TRZB. */
export const CONTAINER_VERSION: number = version.containerVersion

export * from './trzb'
export * from './layouts'
export * from './manifest'
export * from './catalog'
export * from './events'
export * from './semver'
