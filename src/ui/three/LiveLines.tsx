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

import type { LayerId, LayerStyle, LineLayerId } from '@/core/layers'
import type { PolyhedronFrames } from '@/core/polyhedron/faces'
import type { Quat } from '@/core/quat'
import type { Resolution } from '@/core/settings'
import { MAX_LIVE_FACES } from '@/ui/constants'
import { projector } from '@/ui/projector-client'
import { useAppStore } from '@/ui/store'
import type { LineSegments3D } from '@/worker/projector'

const LINE_LAYERS: readonly LineLayerId[] = ['coastlines', 'borders']

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

/** Fetch (once per resolution) the unit-vector segments from the worker. */
const segmentCache = new Map<Resolution, Promise<LineSegments3D>>()
function useSegments(resolution: Resolution): LineSegments3D | null {
  const [loaded, setLoaded] = useState<{ resolution: Resolution; data: LineSegments3D } | null>(
    null,
  )
  useEffect(() => {
    let cancelled = false
    let p = segmentCache.get(resolution)
    if (!p) {
      p = projector().lineSegments(resolution)
      p.catch(() => segmentCache.delete(resolution))
      segmentCache.set(resolution, p)
    }
    p.then((data) => !cancelled && setLoaded({ resolution, data })).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [resolution])
  return loaded?.resolution === resolution ? loaded.data : null
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
  const resolution = useAppStore((s) => s.resolution)
  const segments = useSegments(resolution)

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
    return LINE_LAYERS.flatMap((id) => {
      const positions = segments.layers[id]
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
    for (const l of layers) (l.material.uniforms.uColor!.value as Color).set(styles[l.id].color)
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
          visible={visible && styles[l.id].enabled}
          frustumCulled={false}
        />
      ))}
    </>
  )
}
