/**
 * The scene's whole look in one place: the Sunny Ballpark - a clear blue game-day sky with
 * puffy white clouds and a bright sun, mown-stripe green grass, a brown infield diamond
 * with white chalk round home plate, navy, red and white team colours with gold trim,
 * and green grassy hills with trees all round (hills.js), the endless outfield running
 * off between them (Lane.jsx). World 2, Lava Land, has a venue of its own (VENUES[1]).
 *
 * Colours are sRGB hex, exactly as you would pick them in an image editor.
 *
 * Light intensities are three.js physical units: a light of intensity PI (~3.14)
 * lights a surface facing it to its full texture colour. The cool sky fill plus the warm
 * sun add up to just over that on the ground, which keeps the turf vivid; shadowed ground
 * only gets the cool fill, so shadows read blue and the lit side warm.
 */

/** Style ids from materials.js STYLE (numbers here so this file stays import-free). */
const STYLE_HILL = 14

/** The home team's colours: everything built for the ballpark uses these. */
export const TEAM = {
  blue: '#1f4fd8',
  navy: '#0c2340',
  red: '#d4202f',
  white: '#f4f7fb',
  gold: '#ffc21a',
}

export const SKY = {
  /** Straight up: a deep summer blue. */
  top: '#2a74e0',
  /** At eye level: pale haze. Fog uses the same colour so distant ground melts into the sky. */
  horizon: '#cfe9ff',
  /** Lower = the deep colour reaches further down towards the horizon. */
  exponent: 0.6,
  /** The sun's glow round its direction, and how strong it is. */
  sun: '#ffffff',
  glow: 0.45,
  /** High clouds (0 none, 1 plenty), and stars (night stages only). */
  clouds: 0.85,
  stars: 0,
}

export const FOG = {
  color: SKY.horizon,
}

/** Every surface colour in the lobby. */
export const PALETTE = {
  /** The bat shop's yard. */
  shopFloor: '#e8e2d4',
  /** Rings painted round the portal. */
  apron: TEAM.navy,
  apronEdge: TEAM.gold,
  /** The stands: pale concrete steps (a shade darker every third row), the team's seats. */
  concrete: ['#c9ced6', '#c9ced6', '#b7bdc8'],
  seats: [TEAM.navy, TEAM.red, TEAM.white],
  standBase: '#8c93a1',
  rail: '#ffffff',
  /** Mown turf, light and dark: the lobby lawn and the outfield. */
  turf: ['#3cbf3c', '#4bd148'],
  /** The crowd's shirts: mostly the home team's, a few away fans. */
  crowd: [TEAM.navy, '#ffffff', TEAM.red, '#2f66d6', TEAM.red, '#ffe27a', '#e8eef8', TEAM.navy],
  /** Flags along the roofs. */
  flags: [TEAM.navy, TEAM.white, TEAM.red],
  /** The city round the stadium: hazy blue-grey and dusky purple towers. */
  city: ['#5a6787', '#6b6f8f', '#4f5a7a', '#776c8c', '#5d7290'],
  /** Car park and service roads beyond the stands. */
  asphalt: '#555b68',
}

/**
 * Each world's venue: the colours everything built for it uses, and whether it's the lava
 * world. World 1 is the Sunny Ballpark (navy, red, white and gold, green hills and trees
 * round it); World 2 is Lava Land (basalt, ash and glowing orange: a ballpark on a volcano
 * by a sea of lava, Ocean.jsx). The lobby (World.jsx) and the outfield (Lane.jsx) are built
 * from the one for the world you're in, and rebuilt when you step through the portal.
 *
 *   ground   the lobby floor's paint (ground.js): lawn bands, infield dirt, the path...
 *   hills    the ridges round the lobby: rock by terrace (low to high), their cap style,
 *            the cap colour (materials GRASS_COLOR), glowing lava columns, what grows on them
 *   field    the outfield's own extras (Lane.jsx): its wall, the warning track
 */
export const VENUES = [
  {
    lava: false,
    primary: TEAM.navy,
    dark: '#081a30',
    light: TEAM.white,
    accent: TEAM.gold,
    concrete: PALETTE.concrete,
    wall: '#c4c9d2',
    vip: '#d5dae1',
    glass: '#1c2b46',
    crowd: PALETTE.crowd,
    flags: PALETTE.flags,
    surround: '#3fb23f',
    strip: PALETTE.turf,
    shopFloor: PALETTE.shopFloor,
    ground: {
      grass: ['#3cbf3c', '#4bcf47'],
      dirt: '#c98a52',
      dirtDark: '#b9784a',
      infield: ['#3fc93f', '#4fd84c'],
      chalk: '#ffffff',
      path: ['#d9b98a', '#d0ae7e'],
      edge: '#ffffff',
      ring: TEAM.gold,
      portal: '#7a4cff',
      yard: PALETTE.shopFloor,
      cages: '#2f9a3a',
      cracks: null,
    },
    logo: { rim: TEAM.gold, ring: TEAM.navy, inner: TEAM.red, top: 'SUNNY', bottom: 'BALLPARK' },
    hills: { rock: ['#9a6a3a', '#8d6036', '#805632', '#734d2d', '#664428'], cap: STYLE_HILL, grass: '#4fc93a', lava: null, trees: 'tree' },
    field: { wall: '#1f6b3a', cap: TEAM.gold, track: '#b97a4a', lights: '#fffbe0' },
    /** The scoreboard's face. */
    board: '#10402a',
    endNorth: 'HOME RUN!',
    /** The foul poles and the banner between them, and the bat shop's stages and sign. */
    arch: { pillar: '#ffd21f', base: TEAM.navy, glow: '#fff3b0', crest: TEAM.red },
    shop: { band: TEAM.red, strip: '#ffe27a', post: TEAM.gold, panel: TEAM.navy },
    /** The ball shop's stall: awning stripes, wood, and the balls on its shelves. */
    stall: { awning: [TEAM.red, '#ffffff'], wood: '#a8693a', counter: TEAM.navy, trim: TEAM.gold },
  },
  {
    lava: true,
    primary: '#ff5a14',
    dark: '#2a1214',
    light: '#ffd9a8',
    accent: '#ffb21a',
    concrete: ['#4a3a3a', '#4a3a3a', '#3d3030'],
    wall: '#3a2c2c',
    vip: '#4a3838',
    glass: '#1a0c0c',
    crowd: ['#ff5a14', '#ffd21f', '#2a1214', '#ff8a3a', '#ffffff', '#c8102e', '#ffb21a', '#5a3a3a'],
    flags: ['#ff5a14', '#2a1214', '#ffb21a'],
    surround: '#2c2426',
    strip: ['#3a3034', '#332a2e'],
    shopFloor: '#3a3034',
    ground: {
      grass: ['#4a3d40', '#433639'],
      dirt: '#7a3620',
      dirtDark: '#64291a',
      infield: ['#3a3033', '#342b2e'],
      chalk: '#ffd27a',
      path: ['#241c1f', '#201a1c'],
      edge: '#ff6a1e',
      ring: '#ff8a1e',
      portal: '#ff3b0a',
      yard: '#2e2629',
      cages: '#2a1c1c',
      cracks: '#ff5a14',
    },
    logo: { rim: '#ffb21a', ring: '#2a1214', inner: '#ff5a14', top: 'LAVA LAND', bottom: 'BALLPARK' },
    hills: {
      rock: ['#3e3034', '#372a2e', '#302528', '#2a2023', '#241c1f'],
      cap: STYLE_HILL,
      grass: '#4a3c3c',
      lava: { color: '#ff5a14', chance: 0.14 },
      trees: 'lava',
    },
    field: { wall: '#2a1c1c', cap: '#ff6a1e', track: '#4a2a22', lights: '#ffb06a' },
    board: '#1a0a0a',
    endNorth: 'LAVA LAND',
    arch: { pillar: '#ff8a1e', base: '#2a1214', glow: '#ffd27a', crest: '#ff3b0a' },
    shop: { band: '#ff5a14', strip: '#ffd27a', post: '#ffb21a', panel: '#2a1214' },
    stall: { awning: ['#ff5a14', '#2a1214'], wood: '#4a3030', counter: '#2a1214', trim: '#ffb21a' },
  },
]
export const venueOf = (world) => VENUES[world] ?? VENUES[0]

export const LIGHTS = {
  /** A cool blue fill from the sky, a green bounce off the grass. */
  hemiSky: '#d6e8ff',
  hemiGround: '#a8d890',
  hemiIntensity: 2.0,

  /** A bright, high midday sun. */
  sunColor: '#fff6e6',
  sunIntensity: 1.9,
  /**
   * Direction *towards* the sun: high in the north-west, beyond the far end of the field
   * (the sky's glow sits there too), so shadows fall short and back towards you.
   */
  sunDirection: [-0.4, 0.78, -0.48],
  /** 1 = shadows get no sunlight at all; lower = lighter shadows. */
  shadowIntensity: 0.6,
  /** Blur radius of shadow edges, in shadow-map texels. */
  shadowSoftness: 3,
}

/**
 * Each world's light (Lighting.jsx): the Sunny Ballpark's bright day, and Lava Land's -
 * a red-orange glow from below off the lava and a hot, hazy orange sun.
 */
export const WORLD_LIGHTS = [
  LIGHTS,
  { ...LIGHTS, hemiSky: '#ffb08a', hemiGround: '#7a2a14', hemiIntensity: 1.95, sunColor: '#ffc08a', sunIntensity: 1.7 },
]
export const lightsOf = (world) => WORLD_LIGHTS[world] ?? LIGHTS
