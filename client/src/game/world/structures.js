import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  LinearMipmapLinearFilter,
  MeshBasicMaterial,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
} from 'three'

import { BALLS } from '@shared/balance'
import {
  BALL_SHOP,
  cagePlate,
  COURT_BACK_X,
  COURT_HALF,
  PAD_COUNT,
  PAD_HEIGHT,
  PAD_RADIUS,
  PAD_X,
  padCenterZ,
  SHOP_SIGN,
  SHOP_SIGN_FACING,
  SHOP_STAGES,
  TABLE_NEAR_X,
  TABLE_X,
} from '@shared/world'

import { BALL_STYLES } from '../balls'
import { STYLE } from '../materials'
import { venueOf } from '../sceneStyle'
import { addBaseball } from './rollZone'

/**
 * Static lobby structures, added to the world's shared BlockSet and prop builder so they
 * render in the same few draw calls as everything else - plus the batting cages' nets,
 * one see-through mesh for every cage (createCageNets).
 */

/**
 * Per-cage look, in pad order (matches PADS in shared/balance.js): the mat's base, top,
 * glowing ring and emblem, the cage frame's posts and rails, the tunnel's floor, the
 * pitching machine's glow, and the colour of its labels. `lava` ones (Lava Land's two
 * cages) have a glowing cracked mat, a basalt floor, red netting and flames on their board.
 */
export const PAD_THEMES = [
  { base: '#1f5fc8', top: '#3f9cff', ring: '#9fe8ff', emblem: '#ffffff', rail: '#1d5fd6', court: '#2f8f3a', screen: '#5fd6ff', text: '#5fd6ff' },
  { base: '#b8222e', top: '#ff3b3b', ring: '#ffd21f', emblem: '#1d1f22', rail: '#c8323c', court: '#2f8f3a', screen: '#ffd21f', text: '#ff7a6a' },
  { base: '#d64a9a', top: '#ff8fd0', ring: '#ffffff', emblem: '#ffd23f', rail: '#d63f8f', court: '#2f8f3a', screen: '#ffffff', text: '#ff9cd6' },
  { base: '#1d3f8a', top: '#2f6fe0', ring: '#7fe2ff', emblem: '#ffd21f', rail: '#173b8f', court: '#2f8f3a', screen: '#7fe2ff', text: '#7fb8ff' },
  { base: '#5a2a9a', top: '#8a4cff', ring: '#ff7ad9', emblem: '#ffffff', rail: '#6a2fd0', court: '#2f8f3a', screen: '#ff7ad9', text: '#c69bff' },
  { base: '#1a8ab8', top: '#7ff0ff', ring: '#ffffff', emblem: '#9b6bff', rail: '#14a3c9', court: '#2a8a6a', screen: '#ffffff', text: '#9fe8ff', style: STYLE.GLOW },
  { base: '#1b2266', top: '#2a1450', ring: '#c35cff', emblem: '#ffd21f', rail: '#2a1450', court: '#1f2a5a', screen: '#ffd21f', text: '#d39bff', style: STYLE.GALAXY },
  // Lava Land's cages: a magma mat, then an inferno one.
  { base: '#3a1a14', top: '#ff6a1e', ring: '#ffd27a', emblem: '#ffb21a', rail: '#5a2418', court: '#2a1c1c', screen: '#ff8a1e', text: '#ff9a4a', style: STYLE.LAVA, lava: true },
  { base: '#2a0c0c', top: '#ff3b0a', ring: '#ffb21a', emblem: '#ffffff', rail: '#3a0c0c', court: '#1e1214', screen: '#ff5a14', text: '#ff6a3a', style: STYLE.LAVA, lava: true },
]

const LINE = '#f4f7fb'
const LEG = '#3a3f4a'
const RUBBER = '#22252c'
/** The multiplier backboard: high above the cage, and compact. Labels centre on it (lobbyLabels). */
export const BOARD_BOTTOM = 4.8
export const BOARD_HEIGHT = 3.6

/** The cage's net tunnel: from just west of the mat to the back net, this tall. */
const CAGE_WEST = PAD_X - PAD_RADIUS - 0.2
const CAGE_EAST = COURT_BACK_X - 0.05
const CAGE_HEIGHT = 3.8
/** The L-screen in front of the pitching machine, and its two parts' extents. */
const SCREEN_X = TABLE_NEAR_X + 0.6
const SCREEN = { low: 0.9, high: 2.2, from: -1.1, cut: 0.3, to: 1.1 }

const DISC = new CylinderGeometry(1, 1, 1, 24)
const PENTAGON = new CylinderGeometry(1, 1, 1, 5)
const RING = new TorusGeometry(1, 0.08, 4, 28)
const CYL = new CylinderGeometry(1, 1, 1, 12)
/** A low-poly ball for the little ones (balls lying round, on shelves). */
const PEBBLE = new SphereGeometry(1, 8, 6)

/**
 * The cage's frame: a post at every corner and two more down each side, rails along the
 * top and across it at every pair of posts. (Its netting is createCageNets'.)
 */
function buildFrame(blocks, z, theme) {
  const xs = [CAGE_WEST, CAGE_WEST + 3.05, CAGE_WEST + 6.1, CAGE_WEST + 9.15, CAGE_EAST]
  for (const x of xs) {
    for (const s of [-1, 1]) {
      blocks.addOn(x, 0, z + s * COURT_HALF, 0.14, CAGE_HEIGHT, 0.14, theme.rail, STYLE.SMOOTH)
    }
    blocks.add(x, CAGE_HEIGHT + 0.06, z, 0.14, 0.12, COURT_HALF * 2 + 0.14, theme.rail, STYLE.SMOOTH)
  }
  for (const s of [-1, 1]) {
    blocks.add((CAGE_WEST + CAGE_EAST) / 2, CAGE_HEIGHT + 0.06, z + s * COURT_HALF, CAGE_EAST - CAGE_WEST, 0.12, 0.14, theme.rail, STYLE.SMOOTH)
  }
  // A glowing cap on each entrance post, in the cage's colour.
  for (const s of [-1, 1]) blocks.addOn(CAGE_WEST, CAGE_HEIGHT + 0.12, z + s * COURT_HALF, 0.3, 0.2, 0.3, theme.ring, STYLE.GLOW)
}

/**
 * The tunnel's turf floor east of the mat, a white line down each side, and the padded
 * barrier along the foot of the back net (where hit balls end up: a few lie about).
 */
function buildFloor(blocks, props, z, theme, index) {
  const length = COURT_BACK_X - (TABLE_NEAR_X - 0.4)
  const x = (TABLE_NEAR_X - 0.4 + COURT_BACK_X) / 2
  blocks.addOn(x, 0, z, length, 0.05, COURT_HALF * 2, theme.court, theme.lava ? STYLE.LAVA : STYLE.STUDS)
  for (const s of [-1, 1]) blocks.addOn(x, 0.05, z + s * (COURT_HALF - 0.25), length - 0.3, 0.04, 0.1, LINE, STYLE.SMOOTH)
  for (let i = 0; i < 3; i += 1) {
    const pz = z - COURT_HALF + (i + 0.5) * ((COURT_HALF * 2) / 3)
    blocks.addOn(COURT_BACK_X, 0, pz, 0.22, 0.75, (COURT_HALF * 2) / 3 - 0.06, i % 2 ? theme.top : theme.base, STYLE.SMOOTH)
  }
  blocks.addOn(COURT_BACK_X, 0.75, z, 0.26, 0.08, COURT_HALF * 2, theme.ring, STYLE.GLOW)
  // Balls that have been smashed into the net, lying where they dropped.
  for (let i = 0; i < 4; i += 1) {
    const bx = COURT_BACK_X - 0.5 - ((i * 37 + index * 11) % 10) * 0.12
    const bz = z + (((i * 53 + index * 29) % 17) / 17 - 0.5) * (COURT_HALF * 1.6)
    props.add(PEBBLE, { position: [bx, 0.12, bz], scale: 0.075, color: '#fbf8ef' })
  }
}

/**
 * The pitching machine at the tunnel's middle (shared/world cageMachine: its release
 * point): a tripod, the motor housing in the cage's colour, two big rubber wheels stacked
 * one over the other - the ball shoots out between them at release height - and a hopper
 * of balls on top. Behind it is the L-screen's frame (its netting: createCageNets).
 * Everything east of TABLE_NEAR_X stays inside the cage's static collider.
 */
function buildMachine(blocks, props, z, theme) {
  const mx = TABLE_X - 0.2
  const releaseY = 1.15
  // The tripod.
  for (const [dx, dz] of [[0.45, 0], [-0.25, 0.42], [-0.25, -0.42]]) {
    blocks.add(mx + dx * 0.5, 0.42, z + dz * 0.5, 0.08, 0.95, 0.08, LEG, STYLE.SMOOTH, 0, dz * 0.8, -dx * 0.8)
  }
  // The housing behind the wheels, and its glowing panel.
  blocks.add(mx + 0.25, releaseY, z, 0.55, 0.62, 0.62, theme.rail, STYLE.SMOOTH)
  blocks.add(mx + 0.25, releaseY + 0.12, z + 0.33, 0.3, 0.16, 0.04, theme.screen, STYLE.GLOW)
  // The wheels, their faces towards the batter, either side of the ball's path.
  for (const dy of [0.36, -0.36]) {
    props.add(DISC, { position: [mx - 0.22, releaseY + dy, z], rotation: [Math.PI / 2, 0, 0], scale: [0.32, 0.14, 0.32], color: RUBBER })
    props.add(DISC, { position: [mx - 0.22, releaseY + dy, z], rotation: [Math.PI / 2, 0, 0], scale: [0.12, 0.18, 0.12], color: theme.ring, style: STYLE.GLOW })
  }
  // The hopper, full of balls.
  blocks.add(mx + 0.3, releaseY + 0.62, z, 0.5, 0.36, 0.5, LEG, STYLE.SMOOTH, 0, 0, 0.25)
  for (let i = 0; i < 4; i += 1) {
    props.add(PEBBLE, { position: [mx + 0.18 + (i % 2) * 0.2, releaseY + 0.86, z - 0.1 + Math.floor(i / 2) * 0.2], scale: 0.08, color: '#fbf8ef' })
  }
  // The L-screen's frame: a low full-width bar the pitch flies over, and an upright beside
  // where it passes.
  const { low, high, from, cut, to } = SCREEN
  blocks.addOn(SCREEN_X, 0, z + from, 0.08, low, 0.08, theme.rail, STYLE.SMOOTH)
  blocks.addOn(SCREEN_X, 0, z + to, 0.08, high, 0.08, theme.rail, STYLE.SMOOTH)
  blocks.addOn(SCREEN_X, 0, z + cut, 0.08, high, 0.08, theme.rail, STYLE.SMOOTH)
  blocks.add(SCREEN_X, low, z + (from + cut) / 2, 0.1, 0.1, cut - from, theme.base, STYLE.SMOOTH)
  blocks.add(SCREEN_X, high, z + (cut + to) / 2, 0.1, 0.1, to - cut, theme.rail, STYLE.SMOOTH)
}

/**
 * The backboard over the cage, kept small and high so the camera behind the batter sees it
 * over the netting: a navy panel in a rail-coloured frame with a glowing border, on two
 * thin posts, and on top a baseball (flames on a lava cage).
 */
function buildBoard(blocks, props, z, theme) {
  const bx = PAD_X + 5.6
  const by = BOARD_BOTTOM
  const bh = BOARD_HEIGHT
  for (const s of [-1, 1]) blocks.addOn(bx, 0, z + s * 1.5, 0.22, by, 0.22, LEG, STYLE.SMOOTH)
  blocks.addOn(bx, by, z, 0.4, bh, 4.2, theme.rail, STYLE.SMOOTH)
  blocks.addOn(bx - 0.23, by + 0.2, z, 0.08, bh - 0.4, 3.8, '#141a3a', STYLE.SMOOTH)
  blocks.addOn(bx - 0.28, by + 0.12, z, 0.06, 0.1, 3.9, theme.ring, STYLE.GLOW)
  blocks.addOn(bx - 0.28, by + bh - 0.22, z, 0.06, 0.1, 3.9, theme.ring, STYLE.GLOW)
  for (const s of [-1, 1]) blocks.addOn(bx - 0.28, by + 0.2, z + s * 1.9, 0.06, bh - 0.4, 0.1, theme.ring, STYLE.GLOW)
  if (theme.lava) {
    // Flames licking up off the top: stacked glowing blocks, hotter at the core.
    for (let i = -2; i <= 2; i += 1) {
      const h = 0.9 + (2 - Math.abs(i)) * 0.45
      blocks.addOn(bx, by + bh, z + i * 0.7, 0.3, h, 0.5, '#ff4a0a', STYLE.GLOW)
      blocks.addOn(bx, by + bh, z + i * 0.7, 0.36, h * 0.55, 0.3, '#ffd27a', STYLE.GLOW)
    }
  } else {
    addBaseball(blocks, props, bx, by + bh + 0.62, z, 0.55, -Math.PI / 2, 26)
  }
}

/**
 * The batting cages: round two-tier mats in the cage's colours with a glowing ring round
 * the top, a white home plate on each (cagePlate) with the batter's box chalked beside it
 * where you stand (cageBatterSpot), then the net tunnel running east to a pitching machine
 * behind its L-screen, the turf, the back net's padding and the multiplier board above.
 * The rounded parts go into the world's props, the rest into its blocks: no draw calls of
 * their own (the netting is one mesh for all cages: createCageNets).
 */
export function buildPads(blocks, props) {
  for (let i = 0; i < PAD_COUNT; i += 1) {
    const theme = PAD_THEMES[i]
    const z = padCenterZ(i)
    const r = PAD_RADIUS
    props.add(DISC, { position: [PAD_X, PAD_HEIGHT * 0.4, z], scale: [r + 0.45, PAD_HEIGHT * 0.8, r + 0.45], color: theme.base })
    props.add(DISC, { position: [PAD_X, PAD_HEIGHT - 0.06, z], scale: [r, 0.14, r], color: theme.top, style: theme.style ?? STYLE.STUDS })
    props.add(RING, { position: [PAD_X, PAD_HEIGHT + 0.02, z], rotation: [Math.PI / 2, 0, 0], scale: [r - 0.25, r - 0.25, 1], color: theme.ring, style: STYLE.GLOW })
    // Home plate on the mat (its point away from the machine), and the batter's box chalked
    // on its north side.
    const plate = cagePlate(i)
    props.add(PENTAGON, { position: [plate.x, PAD_HEIGHT + 0.06, plate.z], rotation: [0, -Math.PI / 2, 0], scale: [0.42, 0.06, 0.42], color: '#ffffff' })
    const boxZ = z - 0.85
    for (const s of [-1, 1]) {
      blocks.addOn(PAD_X + s * 0.9, PAD_HEIGHT + 0.04, boxZ, 0.07, 0.03, 1.05, LINE, STYLE.SMOOTH)
      blocks.addOn(PAD_X, PAD_HEIGHT + 0.04, boxZ + s * 0.5, 1.85, 0.03, 0.07, LINE, STYLE.SMOOTH)
    }
    buildFrame(blocks, z, theme)
    buildFloor(blocks, props, z, theme, i)
    buildMachine(blocks, props, z, theme)
    buildBoard(blocks, props, z, theme)
  }
}

/** The netting's grid: one cell of it, 32 px, a strand down its left and along its top. */
function netTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 32
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, 32, 32)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
  ctx.fillRect(0, 0, 32, 3)
  ctx.fillRect(0, 0, 3, 32)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.minFilter = LinearMipmapLinearFilter
  return texture
}

/** Netting cells are this big (metres). */
const NET_CELL = 0.22
const NET_COLOR = new Color('#151a20')
const LAVA_NET = new Color('#4a0c08')

/**
 * Every cage's netting as ONE see-through mesh: the two side walls, the roof and the back
 * net of each tunnel, and its L-screen, as quads whose UVs run in metres, so the 32 px grid
 * repeats at a constant mesh size (darker red on Lava Land's cages). Blended, not alpha
 * tested: from far off the strands average into a faint dark veil rather than flickering
 * out, and no shader of the toy world needs a discard. One draw call; dispose
 * `geometry`, `material` and `texture` with the world.
 */
export function createCageNets() {
  const positions = []
  const uvs = []
  const colors = []
  const indices = []
  // A quad from corner a along u (du) and v (dv), its UVs in metres / NET_CELL.
  const quad = (a, du, dv, color) => {
    const o = positions.length / 3
    const lu = Math.hypot(...du) / NET_CELL
    const lv = Math.hypot(...dv) / NET_CELL
    const corners = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]
    for (const [cu, cv] of corners) {
      positions.push(a[0] + du[0] * cu + dv[0] * cv, a[1] + du[1] * cu + dv[1] * cv, a[2] + du[2] * cu + dv[2] * cv)
      uvs.push(cu * lu, cv * lv)
      colors.push(color.r, color.g, color.b)
    }
    indices.push(o, o + 1, o + 2, o, o + 2, o + 3)
  }
  const length = CAGE_EAST - CAGE_WEST
  for (let i = 0; i < PAD_COUNT; i += 1) {
    const z = padCenterZ(i)
    const color = PAD_THEMES[i].lava ? LAVA_NET : NET_COLOR
    for (const s of [-1, 1]) quad([CAGE_WEST, 0, z + s * COURT_HALF], [length, 0, 0], [0, CAGE_HEIGHT, 0], color)
    quad([CAGE_WEST, CAGE_HEIGHT, z - COURT_HALF], [length, 0, 0], [0, 0, COURT_HALF * 2], color)
    quad([CAGE_EAST, 0, z - COURT_HALF], [0, 0, COURT_HALF * 2], [0, CAGE_HEIGHT, 0], color)
    const { low, high, from, cut, to } = SCREEN
    quad([SCREEN_X, 0.05, z + from], [0, 0, to - from], [0, low - 0.05, 0], color)
    quad([SCREEN_X, low, z + cut], [0, 0, to - cut], [0, high - low, 0], color)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  const texture = netTexture()
  const material = new MeshBasicMaterial({ map: texture, vertexColors: true, transparent: true, depthWrite: false, side: DoubleSide })
  return { geometry, material, texture }
}

const WHITE = '#f4f7fb'

/**
 * The bat shop: two open display stages (the bat stands on them are TireShop's) and the
 * big BAT SHOP sign behind, built like the foul-pole banner - white decks on a band in the
 * team's colour with light strips round the edges. `detail` (off on LOW) adds the sign's
 * bulbs.
 *
 * No two faces here share a plane: every layer stands a clear step proud of what it
 * sits on.
 */
export function buildShop(blocks, { detail = true, world = 0 } = {}) {
  const { band: YELLOW, strip: PALE, post: GOLD, panel: NAVY } = venueOf(world).shop
  for (const s of SHOP_STAGES) {
    const w = s.maxX - s.minX
    const d = s.maxZ - s.minZ
    const cx = (s.minX + s.maxX) / 2
    const cz = (s.minZ + s.maxZ) / 2
    blocks.addOn(cx, -0.1, cz, w, s.height + 0.1, d, WHITE)
    blocks.addOn(cx, 0, cz, w + 0.3, s.height * 0.5, d + 0.3, YELLOW)
    // Light strips along all four top edges, and a gold post at each corner.
    for (const side of [-1, 1]) {
      blocks.addOn(cx + side * (w / 2 - 0.25), s.height, cz, 0.35, 0.08, d - 1.4, PALE, STYLE.GLOW)
      blocks.addOn(cx, s.height, cz + side * (d / 2 - 0.25), w - 1.4, 0.08, 0.35, PALE, STYLE.GLOW)
      for (const end of [-1, 1]) {
        blocks.addOn(cx + side * (w / 2 - 0.35), s.height, cz + end * (d / 2 - 0.35), 0.6, 0.7, 0.6, GOLD, STYLE.GLOW)
      }
    }
  }

  // The sign: two striped legs, a navy panel in a frame, a gold cap, its face turned to
  // the plaza (`f`).
  const { x, minZ, maxZ, top } = SHOP_SIGN
  const f = SHOP_SIGN_FACING
  const length = maxZ - minZ
  const midZ = (minZ + maxZ) / 2
  const bottom = top - 8.2
  for (const z of [minZ + 1.5, maxZ - 1.5]) blocks.addOn(x - 0.1 * f, 0, z, 0.9, bottom + 0.3, 0.9, YELLOW, STYLE.STRIPES)
  blocks.addOn(x, bottom, midZ, 0.6, top - bottom, length, YELLOW)
  blocks.addOn(x + 0.1 * f, bottom + 0.5, midZ, 0.6, top - bottom - 1, length - 1, NAVY, STYLE.SMOOTH)
  blocks.addOn(x, top, midZ, 0.9, 0.4, length + 0.4, GOLD, STYLE.GLOW)
  if (detail) {
    for (let z = minZ + 1; z <= maxZ - 0.99; z += 1.5) {
      blocks.add(x + 0.42 * f, bottom + 0.25, z, 0.16, 0.3, 0.3, Math.round(z) % 2 ? '#ffffff' : GOLD, STYLE.GLOW)
      blocks.add(x + 0.42 * f, top - 0.25, z + 0.75, 0.16, 0.3, 0.3, Math.round(z) % 2 ? GOLD : '#ffffff', STYLE.GLOW)
    }
  }
}

/** Where the ball shop's sign board stands (its lettering: signs.js), facing west. */
export const BALL_SHOP_SIGN = { x: BALL_SHOP.body.minX - 0.38, y: 4.35, z: BALL_SHOP.z, width: 6.2, height: 1.3 }

/** Balls whose colours glow on the shelf. */
const GLOWING = new Set(['fire', 'lightning', 'plasma', 'meteor', 'galaxy', 'blackhole', 'rainbow'])

/**
 * The BALL SHOP's stall (BALL_SHOP, its solid body BALL_SHOP.body): a counter facing west
 * onto its patio, a back wall of shelves lined with every ball in the shop (in their own
 * colours, the fiery ones glowing), side walls, a striped awning sloping down over the
 * counter with a scalloped edge, the BALL SHOP sign standing on it, and a giant baseball on
 * a pedestal on the roof. Blocks and props: no draw calls of its own.
 */
export function buildBallShop(blocks, props, { world = 0 } = {}) {
  const v = venueOf(world)
  const { awning, wood, counter, trim } = v.stall
  const { minX, maxX, minZ, maxZ } = BALL_SHOP.body
  const cz = BALL_SHOP.z
  const depth = maxZ - minZ
  // The counter along the front, its wooden top, and a glowing strip down its face.
  blocks.addOn(minX + 0.35, 0, cz, 0.7, 1.05, depth - 0.4, counter, STYLE.SMOOTH)
  blocks.addOn(minX + 0.35, 1.05, cz, 0.95, 0.1, depth - 0.1, wood, STYLE.SMOOTH)
  blocks.addOn(minX - 0.02, 0.45, cz, 0.06, 0.12, depth - 0.6, trim, STYLE.GLOW)
  // The back wall, the side walls and the corner posts holding up the awning.
  blocks.addOn(maxX - 0.2, 0, cz, 0.4, 4.25, depth, wood, STYLE.SMOOTH)
  for (const s of [-1, 1]) {
    blocks.addOn((minX + maxX) / 2 + 0.3, 0, cz + s * (depth / 2 - 0.15), maxX - minX - 0.6, 3.2, 0.3, wood, STYLE.SMOOTH)
    blocks.addOn(minX + 0.15, 1.15, cz + s * (depth / 2 - 0.15), 0.22, 2.25, 0.22, trim, STYLE.SMOOTH)
  }
  // Three shelves on the back wall, every ball of the shop along them.
  for (let row = 0; row < 3; row += 1) {
    const y = 1.3 + row * 0.85
    blocks.addOn(maxX - 0.7, y, cz, 0.6, 0.08, depth - 0.9, '#f4ead8', STYLE.SMOOTH)
    for (let i = 0; i < 6; i += 1) {
      const ball = BALLS[(row * 6 + i) % BALLS.length]
      const style = BALL_STYLES[ball.id]
      const glow = GLOWING.has(ball.id)
      props.add(PEBBLE, {
        position: [maxX - 0.7, y + 0.3, cz - (depth - 1.8) / 2 + i * ((depth - 1.8) / 5)],
        scale: 0.22,
        color: glow ? style.head : style.a,
        style: glow ? STYLE.GLOW : STYLE.SMOOTH,
      })
    }
  }
  // The awning: stripes sloping from the back wall down past the counter, and a scalloped edge.
  const backX = maxX + 0.1
  const frontX = minX - 1.0
  const backY = 4.35
  const frontY = 3.45
  const slope = Math.hypot(backX - frontX, backY - frontY)
  const angle = Math.atan2(backY - frontY, backX - frontX)
  const stripes = 8
  const stripe = (depth + 0.6) / stripes
  for (let i = 0; i < stripes; i += 1) {
    const z = minZ - 0.3 + (i + 0.5) * stripe
    blocks.add((backX + frontX) / 2, (backY + frontY) / 2, z, slope, 0.12, stripe - 0.02, awning[i % 2], STYLE.SMOOTH, 0, 0, angle)
    blocks.add(frontX - 0.02, frontY - 0.26, z, 0.08, 0.36, stripe * 0.8, awning[i % 2], STYLE.SMOOTH)
  }
  // The sign board standing on the awning's front, facing the plaza.
  const sign = BALL_SHOP_SIGN
  blocks.addOn(sign.x + 0.12, sign.y - sign.height / 2 - 0.12, cz, 0.22, sign.height + 0.24, sign.width + 0.3, trim, STYLE.SMOOTH)
  blocks.addOn(sign.x + 0.08, sign.y - sign.height / 2, cz, 0.22, sign.height, sign.width, counter, STYLE.SMOOTH)
  // The giant baseball on the roof, seams to the plaza.
  const px = maxX - 1.6
  props.add(CYL, { position: [px, backY + 0.35, cz], scale: [0.45, 0.5, 0.45], color: trim })
  addBaseball(blocks, props, px, backY + 0.6 + 1.35, cz, 1.35, -Math.PI / 2, 34)
}
