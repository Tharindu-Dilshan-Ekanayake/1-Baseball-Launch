import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Matrix4, Quaternion, Vector3 } from 'three'

import { ROLL_RECOVERY } from '@shared/balance'

import { createBallMesh, disposeBallMesh } from '../balls'
import { runtime } from '../runtime'
import { BALL_RADIUS, createRideState, laneFor, rideState } from './path'
import { advanceRoll, roll } from './rollControl'

/** Your ball and up to eight other players'. */
const MAX_BALLS = 9

const _m = new Matrix4()
const _r = new Matrix4()
const _q = new Quaternion()
const _p = new Vector3()
const _axis = new Vector3(1, 0, 0)
const _zero = new Matrix4().makeScale(0, 0, 0)

/**
 * Writes one ball's matrix: at the ride state's position, spun about its sideways axis as
 * it goes (backspin up the field), squashed flat for a moment each time it lands and
 * squeezed against the bat as it's hit.
 */
function placeBall(mesh, i, st, sinceBounce) {
  _q.setFromAxisAngle(_axis, -st.spin)
  _r.makeRotationFromQuaternion(_q)
  let squashY = 1
  if (st.phase === 'launch') squashY = 0.72 + 0.28 * st.launch
  else if (sinceBounce < 0.12) squashY = 0.7 + 0.3 * (sinceBounce / 0.12)
  const wide = 1 / Math.sqrt(squashY)
  const r = st.size || BALL_RADIUS
  _m.makeScale(r * wide, r * squashY, r * wide).multiply(_r)
  _m.setPosition(_p.copy(st.position))
  mesh.setMatrixAt(i, _m)
}

/**
 * Every ball in flight, in one draw call (balls.js): yours (the hit playing in
 * rollControl) and other players', replayed from their hits' numbers down their own lines
 * of the field (runtime.ghostRolls). Each painted as the ball it is. Nothing drawn while
 * no ball is out. Your ball casts a blob shadow on presets without realtime ones.
 */
export default function BallFlight() {
  const meshRef = useRef(null)
  /** Ride states for other players' balls, by session id, and when each last bounced. */
  const ghosts = useRef(new Map())
  /** Spare ride states, made up front: a new player's hit never allocates mid-frame. */
  const spare = useRef(Array.from({ length: MAX_BALLS }, () => ({ ride: createRideState(), bounces: 0, at: 0 })))
  const mine = useRef({ bounces: 0, at: 0 })
  const assets = useMemo(() => createBallMesh(MAX_BALLS), [])
  const shadowRef = useRef(null)

  useEffect(() => {
    const shadow = { position: new Vector3(), size: 0.7, visible: false }
    shadowRef.current = shadow
    runtime.shadowCasters.add(shadow)
    return () => {
      runtime.shadowCasters.delete(shadow)
      disposeBallMesh(assets)
    }
  }, [assets])

  useFrame((state) => {
    const mesh = meshRef.current
    if (!mesh) return
    const now = performance.now()
    const shadow = shadowRef.current
    let count = 0

    if (roll.active) {
      advanceRoll(state.clock.elapsedTime)
      const m = mine.current
      if (roll.bounces !== m.bounces) {
        m.bounces = roll.bounces
        m.at = now
      }
      mesh.setBall(0, roll.ballId)
      placeBall(mesh, 0, roll, (now - m.at) / 1000)
      count = 1
      if (shadow) {
        shadow.visible = true
        shadow.position.set(roll.position.x, 0, roll.position.z)
        shadow.size = 0.5 + Math.min(0.6, roll.air * 0.02)
      }
    } else if (shadow) {
      shadow.visible = false
    }

    for (const [sid, ghost] of runtime.ghostRolls) {
      const elapsed = (now - ghost.startedAt) / 1000
      if (elapsed > ghost.duration + ROLL_RECOVERY + 1) continue
      let st = ghosts.current.get(sid)
      if (!st) {
        st = spare.current.pop()
        if (!st) continue
        st.bounces = 0
        st.at = 0
        ghosts.current.set(sid, st)
      }
      rideState(elapsed, ghost, Number.isFinite(ghost.lane) ? ghost.lane : laneFor(sid), st.ride)
      if (st.ride.bounces !== st.bounces) {
        st.bounces = st.ride.bounces
        st.at = now
      }
      if (count >= MAX_BALLS) break
      mesh.setBall(count, ghost.ballId || 'baseball')
      placeBall(mesh, count, st.ride, (now - st.at) / 1000)
      count += 1
    }
    // Forget the ones that are over (their states back to the spares).
    for (const [sid, st] of ghosts.current) {
      if (runtime.ghostRolls.has(sid)) continue
      ghosts.current.delete(sid)
      spare.current.push(st)
    }

    for (let i = count; i < mesh.count; i += 1) mesh.setMatrixAt(i, _zero)
    mesh.count = count
    mesh.visible = count > 0
    if (count > 0) mesh.instanceMatrix.needsUpdate = true
  })

  return <primitive ref={meshRef} object={assets} />
}
