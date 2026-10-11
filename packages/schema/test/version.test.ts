import { describe, expect, it } from 'vitest'
import { SCHEMA_MAJOR, SCHEMA_VERSION } from '../src/index'

describe('versión de esquema', () => {
  it('el major coincide con SCHEMA_VERSION', () => {
    expect(Number(SCHEMA_VERSION.split('.')[0])).toBe(SCHEMA_MAJOR)
  })
})
