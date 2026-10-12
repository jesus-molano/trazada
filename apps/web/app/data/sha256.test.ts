import { describe, expect, it } from 'vitest'
import { sha256 } from './sha256'

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const text = (s: string) => new TextEncoder().encode(s)

describe('SHA-256 en TS (sin crypto.subtle: la app por http://192.168.x.x)', () => {
  it('los vectores de FIPS 180-4', () => {
    expect(hex(sha256(text('')))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(hex(sha256(text('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(hex(sha256(text('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
  })

  it('igual que crypto.subtle en los bordes de bloque y en datos grandes, también en una vista con desplazamiento', async () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 1000, 1 << 20]) {
      const big = new Uint8Array(n + 3)
      for (let i = 0; i < big.length; i++) big[i] = (i * 31 + 7) & 0xff
      const bytes = big.subarray(3)
      const ref = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice()))
      expect(hex(sha256(bytes)), `${n} bytes`).toBe(hex(ref))
    }
  })
})
