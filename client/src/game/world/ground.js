import {
  BufferAttribute,
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three'

import { mulberry32 } from '@shared/rng'
import {
  BALL_SHOP,
  HOME_PLATE,
  PAD_COUNT,
  PAD_RADIUS,
  PAD_X,
  padCenterZ,
  PATH_HALF,
  PLAZA,
  PORTALS,
  ROLL_ZONE,
  SCREEN,
  SHOP,
  STATIONS,
  COURT_BACK_X,
  TRACK_START_Z,
} from '@shared/world'

import { venueOf } from '../sceneStyle'

/**
 * The plaza floor: one big plane whose colours come from a "ground map" texture painted in
 * world units (a few texels to the metre). The lawn's mown stripes, the walking path from
 * spawn, the bat shop's yard, the turf under the batting cages, the portal's rings and the
 * infield's row of batting stations - the dirt strip under the plates, each station's
 * chalked batter's box and its number, its lane's chalk line, the foul lines - are painted into
 * it, so the whole floor is a single draw call however many regions it has. (The plates,
 * catcher's screens standing on it are geometry: rollZone.js.) In Lava Land the
 * lawn is ash and basalt, split by glowing lava cracks.
 */

const MAP = { minX: -64, maxX: 64, minZ: -44, maxZ: PLAZA.maxZ + 12 }
const MAP_W = MAP.maxX - MAP.minX
const MAP_H = MAP.maxZ - MAP.minZ

/** Where the ground plane ends to the north: the outfield's own floor takes over there. */
export const GROUND_NORTH_EDGE = TRACK_START_Z


/** A canvas drawn on in world metres: x east, z south (the map's +v is north). */
function worldCanvas(texelsPerMetre) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(MAP_W * texelsPerMetre)
  canvas.height = Math.round(MAP_H * texelsPerMetre)
  const ctx = canvas.getContext('2d')
  ctx.setTransform(texelsPerMetre, 0, 0, texelsPerMetre, -MAP.minX * texelsPerMetre, -MAP.minZ * texelsPerMetre)
  return { canvas, ctx }
}

function painter(ctx) {
  const rect = (r, color) => {
    ctx.fillStyle = color
    ctx.fillRect(r.minX, r.minZ, r.maxX - r.minX, r.maxZ - r.minZ)
  }
  const disc = (x, z, radius, color) => {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x, z, radius, 0, Math.PI * 2)
    ctx.fill()
  }
  const ring = (x, z, radius, width, color) => {
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.beginPath()
    ctx.arc(x, z, radius, 0, Math.PI * 2)
    ctx.stroke()
  }
  const line = (x0, z0, x1, z1, width, color) => {
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.lineCap = 'butt'
    ctx.beginPath()
    ctx.moveTo(x0, z0)
    ctx.lineTo(x1, z1)
    ctx.stroke()
  }
  const outline = (x, z, w, d, width, color) => {
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.strokeRect(x - w / 2, z - d / 2, w, d)
  }
  return { rect, disc, ring, line, outline }
}

/** The ground map for `world`'s venue: lawn, path, diamond (and Lava Land's cracks). */
export function createGroundMap(maxTexture, world = 0) {
  const v = venueOf(world)
  const texels = maxTexture >= 1024 ? 8 : 4
  const { canvas, ctx } = worldCanvas(texels)
  const paint = painter(ctx)

  paintLawn(paint, v.ground)
  if (v.ground.cracks) paintCracks(ctx, v.ground.cracks)
  paintPath(paint, v.ground)
  paintStations(ctx, paint, v.ground)

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.magFilter = LinearFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.anisotropy = maxTexture > 512 ? 4 : 1
  return texture
}

/** Mown lawn in 4 m stripes, the bat shop's yard, the cages' turf, the ball shop's patio, the portal's rings. */
function paintLawn({ rect, disc }, G) {
  rect(MAP, G.grass[0])
  for (let z = MAP.minZ, k = 0; z < MAP.maxZ; z += 4, k += 1) rect({ minX: MAP.minX, maxX: MAP.maxX, minZ: z, maxZ: z + 4 }, G.grass[k % 2])
  rect(SHOP, G.yard)
  // Darker turf under the row of batting cages.
  rect({ minX: PAD_X - PAD_RADIUS - 1.2, maxX: COURT_BACK_X + 0.8, minZ: padCenterZ(PAD_COUNT - 1) - 3.6, maxZ: padCenterZ(0) + 3.6 }, G.cages)
  // The ball shop's patio in front of its counter.
  disc(BALL_SHOP.x, BALL_SHOP.z, BALL_SHOP.radius + 1.2, G.edge)
  disc(BALL_SHOP.x, BALL_SHOP.z, BALL_SHOP.radius + 0.9, G.path[0])
  for (const p of PORTALS) {
    disc(p.x, p.z, 6, G.ring)
    disc(p.x, p.z, 5, G.portal)
  }
}

/**
 * The walking path from spawn up to the batting stations, white-edged, in light and dark
 * 4 m bands, and the concourse across the infield's back, behind the catcher's screens.
 */
function paintPath({ rect }, G) {
  const top = SCREEN.z + 2.4
  rect({ minX: -PATH_HALF - 0.5, maxX: PATH_HALF + 0.5, minZ: top, maxZ: PLAZA.maxZ }, G.edge)
  for (let z = top, k = 0; z < PLAZA.maxZ; z += 4, k += 1) {
    rect({ minX: -PATH_HALF, maxX: PATH_HALF, minZ: z, maxZ: Math.min(PLAZA.maxZ, z + 4) }, G.path[k % 2])
  }
  rect({ minX: ROLL_ZONE.minX - 0.5, maxX: ROLL_ZONE.maxX + 0.5, minZ: ROLL_ZONE.maxZ, maxZ: top + 0.5 }, G.edge)
  rect({ minX: ROLL_ZONE.minX, maxX: ROLL_ZONE.maxX, minZ: ROLL_ZONE.maxZ, maxZ: top }, G.path[1])
}

/**
 * The infield (ROLL_ZONE) and its row of batting stations: striped infield grass, a long
 * dirt strip under the plates, each station's batter's box chalked beside its plate and
 * its number painted in the dirt behind it, a chalk line from each plate up its lane to
 * the field, and the two foul lines from the row's ends out to the field's edges.
 */
function paintStations(ctx, { rect, line, outline }, G) {
  const pz = HOME_PLATE.z
  // Infield grass, striped across.
  rect(ROLL_ZONE, G.infield[0])
  for (let z = ROLL_ZONE.minZ, k = 0; z < ROLL_ZONE.maxZ; z += 2.5, k += 1) {
    rect({ minX: ROLL_ZONE.minX, maxX: ROLL_ZONE.maxX, minZ: z, maxZ: Math.min(ROLL_ZONE.maxZ, z + 2.5) }, G.infield[k % 2])
  }
  const left = STATIONS[0].x - 2
  const right = STATIONS[STATIONS.length - 1].x + 2
  // The batting strip under the plates (to the screens behind), the pitching strip under the mounds.
  rect({ minX: left - 0.3, maxX: right + 0.3, minZ: pz - 2.3, maxZ: SCREEN.z + 0.5 }, G.dirtDark)
  rect({ minX: left, maxX: right, minZ: pz - 2, maxZ: SCREEN.z + 0.2 }, G.dirt)
  ctx.font = 'bold 1.1px "Fredoka One", "Arial Rounded MT Bold", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const s of STATIONS) {
    // From the plate up its lane to the field.
    line(s.x, pz - 2.4, s.x, GROUND_NORTH_EDGE, 0.05, G.chalk)
    // The batter's box, west of the plate where you stand.
    outline(s.spotX, s.spotZ, 1.0, 1.7, 0.08, G.chalk)
    // Its number, behind the plate.
    ctx.fillStyle = G.chalk
    ctx.fillText(String(s.index + 1), s.x, pz + 1.55)
  }
  // The foul lines, from the row's ends out to the field's edges.
  const reach = pz - GROUND_NORTH_EDGE
  line(left + 0.4, pz - 0.6, left + 0.4 - reach * 0.12, GROUND_NORTH_EDGE, 0.16, G.chalk)
  line(right - 0.4, pz - 0.6, right - 0.4 + reach * 0.12, GROUND_NORTH_EDGE, 0.16, G.chalk)
}

/**
 * Lava Land's cracks: jagged glowing seams wandering across the ash, from a seed (the
 * same on every client), each a dark scorched edge round a bright core.
 */
function paintCracks(ctx, color) {
  const rand = mulberry32(77)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  for (let i = 0; i < 46; i += 1) {
    let x = MAP.minX + rand() * MAP_W
    let z = MAP.minZ + rand() * MAP_H
    let a = rand() * Math.PI * 2
    const points = [[x, z]]
    const steps = 3 + Math.floor(rand() * 5)
    for (let s = 0; s < steps; s += 1) {
      a += (rand() - 0.5) * 1.6
      const len = 1.5 + rand() * 3.5
      x += Math.cos(a) * len
      z += Math.sin(a) * len
      points.push([x, z])
    }
    const width = 0.18 + rand() * 0.3
    for (const [w, c] of [[width * 3.2, 'rgba(20, 8, 6, 0.55)'], [width * 1.6, '#c2300a'], [width, color], [width * 0.4, '#ffd27a']]) {
      ctx.strokeStyle = c
      ctx.lineWidth = w
      ctx.beginPath()
      points.forEach(([px, pz], j) => (j ? ctx.lineTo(px, pz) : ctx.moveTo(px, pz)))
      ctx.stroke()
    }
  }
}

/** How far the ground runs out in Lava Land before the lava sea (Ocean.jsx) takes over. */
export const SEA_EDGE = 118

/**
 * The ground plane, with UVs computed from world position so the map lands exactly
 * on the world grid. Outside the map, clamp-to-edge repeats the lawn's colour. In Lava
 * Land it stops at SEA_EDGE, and the lava sea runs on from there.
 */
export function createGroundGeometry(world = 0) {
  const reach = venueOf(world).lava ? SEA_EDGE : 280
  const minX = -reach
  const maxX = reach
  const minZ = GROUND_NORTH_EDGE
  const maxZ = reach
  const geometry = new PlaneGeometry(maxX - minX, maxZ - minZ)
  geometry.rotateX(-Math.PI / 2)
  geometry.translate((minX + maxX) / 2, 0, (minZ + maxZ) / 2)

  const position = geometry.getAttribute('position')
  const uv = geometry.getAttribute('uv')
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i)
    const z = position.getZ(i)
    uv.setXY(i, (x - MAP.minX) / MAP_W, 1 - (z - MAP.minZ) / MAP_H)
  }
  uv.needsUpdate = true
  geometry.setAttribute('aStyle', new BufferAttribute(new Float32Array(position.count), 1))
  return geometry
}
