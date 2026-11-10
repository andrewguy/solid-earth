import { Html } from '@react-three/drei'
import { type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three'

import type { LayerId, LayerStyle } from '@/core/layers'
import type { FaceFrame } from '@/core/polyhedron/faces'
import type { PackedFace } from '@/worker/projector'

import { FaceCanvasTexture, PANEL_COLOR, faceUv } from './texture'

/** Planar face as a triangle fan, with UVs over the face's bounding box. */
function faceGeometry(face: FaceFrame): BufferGeometry {
  const positions = face.vertices.flatMap((v) => [...v])
  const uvs = face.vertices2D.flatMap((p) => faceUv(face, p))
  const index: number[] = []
  for (let k = 1; k + 1 < face.vertices.length; k++) index.push(0, k, k + 1)
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(positions, 3))
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  g.setIndex(index)
  g.computeVertexNormals()
  return g
}

interface FaceMeshProps {
  face: FaceFrame
  packed: PackedFace | undefined
  mmPerUnit: number
  styles: Readonly<Record<LayerId, LayerStyle>>
  /** Texture density shared by all faces of the solid (pixels per model unit). */
  pxPerUnit: number
  /** Preview line width in pixels at 1×, shared by all faces. */
  linePx: number
  /** false: plain panel (the live GPU lines are showing instead of a stale texture). */
  showArtwork: boolean
  selected: boolean
  showNumber: boolean
  onSelect: () => void
  onOpen: () => void
}

export function FaceMesh({
  face,
  packed,
  mmPerUnit,
  styles,
  pxPerUnit,
  linePx,
  showArtwork,
  selected,
  showNumber,
  onSelect,
  onOpen,
}: FaceMeshProps) {
  const invalidate = useThree((s) => s.invalidate)
  const anisotropy = useThree((s) => s.gl.capabilities.getMaxAnisotropy())
  const [faceTexture] = useState(() => new FaceCanvasTexture())
  const geometry = useMemo(() => faceGeometry(face), [face])

  useEffect(() => () => faceTexture.dispose(), [faceTexture])
  useEffect(() => () => geometry.dispose(), [geometry])

  useLayoutEffect(() => {
    faceTexture.update(face, packed, mmPerUnit, styles, pxPerUnit, linePx, anisotropy)
    invalidate()
  }, [faceTexture, face, packed, mmPerUnit, styles, pxPerUnit, linePx, anisotropy, invalidate])

  // Face-number label: hidden when the face points away from the camera.
  const label = useRef<HTMLSpanElement>(null)
  const centre = useMemo(() => {
    const c = face.vertices.reduce((a, v) => a.add(new Vector3(...v)), new Vector3())
    return c.divideScalar(face.vertices.length)
  }, [face])
  const normal = useMemo(() => new Vector3(...face.normal), [face])
  const toCamera = useMemo(() => new Vector3(), [])
  useFrame(({ camera }) => {
    if (!label.current) return
    const facing = toCamera.copy(camera.position).sub(centre).dot(normal) > 0
    label.current.style.visibility = facing ? 'visible' : 'hidden'
  })

  const click = (e: ThreeEvent<MouseEvent>) => {
    // Ignore the click that ends a drag.
    if (e.delta > 4) return
    e.stopPropagation()
    onSelect()
  }

  return (
    <mesh geometry={geometry} onClick={click} onDoubleClick={onOpen}>
      {/* Two materials rather than toggling `map`, which would force a shader rebuild. */}
      {showArtwork ? (
        <meshLambertMaterial
          key="textured"
          map={faceTexture.texture}
          color={selected ? '#bcd7ff' : '#ffffff'}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      ) : (
        <meshLambertMaterial
          key="plain"
          color={selected ? '#b4c6dd' : PANEL_COLOR}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      )}
      {showNumber && (
        <Html position={centre.clone().multiplyScalar(1.001)} center zIndexRange={[10, 0]}>
          <span
            ref={label}
            className="pointer-events-none rounded bg-background/80 px-1 font-mono text-[10px] text-foreground shadow-sm select-none"
          >
            {String(face.index).padStart(2, '0')}
          </span>
        </Html>
      )}
    </mesh>
  )
}
