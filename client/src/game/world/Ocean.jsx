import { useEffect, useMemo } from 'react'
import { PlaneGeometry, ShaderMaterial, UniformsLib, UniformsUtils } from 'three'

import { toyTime } from '../materials'

/** How far the lava sea reaches: well past the far plane every way, and the whole field's length north. */
const SEA = { minX: -3000, maxX: 3000, minZ: -24000, maxZ: 3000 }
/** Its height: under the lobby's ground (0) and the field's ground (top 0), 30 cm down. */
const SEA_Y = -0.3

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  #include <fog_pars_vertex>
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

/**
 * The lava sea: slabs of dark cooling crust drifting on molten rock, the cracks between
 * them glowing orange to white-hot, slow heaving swells of brighter magma rolling through
 * and a pulse of heat - all from world position and the shared clock, so it costs one
 * cheap unlit pass and nothing on the CPU. Brighter (hotter) close in round the ballpark;
 * fogs into the volcanic haze at the horizon.
 */
const fragmentShader = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorld;
  #include <fog_pars_fragment>
  float lHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  // Distance to the nearest edge between crust slabs (a cheap 3x3 cell walk).
  float lEdge(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float d1 = 8.0;
    float d2 = 8.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 g = vec2(float(x), float(y));
        vec2 o = vec2(lHash(i + g), lHash(i + g + 19.3));
        vec2 r = g + o - f;
        float d = dot(r, r);
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
      }
    }
    return sqrt(d2) - sqrt(d1);
  }
  void main() {
    vec2 p = vWorld.xz;
    vec2 drift = vec2(uTime * 0.4, uTime * 0.15);
    float edge = lEdge((p + drift) * 0.09);
    float crack = 1.0 - smoothstep(0.02, 0.16, edge);
    float swell = sin(p.x * 0.05 + p.y * 0.035 + uTime * 0.6) + 0.6 * sin(p.x * 0.021 - p.y * 0.063 - uTime * 0.45);
    float near = 1.0 - smoothstep(110.0, 300.0, length(p - vec2(0.0, 20.0)));
    vec3 crust = vec3(0.10, 0.04, 0.035) + vec3(0.12, 0.03, 0.0) * clamp(swell * 0.5 + 0.5, 0.0, 1.0);
    vec3 molten = mix(vec3(0.95, 0.22, 0.02), vec3(1.0, 0.62, 0.12), clamp(0.5 + 0.35 * swell, 0.0, 1.0));
    float heat = clamp(crack + smoothstep(1.2, 1.6, swell) * 0.5 + near * 0.12, 0.0, 1.0);
    vec3 col = mix(crust, molten, heat);
    // White-hot cores down the middle of the widest cracks, flickering.
    float core = (1.0 - smoothstep(0.0, 0.05, edge)) * (0.75 + 0.25 * sin(uTime * 3.0 + p.x * 0.3));
    col = mix(col, vec3(1.0, 0.88, 0.55), core * 0.6);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

/**
 * Lava Land's sea of lava, all round the ballpark beyond the ground's edge and along the
 * field, to the horizon. One draw call (World.jsx mounts it in Lava Land only); animated
 * through the shared clock (toyTime) only.
 */
export function Ocean() {
  const { geometry, material } = useMemo(() => {
    const g = new PlaneGeometry(SEA.maxX - SEA.minX, SEA.maxZ - SEA.minZ)
    g.rotateX(-Math.PI / 2)
    g.translate((SEA.minX + SEA.maxX) / 2, SEA_Y, (SEA.minZ + SEA.maxZ) / 2)
    const m = new ShaderMaterial({
      uniforms: UniformsUtils.merge([UniformsLib.fog, { uTime: { value: 0 } }]),
      vertexShader,
      fragmentShader,
      fog: true,
    })
    // The shared clock itself, so the lava moves without any per-frame work here.
    m.uniforms.uTime = toyTime
    return { geometry: g, material: m }
  }, [])

  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  return <mesh geometry={geometry} material={material} frustumCulled={false} />
}

export default Ocean
