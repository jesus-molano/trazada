import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeTrzb, decompress, LAYOUTS, type LayoutName, TrzbError } from '../src'

const golden = (name: string) => new URL(`./golden/${name}`, import.meta.url)

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

describe('ficheros dorados TRZB generados por el codificador Python', () => {
  for (const name of Object.keys(LAYOUTS) as LayoutName[]) {
    it(`${name}: decodifica exactamente los valores esperados`, async () => {
      const raw = await decompress(toArrayBuffer(readFileSync(golden(`${name}.trzb.gz`))))
      const expected = JSON.parse(readFileSync(golden(`${name}.expected.json`), 'utf8')) as {
        meta: Record<string, unknown>
        tables: Record<string, Record<string, number[]>>
      }
      const decoded = decodeTrzb(raw, LAYOUTS[name])
      expect(decoded.header.layout).toBe(name)
      expect(decoded.header.meta).toEqual(expected.meta)
      for (const [tname, cols] of Object.entries(expected.tables)) {
        const table = decoded.tables[tname]!
        for (const [cname, values] of Object.entries(cols)) {
          const got = Array.from(table.columns[cname]!)
          const spec = LAYOUTS[name].tables[tname]!.columns[cname]!
          // Las columnas que se leen como f32 se comparan con el valor redondeado a f32 (exacto).
          const f32 = spec.decode === 'f32' || (spec.type === 'f32' && !spec.decode)
          expect(got.length, `${tname}.${cname}`).toBe(values.length)
          got.forEach((v, i) =>
            f32
              ? expect(v, `${tname}.${cname}[${i}]`).toBe(Math.fround(values[i]!))
              : expect(v, `${tname}.${cname}[${i}]`).toBeCloseTo(values[i]!, 9),
          )
        }
      }
    })
  }

  it('las columnas raw son vistas sin copia sobre el buffer', async () => {
    const raw = await decompress(toArrayBuffer(readFileSync(golden('car.trzb.gz'))))
    const decoded = decodeTrzb(raw, LAYOUTS.car)
    expect(decoded.tables.tel!.columns.gear!.buffer).toBe(raw)
    expect(decoded.tables.tel!.columns.t).toBeInstanceOf(Float64Array)
  })

  it('rechaza un layout distinto del esperado', async () => {
    const raw = await decompress(toArrayBuffer(readFileSync(golden('car.trzb.gz'))))
    expect(() => decodeTrzb(raw, LAYOUTS.motion)).toThrow(TrzbError)
  })

  it('rechaza ficheros que no son TRZB o están truncados', () => {
    expect(() => decodeTrzb(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).buffer)).toThrow(/magic/)
    expect(() => decodeTrzb(new ArrayBuffer(4))).toThrow(/corto/)
  })
})
