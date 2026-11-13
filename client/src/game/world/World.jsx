import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import { Group, Mesh, SphereGeometry } from 'three'

import { useGame } from '../../store/game'
import { useQuality } from '../../store/quality'
import { asToyInstance, BlockSet, disposeBlocks, PropBuilder } from '../blocks'
import { glowTime } from '../glow'
import { createToyMaterial, GRASS_COLOR, sharedMaterials, toyTime } from '../materials'
import { venueOf } from '../sceneStyle'
import { createGroundGeometry, createGroundMap } from './ground'
import { buildEggStands } from './eggs'
import { buildPortalFrame } from './portalFrame'
import { createPaintedSigns } from './signs'
import { buildRollZone } from './rollZone'
import { buildBallShop, buildPads, buildShop, createCageNets } from './structures'
import { buildHills, buildVolcano } from './hills'
import { addFloodlight, addScoreboard } from './terrain'
import Ocean from './Ocean'

/** The volcano's smoke puffs: low-poly, they're seen from far off. */
const SMOKE = new SphereGeometry(1, 10, 7)

/** The ballpark's floodlight towers, out on the hills at the plaza's four corners. */
const FLOODLIGHTS = [
  [48, 78],
  [-58, 78],
  [46, -48],
  [-46, -48],
]

/**
 * The static lobby: ground plane, every box (hills, trees, cages, stands, stalls) in one
 * InstancedMesh, and every non-box prop (mats, balls, plates...) merged into one mesh, the
 * painted signs (one atlas, one mesh) and the batting cages' netting (one see-through
 * mesh). Five draw calls for the whole environment - six in Lava Land, whose lava sea is
 * a plane of its own.
 *
 * Built for the world you're in (its venue: sceneStyle VENUES) and rebuilt, the old one
 * disposed, when you step through the portal (the screen is faded out for it). Quality only
 * decides decor density at build time and whether the result casts/receives realtime
 * shadows.
 */
export function World() {
  const shadows = useQuality((s) => s.settings.shadows === 'realtime')
  const playable = useGame((s) => s.playable)
  const world = useGame((s) => s.profile.world || 0)
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  const [signs, setSigns] = useState([])
  const venue = venueOf(world)

  // Drives every animated toy-material style (water, lava...) and the lava sea.
  useFrame((state) => {
    toyTime.value = state.clock.elapsedTime
    glowTime.value = state.clock.elapsedTime
  })

  // The hills' caps (and every grass cap in this world): green at the ballpark, ash in Lava Land.
  useEffect(() => {
    GRASS_COLOR.set(venueOf(world).hills.grass ?? '#4fd93a')
  }, [world])

  // The painted lettering waits until the game is on screen and the browser is idle
  // (painting its atlas was ~170 ms of a slow phone's start-up), and its shader is
  // compiled before it shows, so it can't stall a frame - as the world labels do.
  useEffect(() => {
    if (!playable) return undefined
    let made = []
    let cancelled = false
    const dispose = (list) => {
      for (const sign of list) {
        sign.geometry.dispose()
        sign.material.dispose()
        sign.texture.dispose()
      }
    }
    const idle = new Promise((resolve) =>
      'requestIdleCallback' in window ? requestIdleCallback(resolve, { timeout: 1000 }) : setTimeout(resolve, 200),
    )
    idle
      .then(() => (cancelled ? [] : createPaintedSigns(useQuality.getState().settings.maxTexture, world)))
      .then(async (list) => {
        if (cancelled) {
          dispose(list)
          return
        }
        made = list
        const probe = new Group()
        for (const sign of list) probe.add(new Mesh(sign.geometry, sign.material))
        // (Not in dev: StrictMode's remount disposes materials mid-compile - ShaderWarmup.)
        if (!import.meta.env.DEV) await gl.compileAsync(probe, camera, scene).catch(() => null)
        if (!cancelled) setSigns(list)
      })
    return () => {
      cancelled = true
      dispose(made)
    }
  }, [playable, gl, camera, scene, world])

  const { blocks, ground, props, nets } = useMemo(() => {
    performance.mark('pp:world-start')
    const { decorDensity, maxTexture } = useQuality.getState().settings
    const v = venueOf(world)
    const set = new BlockSet()
    const propBuilder = new PropBuilder()
    // Hills all round the canyon (basalt and a volcano in Lava Land), the scoreboard on
    // the south ones, a floodlight tower at each corner.
    buildHills(set, { density: decorDensity, venue: v })
    addScoreboard(set, v)
    for (const [x, z] of FLOODLIGHTS) addFloodlight(set, x, z, v)
    if (v.lava) buildVolcano(set, propBuilder, SMOKE)
    buildPads(set, propBuilder)
    buildShop(set, { detail: decorDensity >= 0.75, world })
    buildBallShop(set, propBuilder, { world })
    buildRollZone(set, propBuilder, { detail: decorDensity >= 0.75, world })
    buildPortalFrame(set)
    buildEggStands(set)

    const map = createGroundMap(maxTexture, world)
    const groundMaterial = createToyMaterial({ instanced: false, vertexColors: false, map, studScale: 2 })

    performance.mark('pp:world-end')
    return {
      blocks: set.build(sharedMaterials().blocks),
      props: asToyInstance(propBuilder.build(), sharedMaterials().toy),
      ground: { geometry: createGroundGeometry(world), material: groundMaterial, map },
      nets: createCageNets(),
    }
  }, [world])

  useEffect(
    () => () => {
      disposeBlocks(blocks)
      props.geometry.dispose()
      props.dispose()
      ground.geometry.dispose()
      ground.material.dispose()
      ground.map.dispose()
      nets.geometry.dispose()
      nets.material.dispose()
      nets.texture.dispose()
    },
    [blocks, ground, props, nets],
  )

  return (
    <>
      <mesh geometry={ground.geometry} material={ground.material} receiveShadow={shadows} />
      <primitive object={blocks} castShadow={shadows} receiveShadow={shadows} />
      <primitive object={props} castShadow={shadows} receiveShadow={shadows} />
      <mesh geometry={nets.geometry} material={nets.material} renderOrder={1} />
      {venue.lava && <Ocean />}
      {signs.map((sign) => (
        <mesh key={sign.texture.uuid} geometry={sign.geometry} material={sign.material} position={sign.position} rotation={sign.rotation} renderOrder={1} />
      ))}
    </>
  )
}

export default World
