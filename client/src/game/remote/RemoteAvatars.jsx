import { useFrame, useThree } from '@react-three/fiber'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Vector3 } from 'three'

import { BATTER_YAW, PAD_YAW } from '@shared/world'

import { remotePlayers } from '../../net/remotePlayers'
import { getQuality } from '../../store/quality'
import { emoteFromAnim } from '../../bloxity/emotes'
import { CLICK_POSE_S, TOSS_S } from '../clickSwing'
import { RUN_CADENCE } from '../kick'
import { SWING_CONTACT } from '../playerPose'
import { BloxityAvatar } from '../PlayerAvatar'

/** How often the set of fully drawn players is reconsidered. */
const PICK_MS = 500
/** Top walking speed: full stride amplitude, as for your own character. */
const MAX_SPEED = 10.875
const _up = new Vector3(0, 1, 0)

/**
 * One other player as their real Bloxity avatar, dressed as they are and carrying the bat
 * they've equipped - posed by the same playerPose as yours, from what the network says
 * they're doing: walking pace, swinging in a batting cage, jumping, up at bat waiting on
 * the pitch. Their hits play here too: the swing through the ball and the celebration,
 * while their ball flies down its own line of the field (roll/BallFlight).
 */
function RemoteAvatar({ sessionId, look }) {
  const groupRef = useRef(null)
  const lastY = useRef(null)
  const motionRef = useRef({ time: 0, speed: 0, grounded: true, maxSpeed: MAX_SPEED, vy: 0, stride: 0 })
  const batId = useCallback(() => remotePlayers.get(sessionId)?.tireId || 'bicycle', [sessionId])

  useFrame((_state, rawDelta) => {
    const group = groupRef.current
    const r = remotePlayers.get(sessionId)
    if (!group || !r) return
    const delta = Math.min(rawDelta, 0.05)
    const m = motionRef.current
    m.time += delta
    group.visible = true
    m.run = 0
    m.bat = undefined
    m.cheer = 0
    m.emote = null
    group.position.copy(r.position)

    if (r.hitting || r.pulling) {
      // At the plate: their hit (the swing through the ball, then watching it fly and
      // celebrating), or waiting on the next pitch.
      group.quaternion.setFromAxisAngle(_up, BATTER_YAW)
      if (r.hitting) {
        m.bat = 'after'
        m.swingT = r.hitT + SWING_CONTACT
        m.great = r.hitGrade === 'perfect' || r.hitGrade === 'great'
      } else {
        m.bat = 'ready'
        // A gentle wind-up loop: you can't see their pitcher's clock.
        m.coil = 0.5 + 0.5 * Math.sin(m.time * 1.6)
      }
      m.speed = 0
      m.grounded = true
      return
    }
    const running = r.anim === 'run'
    if (r.anim === 'swing') {
      // Click swinging (a ball tossed up and smacked, again and again): side-on to the way
      // they face, on a loop - you can't see their clicks, only that they're swinging.
      group.quaternion.setFromAxisAngle(_up, r.yaw - Math.PI / 2)
      const t = m.time % (CLICK_POSE_S + 0.08)
      if (t < TOSS_S) {
        m.bat = 'ready'
        m.coil = t / TOSS_S
      } else {
        m.bat = 'swing'
        m.swingT = t - TOSS_S
      }
      m.speed = 0
      m.grounded = true
      return
    }
    group.quaternion.setFromAxisAngle(_up, running ? PAD_YAW : r.yaw)
    // In a cage: a swing at every pitch, as yours does.
    m.run = running ? 1 : 0

    const speed = running ? 0 : r.speed
    m.speed = speed
    m.grounded = r.anim !== 'jump'
    // A Boxity emote they're playing (stood still while it lasts).
    m.emote = emoteFromAnim(r.anim)
    if (m.emote) m.speed = 0
    // Vertical speed from the interpolated height, smoothed: rising vs falling.
    const y = r.position.y
    if (lastY.current !== null) m.vy += ((y - lastY.current) / Math.max(delta, 1e-3) - m.vy) * 0.3
    lastY.current = y
    m.stride += delta * (running ? RUN_CADENCE : 5 + 6 * Math.min(1, speed / MAX_SPEED))
  })

  return (
    <group ref={groupRef}>
      <BloxityAvatar equipped={look?.equipped} proportions={look?.proportions} motionRef={motionRef} batId={batId} targetHeight={1.8} />
    </group>
  )
}

/**
 * The other players nearest the camera, as their real avatars - standing, walking or
 * training: as many as the quality preset allows (`remoteAvatars`), within
 * `remoteAvatarDistance` - on every preset, everyone in the room, near or far. Anyone
 * beyond those limits would be the cheap blocky figure RemotePlayers draws
 * (`r.fullAvatar` tells it who's covered).
 * Chosen twice a second, never per frame, so React only re-renders when the set of
 * players (or an outfit) actually changes.
 */
export function RemoteAvatars() {
  const camera = useThree((s) => s.camera)
  const [shown, setShown] = useState([])

  useEffect(() => {
    const pick = () => {
      const settings = getQuality()
      const near = []
      for (const r of remotePlayers.values()) {
        r.fullAvatar = false
        const d = camera.position.distanceTo(r.position)
        if (d < settings.remoteAvatarDistance) near.push([d, r])
      }
      near.sort((a, b) => a[0] - b[0])
      const next = near
        .slice(0, settings.remoteAvatars)
        .map(([, r]) => r)
        .sort((a, b) => (a.sessionId < b.sessionId ? -1 : 1))
      for (const r of next) r.fullAvatar = true
      setShown((prev) => {
        const same = prev.length === next.length && prev.every((p, i) => p.sessionId === next[i].sessionId && p.lookKey === next[i].lookKey)
        return same ? prev : next.map((r) => ({ sessionId: r.sessionId, look: r.look, lookKey: r.lookKey }))
      })
    }
    pick()
    const id = setInterval(pick, PICK_MS)
    return () => clearInterval(id)
  }, [camera])

  return (
    <>
      {shown.map((s) => (
        <Suspense key={`${s.sessionId}:${s.lookKey}`} fallback={null}>
          <RemoteAvatar sessionId={s.sessionId} look={s.look} />
        </Suspense>
      ))}
    </>
  )
}

export default RemoteAvatars
