import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'

import { rotationBetween } from '@/core/geo/rotation'
import { type Quat, conjugate, multiply, normalizeQuat, rotate } from '@/core/quat'
import type { Vec3 } from '@/core/vec3'
import { useAppStore } from '@/ui/store'

/** Pointer position on a virtual trackball (Shoemake arcball), in view space. */
function toSphere(el: HTMLElement, e: PointerEvent): Vec3 {
  const r = el.getBoundingClientRect()
  const radius = Math.min(r.width, r.height) / 2
  const x = (e.clientX - r.left - r.width / 2) / radius
  const y = -(e.clientY - r.top - r.height / 2) / radius
  const d2 = x * x + y * y
  if (d2 <= 1) return [x, y, Math.sqrt(1 - d2)]
  const d = Math.sqrt(d2)
  return [x / d, y / d, 0]
}

/**
 * Mouse controls (plan §6.6):
 * - left-drag: rotate the globe under the solid (arcball), stored as a quaternion
 * - right-drag or Alt+left-drag: orbit the camera
 * - wheel: zoom
 */
export function Controls({ radius }: { radius: number }) {
  const camera = useThree((s) => s.camera)
  const el = useThree((s) => s.gl.domElement)
  const invalidate = useThree((s) => s.invalidate)

  useEffect(() => {
    let mode: 'globe' | 'camera' | null = null
    let last: Vec3 = [0, 0, 1]

    /** A view-space rotation expressed in world space. */
    const toWorld = (dq: Quat): Quat => {
      const c: Quat = [
        camera.quaternion.x,
        camera.quaternion.y,
        camera.quaternion.z,
        camera.quaternion.w,
      ]
      return multiply(multiply(c, dq), conjugate(c))
    }

    const down = (e: PointerEvent) => {
      if (e.button === 0 && !e.altKey) mode = 'globe'
      else if (e.button === 2 || (e.button === 0 && e.altKey)) mode = 'camera'
      else return
      el.setPointerCapture(e.pointerId)
      last = toSphere(el, e)
      if (mode === 'globe') useAppStore.getState().setDragging(true)
    }

    const move = (e: PointerEvent) => {
      if (!mode) return
      const cur = toSphere(el, e)
      const dq = toWorld(rotationBetween(last, cur))
      last = cur
      if (mode === 'globe') {
        const { rotation, setRotation } = useAppStore.getState()
        setRotation(normalizeQuat(multiply(dq, rotation)))
      } else {
        // Orbiting the camera the opposite way makes the solid appear to follow the pointer.
        const inv = conjugate(dq)
        const p = rotate(inv, [camera.position.x, camera.position.y, camera.position.z])
        const u = rotate(inv, [camera.up.x, camera.up.y, camera.up.z])
        camera.position.set(...p)
        camera.up.set(...u)
        camera.lookAt(0, 0, 0)
        invalidate()
      }
    }

    const up = (e: PointerEvent) => {
      if (!mode) return
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      if (mode === 'globe') useAppStore.getState().setDragging(false)
      mode = null
    }

    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const d = camera.position.length() * Math.exp(e.deltaY * 0.001)
      camera.position.setLength(Math.min(radius * 12, Math.max(radius * 1.6, d)))
      invalidate()
    }

    const noMenu = (e: Event) => e.preventDefault()

    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('contextmenu', noMenu)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('contextmenu', noMenu)
    }
  }, [camera, el, invalidate, radius])

  return null
}
