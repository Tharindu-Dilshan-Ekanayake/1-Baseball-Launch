import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Color, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, RingGeometry, Vector3 } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { STATION_COUNT, stationAt, STATIONS } from '@shared/world'

import { isPulling, launch } from '../launch'
import { roll } from '../roll/rollControl'
import { runtime } from '../runtime'
import { takenStations } from '../stations'

/** A wide, bright ring round a batter spot and a thin one inside it. */
function createRingGeometry() {
  const outer = new RingGeometry(0.5, 0.7, 40)
  const inner = new RingGeometry(0.3, 0.36, 32)
  const merged = mergeGeometries([outer, inner], false)
  outer.dispose()
  inner.dispose()
  return merged.rotateX(-Math.PI / 2)
}

const FREE = new Color('#ffd21f')
const YOURS = new Color('#3dff6a')
const TAKEN = new Color('#ff4040')
const _m = new Matrix4()
const _q = new Quaternion()
const _p = new Vector3()
const _s = new Vector3()

/**
 * STEP UP TO BAT: a glowing ring on the ground at every batting station's batter spot,
 * always in sight, so it's clear where to stand and which are free - gold and gently
 * pulsing while free, red while another player bats there, and big, bright green and
 * pulsing under you once you're standing in it (and while you bat). One instanced mesh,
 * one draw call, a few matrices a frame. (Mounted where the template's launch reach bar
 * was, under the same name.)
 */
export function LaunchReach() {
  const ref = useRef(null)
  const mesh = useMemo(() => {
    const material = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.95, depthWrite: false })
    const m = new InstancedMesh(createRingGeometry(), material, STATION_COUNT)
    for (let i = 0; i < STATION_COUNT; i += 1) m.setColorAt(i, FREE)
    m.frustumCulled = false
    m.renderOrder = 1
    return m
  }, [])
  useEffect(
    () => () => {
      mesh.geometry.dispose()
      mesh.material.dispose()
      mesh.dispose()
    },
    [mesh],
  )

  useFrame((state) => {
    const rings = ref.current
    if (!rings) return
    const t = state.clock.elapsedTime
    const held = takenStations()
    const p = runtime.player.position
    // Yours: the station you bat at, or the one you're standing in.
    const yours = isPulling() || roll.active ? launch.station : stationAt(p.x, p.z, 1.0)
    for (const s of STATIONS) {
      const mine = s.index === yours
      const scale = mine ? 1.25 + Math.sin(t * 6) * 0.07 : 1 + Math.sin(t * 3 + s.index) * 0.04
      rings.setColorAt(s.index, mine ? YOURS : held[s.index] ? TAKEN : FREE)
      rings.setMatrixAt(s.index, _m.compose(_p.set(s.spotX, 0.09, s.spotZ), _q, _s.setScalar(scale)))
    }
    rings.instanceMatrix.needsUpdate = true
    rings.instanceColor.needsUpdate = true
  })

  return <primitive ref={ref} object={mesh} />
}

export default LaunchReach
