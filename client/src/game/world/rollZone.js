import { CylinderGeometry, SphereGeometry } from 'three'

import { HOME_PLATE, ROLL_ARCH, STATIONS } from '@shared/world'

import { STYLE } from '../materials'
import { venueOf } from '../sceneStyle'

const DISC = new CylinderGeometry(1, 1, 1, 20)
/** A five-sided prism with a point towards +Z: home plate's shape (its point to the catcher). */
const PENTAGON = new CylinderGeometry(1, 1, 1, 5)
const BALL = new SphereGeometry(1, 16, 12)

/** The foul poles' height, and the banner beam slung between them. */
const POLE_TOP = 16
const ARCH_TOP = 11
export const ARCH_SIGN = { width: 12, height: 3, y: ARCH_TOP - 1.6, faceZ: ROLL_ARCH.z + 1.05 }

/** Wood for the giant bats on the banner. */
const WOOD = '#c98a4a'
const WOOD_DARK = '#8a5a2e'

/**
 * The infield at the field's mouth (the template's launch pad). Its paint - dirt, grass,
 * chalk - is the ground map's (ground.js); this is what stands on it:
 *  - every batting station's home plate, a white pentagon slab on a dark rim (nothing
 *    behind it: the batting camera looks out from there);
 *  - the two yellow foul poles (ROLL_ARCH) with their mesh screens, and slung between them
 *    high over the field's mouth a banner beam with its HIT IT FAR! sign (signs.js),
 *    crowned by a giant baseball and two crossed bats - in the venue's colours.
 *
 * Boxes go into the world's block set and the round parts into its props, so the whole
 * thing rides in those two draw calls. `detail` (off on LOW) adds the chain-link's finer
 * bars and the bulbs. No two faces share a plane: every layer stands a clear step proud
 * of what it sits on.
 */
export function buildRollZone(blocks, props, { detail = true, world = 0 } = {}) {
  const v = venueOf(world)
  const c = v.arch

  for (const s of STATIONS) {
    // Home plate: a dark rim and the white plate raised on it.
    props.add(PENTAGON, { position: [s.x, 0.03, HOME_PLATE.z], scale: [0.62, 0.06, 0.62], color: '#2a2a30' })
    props.add(PENTAGON, { position: [s.x, 0.075, HOME_PLATE.z], scale: [0.52, 0.06, 0.52], color: '#ffffff' })
  }

  // The foul poles: tall and yellow on a navy foot, a mesh screen on the field side, a
  // glowing ball on top.
  const poleZ = ROLL_ARCH.z
  for (const side of [-1, 1]) {
    const x = side * ROLL_ARCH.x
    blocks.addOn(x, 0, poleZ, 1.6, 0.5, 1.6, c.base, STYLE.SMOOTH)
    blocks.addOn(x, 0.5, poleZ, 0.5, POLE_TOP - 0.5, 0.5, c.pillar, STYLE.SMOOTH)
    blocks.addOn(x - side * 0.62, 2.5, poleZ, 0.7, POLE_TOP - 3.5, 0.06, c.pillar, STYLE.PLATE)
    props.add(BALL, { position: [x, POLE_TOP + 0.4, poleZ], scale: 0.55, color: c.glow, style: STYLE.GLOW })
    if (detail) {
      for (let y = 3; y < ARCH_TOP - 1; y += 1.6) blocks.add(x, y, poleZ + 0.27, 0.24, 0.24, 0.08, '#ffffff', STYLE.GLOW)
    }
  }

  // The banner beam between them, its sign facing the plaza, and bulbs along it.
  const span = ROLL_ARCH.x * 2
  blocks.addOn(0, ARCH_TOP - 0.2, poleZ, span - 0.4, 1.3, 1.0, c.base, STYLE.SMOOTH)
  blocks.addOn(0, ARCH_TOP - 0.42, poleZ, span - 1.4, 0.22, 1.1, c.glow, STYLE.GLOW)
  blocks.addOn(0, ARCH_SIGN.y - ARCH_SIGN.height / 2 - 0.15, poleZ + 0.75, ARCH_SIGN.width + 0.6, ARCH_SIGN.height + 0.3, 0.3, c.pillar)
  blocks.addOn(0, ARCH_SIGN.y - ARCH_SIGN.height / 2, poleZ + 0.8, ARCH_SIGN.width, ARCH_SIGN.height, 0.3, c.base, STYLE.SMOOTH)
  if (detail) {
    for (let x = -ROLL_ARCH.x + 1.5; x <= ROLL_ARCH.x - 1.49; x += 1) {
      if (Math.abs(x) < ARCH_SIGN.width / 2 + 0.7) continue
      blocks.add(x, ARCH_TOP + 0.6, poleZ + 0.55, 0.28, 0.28, 0.14, Math.round(x) % 2 ? c.crest : '#ffffff', STYLE.GLOW)
    }
  }

  // The crown: a giant baseball with its red seams, two crossed bats behind it.
  const top = ARCH_TOP + 1.1
  for (const side of [-1, 1]) {
    // Handle low, barrel high, leaning out: a knob, the taper and the barrel.
    const tilt = side * 0.62
    const along = (d) => [side * Math.sin(Math.abs(tilt)) * d, top + 2.6 + Math.cos(tilt) * d]
    const [kx, ky] = along(-2.8)
    const [hx, hy] = along(-1.2)
    const [ox, oy] = along(1.4)
    props.add(DISC, { position: [kx, ky, poleZ - 0.3], rotation: [0, 0, -tilt], scale: [0.32, 0.18, 0.32], color: WOOD_DARK })
    props.add(DISC, { position: [hx, hy, poleZ - 0.3], rotation: [0, 0, -tilt], scale: [0.2, 3.0, 0.2], color: WOOD })
    props.add(DISC, { position: [ox, oy, poleZ - 0.3], rotation: [0, 0, -tilt], scale: [0.48, 3.4, 0.48], color: WOOD })
    props.add(BALL, { position: [ox + side * Math.sin(Math.abs(tilt)) * 1.7, oy + Math.cos(tilt) * 1.7, poleZ - 0.3], scale: 0.48, color: WOOD })
  }
  addBaseball(blocks, props, 0, top + 1.9, poleZ + 0.4, 1.9, 0)
}

/**
 * A giant baseball at (x, y, z), `radius` big: a cream ball (props) with its red stitched
 * seam (small boxes in the block set) running round the side facing `yaw` (0: +Z, south) -
 * the seam's classic curve, a + b = 1: (a cos t + b cos 3t, a sin t - b sin 3t,
 * 2 sqrt(ab) sin 2t), pushed out onto the ball. Only the stitches on the facing half are
 * built.
 */
export function addBaseball(blocks, props, x, y, z, radius, yaw = 0, stitches = 40) {
  props.add(BALL, { position: [x, y, z], scale: radius, color: '#fbf8ef' })
  const a = 0.68
  const b = 1 - a
  const lift = 2 * Math.sqrt(a * b)
  const size = radius * 0.085
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  for (let i = 0; i < stitches; i += 1) {
    const t = (i / stitches) * Math.PI * 2
    // The curve's "front" axis is its z; turned so it faces `yaw`.
    let px = a * Math.cos(t) + b * Math.cos(3 * t)
    let py = a * Math.sin(t) - b * Math.sin(3 * t)
    let pz = lift * Math.sin(2 * t)
    const len = Math.hypot(px, py, pz)
    px /= len
    py /= len
    pz /= len
    if (pz < 0.15) continue
    const r = radius + size * 0.2
    blocks.add(x + (px * cos + pz * sin) * r, y + py * r, z + (pz * cos - px * sin) * r, size, size, size, '#e0262f', STYLE.SMOOTH, yaw)
  }
}
