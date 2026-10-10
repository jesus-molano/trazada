import { useLoop, useTres } from '@tresjs/core'
import { BufferAttribute, type BufferGeometry, type Material, Vector2 } from 'three'

/**
 * Anchura «de mapa» de una cinta (pista, pit lane, capas de banderas, bordes, línea de meta), calculada en
 * el shader para cada vértice: la anchura en metros de cerca (genérica, 14 m para la pista: la fuente no da
 * la de cada circuito) y, donde a esa distancia se vería más fina, la que
 * ocupa `minPx` píxeles en pantalla. Así llega al mínimo también la parte lejana del circuito (y la que se
 * ve en escorzo), sin engordar la de cerca ni reescribir la malla. Es solo visual: no mueve nada.
 *
 * La geometría lleva `position` con la anchura en metros y, por vértice, `mapCenter` (su punto del eje) y
 * `mapNormal` (unitaria, hacia fuera); la línea de meta, además, `mapAlong` (cuánto crece a lo largo).
 */
const HEADER = /* glsl */ `
attribute vec3 mapCenter;
attribute vec3 mapNormal;
#ifdef MAP_ALONG
attribute vec3 mapAlong;
#endif
uniform float mapRealHalf;
uniform float mapMinPx;
uniform vec2 mapViewport;
float mapExtraHalf() {
  mat4 m = projectionMatrix * modelViewMatrix;
  vec4 c = m * vec4(mapCenter, 1.0);
  vec4 a = m * vec4(mapCenter + mapNormal, 1.0);
  vec4 b = m * vec4(mapCenter - mapNormal, 1.0);
  if (c.w <= 0.0 || a.w <= 0.0 || b.w <= 0.0) return 0.0;
  // Píxeles por metro a lo ancho de la cinta en este punto (simétrico: el mismo a los dos lados).
  float px = 0.25 * length((a.xy / a.w - b.xy / b.w) * mapViewport);
  // Vista casi de canto: como mucho, lo que daría un 30 % de la anchura de frente (sin cintas gigantes).
  px = max(px, 0.3 * 0.5 * mapViewport.y * projectionMatrix[1][1] / c.w);
  return max(0.0, 0.5 * mapMinPx / px - mapRealHalf);
}
`
const BODY = /* glsl */ `
float mapExtra = mapExtraHalf();
transformed += mapNormal * mapExtra;
#ifdef MAP_ALONG
transformed += mapAlong * mapExtra;
#endif
`

/** Atributos de anchura de mapa de una geometría (ver arriba). */
export function setMapAttributes(g: BufferGeometry, center: Float32Array, normal: Float32Array, along?: Float32Array): void {
  g.setAttribute('mapCenter', new BufferAttribute(center, 3))
  g.setAttribute('mapNormal', new BufferAttribute(normal, 3))
  if (along) g.setAttribute('mapAlong', new BufferAttribute(along, 3))
}

/**
 * Va dentro de TresCanvas. Devuelve `mapWidth(material, realHalf, minPx)`, que prepara el material
 * (MeshBasicMaterial o LineBasicMaterial) para dibujar con anchura de mapa.
 */
export function useMapWidth() {
  const { sizes } = useTres()
  const { onBeforeRender } = useLoop()
  const viewport = { value: new Vector2(1, 1) }
  onBeforeRender(() => viewport.value.set(Math.max(1, sizes.width.value), Math.max(1, sizes.height.value)))

  return function mapWidth<M extends Material>(material: M, realHalf: number, minPx: number, along = false): M {
    if (along) material.defines = { ...material.defines, MAP_ALONG: '' }
    material.onBeforeCompile = (shader) => {
      shader.uniforms.mapRealHalf = { value: realHalf }
      shader.uniforms.mapMinPx = { value: minPx }
      shader.uniforms.mapViewport = viewport
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${HEADER}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${BODY}`)
    }
    // Mismo código para todas: comparten programa; los uniforms son de cada material.
    material.customProgramCacheKey = () => 'tz-map-width'
    return material
  }
}
