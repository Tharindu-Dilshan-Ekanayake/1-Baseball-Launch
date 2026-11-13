import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Matrix4, Quaternion, Vector3 } from 'three'

import { TUTORIAL } from '@shared/balance'
import { BALL_SHOP, cageBatterSpot, EGG_STANDS, groundHeightAt, PAD_RADIUS, STATIONS, TIRE_STANDS } from '@shared/world'

import { getGame } from '../../store/game'
import { createToyInstances, PropBuilder } from '../blocks'
import { sharedMaterials, STYLE } from '../materials'
import { runtime } from '../runtime'

const MAX_CHEVRONS = 14
const SPACING = 2.4
/** Stop drawing arrows this close to the goal. */
const ARRIVED = 3.5

/** Ground point each tutorial step leads to. */
const TARGETS = {
  roll: { x: STATIONS[4].spotX, z: STATIONS[4].spotZ, reach: 1.2 },
  pad0: { ...cageBatterSpot(0), reach: PAD_RADIUS - 0.8 },
  tires: { x: TIRE_STANDS[1].x, z: TIRE_STANDS[1].z },
  balls: { x: BALL_SHOP.x, z: BALL_SHOP.z, reach: BALL_SHOP.radius - 0.6 },
  eggs: { x: EGG_STANDS[0].x, z: EGG_STANDS[0].z - 3.5 },
}
/** Where to aim instead of `target` from (x, z): round the end of the fence in the way, if any. */
const _aim = { x: 0, z: 0 }
function aimFor(target, x, z) {
  _aim.x = target.x
  _aim.z = target.z
  const fence = target.round
  // South of the backstop and behind it: lead round its nearer end first.
  if (fence && z > fence.z + 0.4 && Math.abs(x - fence.x) < fence.halfWidth + 1.2) {
    _aim.x = fence.x + (x > fence.x + 0.5 ? 1 : -1) * (fence.halfWidth + 1.6)
    _aim.z = fence.z
  }
  return _aim
}

const _m = new Matrix4()
const _q = new Quaternion()
const _p = new Vector3()
const _s = new Vector3(1, 1, 1)
const _up = new Vector3(0, 1, 0)

/** A flat ">"-shaped chevron lying on the ground, pointing along +Z. */
function chevronGeometry() {
  const p = new PropBuilder()
  for (const side of [-1, 1]) {
    p.box(side * 0.42, 0.05, -0.05, 1.15, 0.08, 0.38, '#ff9a1f', STYLE.GLOW, [0, side * 0.75, 0])
  }
  return p.build()
}

/**
 * Orange chevrons on the ground leading to the current tutorial goal, as in the
 * reference. They march towards the target and disappear once you get there.
 */
export function TutorialArrows() {
  const ref = useRef(null)
  const { mesh } = useMemo(() => {
    const m = createToyInstances(chevronGeometry(), sharedMaterials().toy, MAX_CHEVRONS)
    return { mesh: m }
  }, [])

  useEffect(
    () => () => {
      mesh.geometry.dispose()
      mesh.dispose()
    },
    [mesh],
  )

  useFrame((state) => {
    const instanced = ref.current
    if (!instanced) return
    const { profile, roll } = getGame()
    const step = TUTORIAL[profile.tutorialStep]
    const target = step && TARGETS[step.target]
    const player = runtime.player.position
    if (!target || roll || runtime.camera.mode !== 'follow') {
      instanced.count = 0
      return
    }
    if (Math.hypot(target.x - player.x, target.z - player.z) < (target.reach ?? ARRIVED)) {
      instanced.count = 0
      return
    }
    const aim = aimFor(target, player.x, player.z)
    const dx = aim.x - player.x
    const dz = aim.z - player.z
    const dist = Math.hypot(dx, dz)
    if (dist < 0.5) {
      instanced.count = 0
      return
    }
    const ux = dx / dist
    const uz = dz / dist
    _q.setFromAxisAngle(_up, Math.atan2(ux, uz))
    // March towards the goal.
    const offset = (state.clock.elapsedTime * 3) % SPACING
    let count = 0
    for (let d = 1.6 + offset; d < dist - 1 && count < MAX_CHEVRONS; d += SPACING) {
      const x = player.x + ux * d
      const z = player.z + uz * d
      // Over the cages' mats and the bat shop's stages, not under them, and well clear of
      // everything lying on the floor (decals 0.03 up, the plate and bags 0.1-0.16).
      _p.set(x, groundHeightAt(x, z) + 0.15, z)
      // Fade in near the player, shrink near the goal - in plan only, so their height
      // above the floor never changes.
      const scale = Math.max(0.01, Math.min(1, (d - 1.2) / 1.5) * Math.min(1, (dist - d) / 2))
      _s.set(scale, 1, scale)
      instanced.setMatrixAt(count, _m.compose(_p, _q, _s))
      count += 1
    }
    instanced.count = count
    instanced.instanceMatrix.needsUpdate = true
  })

  return <primitive ref={ref} object={mesh} />
}

export default TutorialArrows
