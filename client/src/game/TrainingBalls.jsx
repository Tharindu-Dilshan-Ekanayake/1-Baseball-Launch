import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Matrix4, Vector3 } from 'three'

import { TRAIN_INTERVAL } from '@shared/balance'
import { COURT_BACK_X, COURT_HALF, PAD_HEIGHT, PAD_X, padCenterZ, TABLE_X } from '@shared/world'

import { getGame } from '../store/game'
import { createBallMesh, disposeBallMesh } from './balls'
import { CLICK_CONTACT, clicks } from './clickSwing'
import { CAGE_CONTACT } from './playerPose'
import { runtime } from './runtime'

/** Seconds a cage pitch takes from the machine to the bat, and from the bat into the net. */
const PITCH_S = 0.32
const TO_NET_S = 0.34
/** The same, in swing cycles (one swing per TRAIN_INTERVAL). */
const PITCH_C = PITCH_S / TRAIN_INTERVAL
const NET_C = TO_NET_S / TRAIN_INTERVAL
/** A cage ball's radius. */
const RADIUS = 0.16
/** Two in a cage (one coming, one going) and the last two click swings' tossed balls. */
const SLOTS = 4
/** Seconds a click-swung ball flies after it's hit, and how fast (m/s: out, up). */
const CLICK_FLY_S = 0.5
const CLICK_SPEED = 16
const CLICK_LIFT = 6

const _m = new Matrix4()
const _p = new Vector3()
const _a = new Vector3()
const _b = new Vector3()
const _zero = new Matrix4().makeScale(0, 0, 0)

/** A repeatable 0-1 number for swing `n` (where its ball hits the net). */
const jitter = (n, k) => {
  const x = Math.sin(n * 12.9898 + k * 78.233) * 43758.5453
  return x - Math.floor(x)
}

/**
 * The balls in your batting cage: while you swing there (Player: runtime.player.cage and
 * its swing phase), the pitching machine feeds you a ball each swing, timed to arrive as
 * the bat comes round (playerPose CAGE_CONTACT), and you smash it back into the net at the
 * far end of the tunnel, where it drops. At most two in the air at once - one coming, one
 * going - in one draw call; they're the ball you've equipped. Nothing drawn while you're
 * not in a cage.
 *
 * The balls of your click swings too (clickSwing.js): tossed up out of your hand, dropping
 * into the swing, and smacked away the way you were facing - up and gone in a blink.
 */
export default function TrainingBalls() {
  const ref = useRef(null)
  const assets = useMemo(() => createBallMesh(SLOTS), [])
  useEffect(() => () => disposeBallMesh(assets), [assets])

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return
    const cage = runtime.player.cage
    const phase = runtime.player.cagePhase
    const ballId = getGame().profile.equippedBall
    let count = 0
    const now = performance.now()
    // --- Click swings' balls --------------------------------------------------------
    for (const click of clicks) {
      const t = click.at ? (now - click.at) / 1000 : Infinity
      if (t > CLICK_CONTACT + CLICK_FLY_S) continue
      // In the swing's own frame: side-on, its left (+x) the way you were facing.
      const turn = click.yaw - Math.PI / 2
      const c = Math.cos(turn)
      const s = Math.sin(turn)
      let lx
      let ly
      let lz
      let size = RADIUS
      if (t < CLICK_CONTACT) {
        // Up out of your hand and down into the zone.
        const u = t / CLICK_CONTACT
        lx = 0.25 + 0.2 * u
        lz = 0.45 + 0.55 * u
        ly = 1.15 - 0.15 * u + 0.8 * 4 * u * (1 - u)
      } else {
        // Smacked: away up the line you faced, dropping as it goes, shrinking out of sight.
        const f = t - CLICK_CONTACT
        lx = 0.45 + CLICK_SPEED * f
        lz = 1.0 + 1.5 * f
        ly = 1.0 + CLICK_LIFT * f - 9 * f * f
        size = RADIUS * (1 - Math.max(0, (f - CLICK_FLY_S * 0.6) / (CLICK_FLY_S * 0.4)))
      }
      _p.set(click.x + lx * c + lz * s, click.y + ly, click.z - lx * s + lz * c)
      mesh.setBall(count, ballId)
      _m.makeRotationZ(t * 25).scale(_b.setScalar(Math.max(0.001, size))).setPosition(_p)
      mesh.setMatrixAt(count, _m)
      count += 1
    }
    if (cage < 0 || phase < 0) {
      for (let i = count; i < SLOTS; i += 1) mesh.setMatrixAt(i, _zero)
      mesh.count = SLOTS
      mesh.visible = count > 0
      if (count > 0) mesh.instanceMatrix.needsUpdate = true
      return
    }
    const cycles = phase / (Math.PI * 2)
    const n = Math.floor(cycles)
    // (shared/world cageMachine and cageBatterSpot, inline: no objects made per frame.)
    const cz = padCenterZ(cage)
    for (let m = n - 1; m <= n + 1 && count < SLOTS; m += 1) {
      // This swing's ball, in cycles from its moment of contact.
      const tau = cycles - (m + CAGE_CONTACT)
      if (tau < -PITCH_C || tau >= NET_C) continue
      // Where the bat meets it: in front of you over the plate, towards the machine.
      _a.set(PAD_X + 0.45, PAD_HEIGHT + 1.0, cz - 0.85 + 1.0)
      if (tau < 0) {
        // The pitch: out of the machine's chute, along the tunnel to you.
        const u = (tau + PITCH_C) / PITCH_C
        _b.set(TABLE_X - 0.6, 1.15, cz)
        _p.lerpVectors(_b, _a, u)
        _p.y += 0.18 * 4 * u * (1 - u)
      } else {
        // Smashed back up the tunnel into the net at its far end, where it drops.
        const v = tau / NET_C
        _b.set(COURT_BACK_X - 0.35, 1.6 + jitter(m, 1) * 1.5, cz + (jitter(m, 2) - 0.5) * COURT_HALF * 1.1)
        _p.lerpVectors(_a, _b, Math.min(1, v * 1.15))
        _p.y += 1.1 * 4 * Math.min(1, v * 1.15) * (1 - Math.min(1, v * 1.15))
        if (v > 0.87) _p.y -= (v - 0.87) * 4
      }
      mesh.setBall(count, ballId)
      _m.makeRotationZ(cycles * 20).scale(_b.setScalar(RADIUS)).setPosition(_p)
      mesh.setMatrixAt(count, _m)
      count += 1
    }
    for (let i = count; i < SLOTS; i += 1) mesh.setMatrixAt(i, _zero)
    mesh.count = SLOTS
    mesh.visible = count > 0
    mesh.instanceMatrix.needsUpdate = true
  })

  return <primitive ref={ref} object={assets} />
}
