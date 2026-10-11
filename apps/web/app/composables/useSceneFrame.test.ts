import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createSceneFrames, type SceneFrame, type SceneFrameHost } from './useSceneFrame'

/** Un lienzo de mentira con el modo on-demand de TresJS: `frames` > 0 es un render pendiente. */
function fakeCanvas() {
  let frames = 1
  const hooks = new Set<(c: { delta: number }) => void>()
  const host: SceneFrameHost = {
    camera: { activeCamera: { value: undefined } },
    renderer: {
      canBeInvalidated: {
        get value() {
          return frames === 0
        },
      },
      loop: {
        onBeforeLoop(fn) {
          hooks.add(fn)
          return { off: () => void hooks.delete(fn) }
        },
      },
    },
  }
  return {
    host,
    hooks,
    invalidate: () => {
      if (frames === 0) frames = 1
    },
    /** Un tick del bucle: los ganchos y, si hay frame pendiente, el render. */
    tick(delta = 1 / 60): boolean {
      for (const fn of hooks) fn({ delta })
      if (frames === 0) return false
      frames--
      return true
    },
  }
}

describe('useSceneFrame: preparación de la escena solo antes de cada render', () => {
  it('sin render pendiente (pausa, escena tapada) no llama a nada; con uno, a todo, en orden de registro', () => {
    const canvas = fakeCanvas()
    const frames = createSceneFrames()
    const calls: string[] = []
    frames.add(() => calls.push('pista'))
    frames.add(() => calls.push('estelas'))
    frames.attach(canvas.host)

    expect(canvas.tick()).toBe(true) // el primer frame del modo on-demand
    expect(calls).toEqual(['pista', 'estelas'])
    for (let i = 0; i < 120; i++) expect(canvas.tick()).toBe(false)
    expect(calls).toHaveLength(2)
    expect(frames.stats).toEqual({ ticks: 121, prepared: 1 })

    canvas.invalidate() // un seek, la cámara…
    expect(canvas.tick()).toBe(true)
    expect(calls).toEqual(['pista', 'estelas', 'pista', 'estelas'])
  })

  it('los de cada tick van antes y, si piden un frame, los demás se preparan para él en el mismo tick', () => {
    const canvas = fakeCanvas()
    const frames = createSceneFrames()
    const calls: string[] = []
    let animating = false
    frames.add(() => calls.push('coches'))
    frames.add(
      (f: SceneFrame) => {
        calls.push(`cámara:${f.pending ? 'pendiente' : 'libre'}`)
        if (animating) canvas.invalidate()
      },
      { everyTick: true },
    )
    frames.attach(canvas.host)

    canvas.tick()
    expect(calls).toEqual(['cámara:pendiente', 'coches'])
    calls.length = 0
    canvas.tick()
    expect(calls).toEqual(['cámara:libre'])
    calls.length = 0
    animating = true
    expect(canvas.tick()).toBe(true)
    expect(calls).toEqual(['cámara:libre', 'coches'])
  })

  it('la baja de un registro y la del lienzo: nada vuelve a llamarse', () => {
    const canvas = fakeCanvas()
    const frames = createSceneFrames()
    let n = 0
    const off = frames.add(() => n++)
    const detach = frames.attach(canvas.host)
    canvas.tick()
    expect(n).toBe(1)
    off()
    canvas.invalidate()
    canvas.tick()
    expect(n).toBe(1)
    frames.add(() => n++)
    detach()
    expect(canvas.hooks.size).toBe(0)
    canvas.invalidate()
    canvas.tick()
    expect(n).toBe(1)
  })
})

describe('contrato: la escena no se engancha al bucle de TresJS por su cuenta', () => {
  const APP = join(dirname(fileURLToPath(import.meta.url)), '..')
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) return files(p)
      return /\.(vue|ts)$/.test(name) && !name.endsWith('.test.ts') ? [p] : []
    })

  it('nadie usa useLoop ni onBeforeLoop: todo pasa por useSceneFrame (un gancho por tick y solo con render)', () => {
    const offenders = files(APP).filter((p) => {
      if (relative(APP, p) === join('composables', 'useSceneFrame.ts')) return false
      const src = readFileSync(p, 'utf8')
      return /import\s*\{[^}]*\buseLoop\b[^}]*\}\s*from\s*'@tresjs\/core'/.test(src) || /\.onBeforeLoop\(/.test(src)
    })
    expect(offenders.map((p) => relative(APP, p))).toEqual([])
  })
})
