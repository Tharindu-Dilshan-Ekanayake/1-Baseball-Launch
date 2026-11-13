import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Matrix4, Vector3 } from 'three'

import { SWING_WINDOW } from '@shared/balance'
import { STATIONS } from '@shared/world'

import { getGame } from '../store/game'
import { createBallMesh, disposeBallMesh } from './balls'
import { isPulling, launch, TOSS_APEX, TOSS_FALL_MS, TOSS_RISE_MS } from './launch'
import { SWING_CONTACT } from './playerPose'
import { BALL_RADIUS, CONTACT, contactX } from './roll/path'
import { roll } from './roll/rollControl'

/** After the ball's gone by unswung, how long it lies at your feet before it's gone (ms). */
const LINGER_MS = 900

const _m = new Matrix4()
const _s = new Vector3()
const _pos = new Vector3()
const _hand = new Vector3()
const _apex = new Vector3()
const _contact = new Vector3()

/**
 * The ball you toss up at bat (launch.js): flicked up out of your front hand, high over
 * the plate, then floating down in slow motion to the bat's height over the plate - the
 * moment the swing meter peaks. Swing and connect and it's pulled onto the barrel as the
 * bat comes round (the hit itself flies from there: roll/BallFlight); miss, or let it go,
 * and it drops at your feet. It's the ball you've equipped. One instance, one draw call,
 * nothing drawn between tosses.
 */
export default function TossBall() {
  const ref = useRef(null)
  /** The toss in the air: its timing, frozen when it was thrown, and when the bat met it. */
  const flight = useRef({ toss: 0, tossAt: 0, arriveAt: 0, station: 0, hitAt: 0, active: false })
  const assets = useMemo(() => {
    const mesh = createBallMesh(1)
    mesh.count = 1
    return mesh
  }, [])
  useEffect(() => () => disposeBallMesh(assets), [assets])

  useFrame(() => {
    const ball = ref.current
    if (!ball) return
    const now = performance.now()
    const f = flight.current
    if (launch.gripping && launch.stage !== 'ready' && f.toss !== launch.toss) {
      f.toss = launch.toss
      f.tossAt = launch.tossAt
      f.arriveAt = launch.arriveAt
      f.station = launch.station
      f.hitAt = 0
      f.active = true
    }
    // Swung and connected with this toss: the ball comes round onto the bat.
    if (f.active && !f.hitAt && launch.released && launch.releasedAt >= f.tossAt) f.hitAt = launch.releasedAt
    // Gone: the hit took over, you stepped out, or it's lain there long enough.
    const t = now - f.tossAt
    const over = roll.active || (!isPulling() && !f.hitAt) || (!f.hitAt && now > f.arriveAt + SWING_WINDOW * 1000 + LINGER_MS)
    if (over) f.active = false
    ball.visible = f.active
    if (!f.active) return

    const s = STATIONS[f.station]
    _hand.set(s.spotX + 0.5, 1.25, s.spotZ - 0.3)
    _apex.set(s.spotX + 0.95, TOSS_APEX, s.spotZ - 0.42)
    _contact.set(contactX(f.station), CONTACT.y, CONTACT.z)
    if (t < TOSS_RISE_MS) {
      // Up, slowing as it tops out.
      const u = t / TOSS_RISE_MS
      _pos.lerpVectors(_hand, _apex, u)
      _pos.y = _hand.y + (_apex.y - _hand.y) * (1 - (1 - u) * (1 - u))
    } else {
      // Down in slow motion, gathering speed, to the bat's height over the plate - and on
      // past it to the ground if nobody hits it.
      const v = (t - TOSS_RISE_MS) / TOSS_FALL_MS
      _pos.lerpVectors(_apex, _contact, Math.min(1, v))
      const drop = _apex.y - _contact.y
      _pos.y = v <= 1 ? _apex.y - drop * v * v : _contact.y - 2 * drop * (v - 1)
      _pos.y = Math.max(BALL_RADIUS * 0.6, _pos.y)
    }
    if (f.hitAt) {
      // Pulled onto the barrel as the bat comes round.
      const k = Math.min(1, (now - f.hitAt) / (SWING_CONTACT * 1000))
      _pos.lerp(_contact, k * k)
    }
    ball.setBall(0, getGame().profile.equippedBall)
    _m.makeRotationX(t * 0.012).scale(_s.setScalar(BALL_RADIUS * 0.85)).setPosition(_pos)
    ball.setMatrixAt(0, _m)
    ball.instanceMatrix.needsUpdate = true
  })

  return <primitive ref={ref} object={assets} />
}
