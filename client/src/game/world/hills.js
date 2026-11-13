import { hash2 } from '@shared/rng'
import { CANYON_HALF_WIDTH, PLAZA } from '@shared/world'

import { STYLE } from '../materials'
import { SCOREBOARD } from './terrain'

/**
 * The ridges round the lobby: blocky hills, one box per column on a 4 m grid, stepping up
 * in terraces the further they stand from the plaza - low grassy banks just past its edge,
 * cliffs 36 m high further out - each terrace a colour further along the venue's rock ramp.
 * At the Sunny Ballpark they're green-capped hills of brown earth (STYLE.HILL) with trees
 * and pines on the terraces; in Lava Land they're ash-capped basalt, some columns split by
 * glowing lava (STYLE.LAVA), with obsidian spikes, dead trees, lava rocks and fire torches
 * - and a smoking volcano rises over the north-east ridge (buildVolcano). The field's
 * mouth is left open to the north (Lane.jsx carries the hills on down it).
 *
 * Everything goes into the world's block set (the volcano's smoke into its props): no
 * draw calls of its own, nothing to do per frame. `density` (the preset's decorDensity)
 * thins the decor and, on LOW, coarsens the grid to 8 m columns (a quarter of the boxes).
 */

/** The open ground the hills keep clear of: the plaza and everything round its edge. */
const OPEN = { minX: PLAZA.minX - 4, maxX: PLAZA.maxX + 4, minZ: PLAZA.minZ, maxZ: PLAZA.maxZ + 4 }
/** The field's valley floor, north of the plaza, left open for it. */
const VALLEY_HALF = CANYON_HALF_WIDTH + 6
/** How far out the hills go, from the middle. */
const REACH = { x: 96, south: PLAZA.maxZ + 112, north: -104 }

const TREE = { trunk: '#7a4f2a', leaves: ['#2f9e3a', '#3fb84a', '#4ccf54'], pine: ['#1f7a3a', '#25904a'] }
const LAVA = { obsidian: ['#1a1220', '#241a2c'], dead: '#2a2020', rock: '#ff5a14', flame: '#ff6a1e', core: '#ffd27a' }

/** Metres from (x, z) to the nearest open ground (the plaza, or the field's valley). */
function openDistance(x, z) {
  const dx = Math.max(OPEN.minX - x, 0, x - OPEN.maxX)
  const dz = Math.max(OPEN.minZ - z, 0, z - OPEN.maxZ)
  const plaza = Math.hypot(dx, dz)
  const valley = z < OPEN.minZ ? Math.max(0, Math.abs(x) - VALLEY_HALF) : Infinity
  return Math.min(plaza, valley)
}

/** Under the scoreboard on the south hills: kept below its screen. */
const underScoreboard = (x, z) =>
  Math.abs(x - SCOREBOARD.x) < SCOREBOARD.width / 2 + 3 && Math.abs(z - SCOREBOARD.z) < 4

/**
 * Something on a terrace at (x, top, z). At the ballpark: a round leafy tree (a trunk and
 * two stacked leaf blocks) or a pine (three stepped tiers). In Lava Land: a tilted obsidian
 * spike, a dead tree with two bare branches, a glowing lava rock, or a fire torch.
 */
function addDecor(blocks, x, top, z, k, kind) {
  const r = hash2(k, 31)
  if (kind === 'lava') {
    if (r < 0.35) {
      const h = 3 + hash2(k, 32) * 4
      const lean = (hash2(k, 36) - 0.5) * 0.5
      blocks.add(x, top + h / 2 - 0.3, z, 1.1, h, 1.1, LAVA.obsidian[k % 2], STYLE.SMOOTH, hash2(k, 37) * Math.PI, lean, -lean)
      blocks.add(x, top + h * 0.85, z, 0.5, h * 0.4, 0.5, LAVA.obsidian[(k + 1) % 2], STYLE.SMOOTH, hash2(k, 38) * Math.PI, lean * 1.2, -lean * 1.2)
    } else if (r < 0.6) {
      const h = 3.5 + hash2(k, 32) * 2
      blocks.addOn(x, top, z, 0.5, h, 0.5, LAVA.dead, STYLE.SMOOTH)
      blocks.add(x + 0.7, top + h * 0.75, z, 1.6, 0.25, 0.25, LAVA.dead, STYLE.SMOOTH, hash2(k, 36) * Math.PI, 0, 0.6)
      blocks.add(x - 0.6, top + h * 0.6, z, 1.3, 0.22, 0.22, LAVA.dead, STYLE.SMOOTH, hash2(k, 37) * Math.PI, 0, -0.7)
    } else if (r < 0.85) {
      const s = 1.6 + hash2(k, 32) * 1.6
      blocks.addOn(x, top, z, s, s * 0.8, s, LAVA.rock, STYLE.LAVA, hash2(k, 36) * Math.PI)
    } else {
      blocks.addOn(x, top, z, 0.3, 2.6, 0.3, LAVA.dead, STYLE.SMOOTH)
      blocks.addOn(x, top + 2.6, z, 0.7, 0.7, 0.7, LAVA.flame, STYLE.GLOW)
      blocks.addOn(x, top + 3.0, z, 0.4, 0.6, 0.4, LAVA.core, STYLE.GLOW)
    }
    return
  }
  if (r < 0.62) {
    const h = 2.4 + hash2(k, 32) * 1.6
    const leaf = TREE.leaves[Math.floor(hash2(k, 35) * TREE.leaves.length)]
    blocks.addOn(x, top, z, 0.7, h, 0.7, TREE.trunk, STYLE.SMOOTH)
    blocks.addOn(x, top + h, z, 3.4, 2.2, 3.4, leaf, STYLE.STUDS)
    blocks.addOn(x, top + h + 2.2, z, 2.2, 1.2, 2.2, leaf, STYLE.STUDS)
  } else {
    const turn = hash2(k, 36) * Math.PI
    blocks.addOn(x, top, z, 0.5, 1.4, 0.5, TREE.trunk, STYLE.SMOOTH)
    blocks.addOn(x, top + 1.2, z, 3, 1.8, 3, TREE.pine[0], STYLE.STUDS, turn)
    blocks.addOn(x, top + 3.0, z, 2.1, 1.6, 2.1, TREE.pine[1], STYLE.STUDS, turn + 0.4)
    blocks.addOn(x, top + 4.6, z, 1.1, 1.4, 1.1, TREE.pine[0], STYLE.STUDS, turn + 0.8)
  }
}

/**
 * Builds the hills into `blocks` in `venue`'s look (sceneStyle VENUES: `hills`). Returns
 * how many columns and decor pieces went in (for tests/debug).
 */
export function buildHills(blocks, { density = 1, venue } = {}) {
  const look = venue?.hills ?? { rock: ['#9a6a3a', '#8d6036', '#805632', '#734d2d', '#664428'], cap: STYLE.HILL, trees: 'tree' }
  const cap = look.cap ?? STYLE.HILL
  const cell = density < 0.5 ? 8 : 4
  const decorChance = density >= 0.75 ? 0.07 : density >= 0.5 ? 0.05 : 0.035
  let columns = 0
  let trees = 0
  for (let gx = -REACH.x; gx < REACH.x; gx += cell) {
    for (let gz = REACH.north; gz < REACH.south; gz += cell) {
      const x = gx + cell / 2
      const z = gz + cell / 2
      const d = openDistance(x, z)
      if (d < 2) continue
      // Terraces 4 m apart in height, every ~9 m out, with a little noise so the edges
      // wander; never higher than 36 m.
      const k = Math.floor(gx / 4) * 977 + Math.floor(gz / 4)
      const n = hash2(Math.floor(gx / 8), Math.floor(gz / 8))
      const step = Math.min(9, 1 + Math.floor(d / 9 + n * 1.3))
      let h = 4 * step
      if (underScoreboard(x, z)) h = Math.min(h, 20)
      const rock = look.rock[Math.min(look.rock.length - 1, Math.floor((step - 1) / 2))]
      // Now and then (Lava Land) a column of lava rock: glowing seams through the basalt.
      if (look.lava && hash2(k, 41) < look.lava.chance) blocks.addOn(x, 0, z, cell, h, cell, look.lava.color, STYLE.LAVA)
      else blocks.addOn(x, 0, z, cell, h, cell, rock, cap)
      columns += 1
      // Decor now and then on a terrace near enough to be seen.
      if (d < 70 && hash2(k, 30) < decorChance * (cell / 4) ** 2) {
        addDecor(blocks, x + (hash2(k, 33) - 0.5) * (cell - 3.4), h, z + (hash2(k, 34) - 0.5) * (cell - 3.4), k, look.trees)
        trees += 1
      }
    }
  }
  return { columns, trees }
}

/** Where Lava Land's volcano stands: over the north-east ridge, seen from the plaza and the field. */
export const VOLCANO = { x: 74, z: -64, height: 74 }

/**
 * Lava Land's volcano: a stepped cone of basalt tiers (ash-capped, glowing seams on every
 * other one), a crater rim with a pool of lava glowing in it, three lava streams running
 * down its face towards the plaza, and a column of smoke puffs drifting up from the crater
 * (static props, darker low, paler high). Boxes into `blocks`, the smoke into `props`.
 */
export function buildVolcano(blocks, props, sphere) {
  const { x, z, height } = VOLCANO
  const tiers = 7
  const tierH = height / tiers
  for (let i = 0; i < tiers; i += 1) {
    const w = 70 - i * 8.4
    const y = i * tierH
    blocks.addOn(x, y, z, w, tierH + 0.02, w, i % 2 ? '#2e2326' : '#382b2e', i % 3 === 2 ? STYLE.LAVA : STYLE.HILL, i * 0.12)
  }
  // The crater: a rim, the lava pool in it, and the glow over it.
  const top = height
  for (const [dx, dz, sx, sz] of [[0, 9, 20, 2.5], [0, -9, 20, 2.5], [9, 0, 2.5, 15.5], [-9, 0, 2.5, 15.5]]) {
    blocks.addOn(x + dx, top, z + dz, sx, 3, sz, '#241c1f', STYLE.HILL)
  }
  blocks.addOn(x, top, z, 15.5, 1.4, 15.5, '#ff5a14', STYLE.LAVA)
  blocks.addOn(x, top + 1.4, z, 9, 0.3, 9, '#ffb21a', STYLE.GLOW)
  // Lava streams down the side facing the plaza (south-west), in steps with the tiers.
  for (const [ox, oz] of [[-1, 1], [-1, 0.25], [-0.25, 1]]) {
    for (let i = 0; i < tiers - 1; i += 1) {
      const half = (70 - i * 8.4) / 2
      blocks.addOn(x + ox * (half - 2), i * tierH, z + oz * (half - 2), 3.2, tierH + 0.6, 3.2, '#ff6a1e', STYLE.GLOW)
    }
  }
  // Smoke puffs drifting up and away to the east.
  for (let i = 0; i < 9; i += 1) {
    const s = 6 + i * 1.6
    const shade = Math.min(1, 0.32 + i * 0.07)
    const grey = `rgb(${Math.round(70 * shade + 40)}, ${Math.round(58 * shade + 34)}, ${Math.round(58 * shade + 34)})`
    props.add(sphere, { position: [x + i * 3.4 + Math.sin(i * 1.7) * 3, top + 6 + i * 6.5, z - i * 1.2], scale: [s, s * 0.75, s], color: grey })
  }
}
