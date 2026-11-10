import { Canvas, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute } from 'three'

import { type PolyhedronFrames, buildFrames } from '@/core/polyhedron/faces'
import { length } from '@/core/vec3'
import { MAX_LIVE_FACES } from '@/ui/constants'
import { useAppStore } from '@/ui/store'

import { Controls } from './Controls'
import { FaceMesh } from './FaceMesh'
import { LiveLines } from './LiveLines'
import { baseLinePx, texturePxPerUnit } from './texture'

/** Texture resolution for the largest face (longest side, px); smaller faces scale down. */
const TEXTURE_PX = 1024
const LINE_PX = baseLinePx(TEXTURE_PX)

function Edges({ frames }: { frames: PolyhedronFrames }) {
  const geometry = useMemo(() => {
    const v = frames.def.vertices
    const g = new BufferGeometry()
    g.setAttribute(
      'position',
      new Float32BufferAttribute(
        frames.edges.flatMap((e) => [...v[e.a]!, ...v[e.b]!]),
        3,
      ),
    )
    return g
  }, [frames])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#5b5348" />
    </lineSegments>
  )
}

/** Re-frame the camera when the shape (and so its size) changes. */
function FitCamera({ radius }: { radius: number }) {
  const camera = useThree((s) => s.camera)
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    camera.position.setLength(radius * 4.2)
    camera.lookAt(0, 0, 0)
    invalidate()
  }, [camera, radius, invalidate])
  return null
}

function Solid() {
  const polyhedron = useAppStore((s) => s.polyhedron)
  const artwork = useAppStore((s) => s.artwork)
  const styles = useAppStore((s) => s.layerStyles)
  // Textures are stale while dragging, or until the worker catches up with the rotation.
  // (A boolean selector, so this component doesn't re-render on every pointer move.)
  const texturesStale = useAppStore(
    (s) =>
      s.dragging || s.artwork?.rotation !== s.rotation || s.artwork.shapeId !== s.polyhedron.id,
  )
  const selected = useAppStore((s) => s.selectedFace)
  const showNumbers = useAppStore((s) => s.showFaceNumbers)
  const selectFace = useAppStore((s) => s.selectFace)
  const enlargeFace = useAppStore((s) => s.enlargeFace)

  const frames = useMemo(() => buildFrames(polyhedron.def), [polyhedron])
  const radius = useMemo(() => Math.max(...polyhedron.def.vertices.map(length)), [polyhedron])
  const pxPerUnit = useMemo(() => texturePxPerUnit(frames.faces, TEXTURE_PX), [frames])
  // Ignore artwork computed for a different shape (e.g. just after switching).
  const current = artwork?.shapeId === polyhedron.id ? artwork : null
  // Shapes the GPU preview can't handle keep showing (worker-updated) textures throughout.
  const live = frames.faces.length <= MAX_LIVE_FACES && texturesStale

  return (
    <>
      <FitCamera radius={radius} />
      <Controls radius={radius} />
      {frames.faces.map((face) => (
        <FaceMesh
          key={`${polyhedron.id}:${face.index}`}
          face={face}
          packed={current?.faces[face.index]}
          mmPerUnit={current?.mmPerUnit ?? 1}
          styles={styles}
          pxPerUnit={pxPerUnit}
          linePx={LINE_PX}
          showArtwork={!live}
          selected={face.index === selected}
          showNumber={showNumbers}
          onSelect={() => selectFace(face.index)}
          onOpen={() => enlargeFace(face.index)}
        />
      ))}
      <LiveLines frames={frames} styles={styles} visible={live} />
      <Edges frames={frames} />
    </>
  )
}

/**
 * 3D preview of the assembled solid (plan §6.6). Each face is textured with its own projected
 * artwork. Geographic north (+z) is up. Renders on demand, so it idles when nothing changes.
 */
export default function GlobeView() {
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      camera={{ fov: 35, near: 0.01, far: 1000, up: [0, 0, 1], position: [3.6, 1.2, 1.6] }}
      className="touch-none"
    >
      <ambientLight intensity={2.2} />
      <directionalLight position={[4, 2, 6]} intensity={1.4} />
      <directionalLight position={[-3, -4, -2]} intensity={0.5} />
      <Solid />
    </Canvas>
  )
}
