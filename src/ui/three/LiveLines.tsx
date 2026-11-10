import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Matrix3,
  Matrix4,
  Quaternion,
  ShaderMaterial,
  Vector4,
} from 'three'

import type { LayerId, LayerStyle, LineSourceId } from '@/core/layers'
import type { PolyhedronFrames } from '@/core/polyhedron/faces'
import type { Quat } from '@/core/quat'
import type { Resolution } from '@/core/settings'
import { MAX_LIVE_FACES } from '@/ui/constants'
import { projector } from '@/ui/projector-client'
import { useAppStore } from '@/ui/store'
import type { LineSegments3D } from '@/worker/projector'

const SOURCES: readonly LineSourceId[] = [
  'graticule',
  'rivers',
  'lakeShores',
  'borders',
  'coastlines',
]

/**
 * Which style a live line source is drawn with, if any. Fills can't be drawn live, so while
 * dragging a filled layer shows its shoreline instead (in its colour) to keep the map readable.
 */
function liveStyle(
  source: LineSourceId,
  styles: Readonly<Record<LayerId, LayerStyle>>,
): LayerStyle | null {
  if (source === 'lakeShores') return styles.lakes.enabled ? styles.lakes : null
  if (styles[source].enabled) return styles[source]
  if (source === 'coastlines') {
    if (styles.land.enabled) return styles.land
    if (styles.ocean.enabled) return styles.ocean
  }
  return null
}

/**
 * Same projection as the export, done per vertex on the GPU: rotate the unit vector by the
 * globe rotation, then scale it out along its ray to the solid's surface. For a convex solid
 * the ray leaves through the face with the largest p·n / d (plan §4.4 step 3).
 */
const vertexShader = /* glsl */ `
  #define MAX_FACES ${MAX_LIVE_FACES}
  uniform mat3 uRotation;
  uniform vec4 uFaces[MAX_FACES]; // xyz = unit normal, w = 1 / plane distance
  uniform int uFaceCount;
  void main() {
    vec3 p = uRotation * position;
    float m = 0.0;
    for (int i = 0; i < MAX_FACES; i++) {
      if (i >= uFaceCount) break;
      m = max(m, dot(p, uFaces[i].xyz) * uFaces[i].w);
    }
    // Lift a hair off the faces so lines win the depth test.
    vec3 s = p * (1.0005 / m);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(s, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  void main() {
    gl_FragColor = vec4(uColor, 1.0);
  }
`

/** Uniforms shared by every layer's material; owns its own mutation. */
class SharedUniforms {
  readonly uRotation = { value: new Matrix3() }
  readonly uFaces = { value: Array.from({ length: MAX_LIVE_FACES }, () => new Vector4()) }
  readonly uFaceCount = { value: 0 }

  setFaces(frames: PolyhedronFrames): void {
    frames.faces.slice(0, MAX_LIVE_FACES).forEach((f, i) => {
      this.uFaces.value[i]!.set(f.normal[0], f.normal[1], f.normal[2], 1 / f.distance)
    })
    this.uFaceCount.value = Math.min(frames.faces.length, MAX_LIVE_FACES)
  }

  setRotation(q: Quat): void {
    this.uRotation.value.setFromMatrix4(
      new Matrix4().makeRotationFromQuaternion(new Quaternion(...q)),
    )
  }

  forMaterial() {
    return { uRotation: this.uRotation, uFaces: this.uFaces, uFaceCount: this.uFaceCount }
  }
}

/** Fetch (once per resolution + graticule interval) the unit-vector segments from the worker. */
const segmentCache = new Map<string, Promise<LineSegments3D>>()
function useSegments(resolution: Resolution, graticuleDeg: number): LineSegments3D | null {
  const key = `${resolution}:${graticuleDeg}`
  const [loaded, setLoaded] = useState<{ key: string; data: LineSegments3D } | null>(null)
  useEffect(() => {
    let cancelled = false
    let p = segmentCache.get(key)
    if (!p) {
      p = projector().lineSegments(resolution, graticuleDeg)
      p.catch(() => segmentCache.delete(key))
      segmentCache.set(key, p)
    }
    p.then((data) => !cancelled && setLoaded({ key, data })).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [key, resolution, graticuleDeg])
  return loaded?.key === key ? loaded.data : null
}

/**
 * Map linework drawn directly on the GPU, for instant feedback while dragging the globe.
 * Rotation updates only touch a uniform; no re-projection, texture redraw or React render.
 */
export function LiveLines({
  frames,
  styles,
  visible,
}: {
  frames: PolyhedronFrames
  styles: Readonly<Record<LayerId, LayerStyle>>
  visible: boolean
}) {
  const invalidate = useThree((s) => s.invalidate)
  // 1:10m is far too heavy for a drag preview; 1:50m is visually identical at that point.
  const resolution = useAppStore((s) => (s.resolution === '10m' ? '50m' : s.resolution))
  const graticuleDeg = useAppStore((s) => s.graticuleIntervalDeg)
  const segments = useSegments(resolution, graticuleDeg)

  const [shared] = useState(() => new SharedUniforms())

  // Face planes.
  useEffect(() => {
    shared.setFaces(frames)
    invalidate()
  }, [frames, shared, invalidate])

  // Globe rotation, straight from the store (no React re-render per pointer move).
  useEffect(() => {
    const apply = (q: Quat) => {
      shared.setRotation(q)
      invalidate()
    }
    apply(useAppStore.getState().rotation)
    return useAppStore.subscribe((s, prev) => {
      if (s.rotation !== prev.rotation) apply(s.rotation)
    })
  }, [shared, invalidate])

  const layers = useMemo(() => {
    if (!segments) return []
    return SOURCES.flatMap((id) => {
      const positions = segments.lines[id]
      if (!positions) return []
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
      const material = new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: { ...shared.forMaterial(), uColor: { value: new Color() } },
      })
      return [{ id, geometry, material }]
    })
  }, [segments, shared])

  useEffect(
    () => () => {
      for (const l of layers) {
        l.geometry.dispose()
        l.material.dispose()
      }
    },
    [layers],
  )

  // Layer colours.
  useEffect(() => {
    for (const l of layers) {
      const style = liveStyle(l.id, styles)
      if (style) (l.material.uniforms.uColor!.value as Color).set(style.color)
    }
    invalidate()
  }, [layers, styles, invalidate])

  if (frames.faces.length > MAX_LIVE_FACES) return null
  return (
    <>
      {layers.map((l) => (
        <lineSegments
          key={l.id}
          geometry={l.geometry}
          material={l.material}
          visible={visible && liveStyle(l.id, styles) !== null}
          frustumCulled={false}
        />
      ))}
    </>
  )
}
