import { Matrix4, Quaternion, Vector3 } from 'three'

/**
 * The player's body language, shared by the Bloxity avatar and the blocky stand-in so
 * both move the same way - and where their bat is.
 *
 * `computePose` turns the motion state into joint angles, and the bat's place and turn;
 * each avatar applies them to its own limbs and bat. Angles are radians in character
 * space (the character faces +Z, its left side is +X), about each joint's pivot:
 *   swing - about X: negative swings a hanging limb forward (arm up in front, knee up);
 *           on the spine and neck, which point up, negative bends them back
 *   sway  - about Z: positive moves a limb towards +X
 *   twist - about Y: positive turns the right shoulder forward (the chest towards +X)
 * `lift` raises (or, to keep bent legs on the ground, lowers) the body, in metres.
 * `stretchL` / `stretchR` are how long each arm is against its rest length (1 = normal;
 * a hair either way so both hands land on the bat's handle).
 *
 * The bat (`pose.bat`): `mode` 'back' (strapped across your back while you walk about -
 * drawn big, BACK_SCALE, so everyone's bat shows), 'hand' (gripped in both hands:
 * batting) or 'none'; `pos` its grip, `quat` its turn and `scale` its size, in character
 * space, metres - the bat's own frame is bats.js's: grip at the origin, the
 * bat along +Y, its hitting face +Z.
 *
 * A right-handed batter: side-on to the pitch, front (left) shoulder to the pitcher, who
 * is off to the character's left (+X); the plate is in front (+Z). The same swing serves
 * home plate (the batter faces east, the mound north) and the cages (facing south, the
 * machine east): both put the pitch on the left.
 */

export const POSED_BONES = ['Spine1', 'Neck1', 'ArmL1', 'ArmL2', 'ArmR1', 'ArmR2', 'LegL1', 'LegL2', 'LegR1', 'LegR2']

/** Written by `computePose` every frame; one shared result, never reallocated. */
export const pose = {
  lift: 0,
  stretchL: 1,
  stretchR: 1,
  bones: Object.fromEntries(POSED_BONES.map((name) => [name, { swing: 0, sway: 0, twist: 0 }])),
  bat: { mode: 'back', pos: new Vector3(), quat: new Quaternion(), scale: 1 },
}

/**
 * The 1.8 m character's measurements: shoulder height and how far out from the middle,
 * arm length (shoulder to palm), and the pivot the upper body turns about (its middle).
 * Measured on Bloxity's player.glb fitted to 1.8 m (the shoulder joint sits at 1.35 m,
 * 0.56 m out, and the arm reaches 0.675 m to the bottom of the hand). Avatars whose arms
 * are a different length rescale the stretch (avatarRig.animateRig).
 */
export const BODY = { shoulderY: 1.35, shoulderX: 0.56, arm: 0.63, pivot: 0.9 }

/** Sway sign that moves a limb away from the body, per side. */
const OUT_L = 1
const OUT_R = -1

const clamp01 = (x) => Math.min(1, Math.max(0, x))
const lerp = (a, b, t) => a + (b - a) * t
const smooth = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/** Adds to a joint, scaled by weight `w`. */
function add(name, swing, sway, twist, w) {
  const b = pose.bones[name]
  b.swing += swing * w
  b.sway += sway * w
  b.twist += twist * w
}

// --- Walking about ------------------------------------------------------------------

/** Relaxed stance: knees soft, breathing. */
function stance(w, time) {
  const breath = Math.sin(time * 1.8)
  add('LegL1', -0.04, 0.05 * OUT_L, 0, w)
  add('LegL2', 0.07, 0, 0, w)
  add('LegR1', 0.04, 0.05 * OUT_R, 0, w)
  add('LegR2', 0.07, 0, 0, w)
  add('Spine1', 0.03 + breath * 0.015, 0, 0, w)
  add('ArmL1', 0.04 + breath * 0.02, 0.1 * OUT_L, 0, w)
  add('ArmR1', 0.04 - breath * 0.02, 0.1 * OUT_R, 0, w)
  add('ArmL2', -0.12, 0, 0, w)
  add('ArmR2', -0.12, 0, 0, w)
  pose.lift += (-0.01 + breath * 0.006) * w
}

/**
 * Walk to sprint: the legs swing, the arms swing against them and the body bobs once
 * per step. `phase` advances faster with speed, so the steps quicken.
 */
function stride(phase, ratio) {
  const cycle = Math.sin(phase)
  const leg = 0.85 * ratio
  add('LegL1', cycle * leg, 0, 0, 1)
  add('LegR1', -cycle * leg, 0, 0, 1)
  // Knees fold on the back swing only.
  add('LegL2', Math.max(0, -cycle) * 1.1 * ratio, 0, 0, 1)
  add('LegR2', Math.max(0, cycle) * 1.1 * ratio, 0, 0, 1)
  // Arms against the legs, elbows bending more the faster you go.
  const arm = 0.75 * ratio
  add('ArmL1', -cycle * arm, 0.08 * OUT_L * ratio, 0, 1)
  add('ArmR1', cycle * arm, 0.08 * OUT_R * ratio, 0, 1)
  add('ArmL2', -0.35 * ratio, 0, 0, 1)
  add('ArmR2', -0.35 * ratio, 0, 0, 1)
  add('Spine1', (0.06 + 0.1 * ratio) * ratio, 0, cycle * 0.12 * ratio, 1)
  pose.lift += (Math.abs(Math.cos(phase)) * 0.05 - 0.015) * ratio
}

/**
 * In the air: one knee up on the way up, arms flung up and out; falling, the legs
 * straighten and reach down for the ground.
 */
function airborne(vy) {
  const f = smooth(0, 1, clamp01((2 - vy) / 9))
  add('LegL1', lerp(-1.3, -0.35, f), 0.08 * OUT_L, 0, 1)
  add('LegL2', lerp(1.6, 0.25, f), 0, 0, 1)
  add('LegR1', lerp(0.25, -0.1, f), 0.08 * OUT_R, 0, 1)
  add('LegR2', lerp(0.5, 0.2, f), 0, 0, 1)
  add('Spine1', lerp(0.15, -0.06, f), 0, 0, 1)
  add('ArmL1', lerp(-2.6, -0.5, f), lerp(0.5, 0.35, f) * OUT_L, 0, 1)
  add('ArmR1', lerp(-2.6, -0.5, f), lerp(0.5, 0.35, f) * OUT_R, 0, 1)
}

/** Arms up and waving, bouncing on the spot: a celebration. */
function cheering(time, w) {
  const wave = Math.sin(time * 10) * 0.28
  add('ArmL1', -2.7 + wave, 0.38 * OUT_L, 0, w)
  add('ArmR1', -2.7 - wave, 0.38 * OUT_R, 0, w)
  add('ArmL2', -0.25, 0, 0, w)
  add('ArmR2', -0.25, 0, 0, w)
  add('LegL1', -0.12, 0.06 * OUT_L, 0, w)
  add('LegR1', -0.12, 0.06 * OUT_R, 0, w)
  add('LegL2', 0.22, 0, 0, w)
  add('LegR2', 0.22, 0, 0, w)
  add('Spine1', -0.1, 0, 0, w)
  add('Neck1', -0.15, 0, 0, w)
  pose.lift += Math.abs(Math.sin(time * 7)) * 0.16 * w
}

// --- The bat --------------------------------------------------------------------------

/**
 * Strapped across the back, drawn big so it shows from every side: the handle standing up
 * over the right shoulder beside the head, the barrel sticking out past the left hip.
 * Held off the back far enough that the fat barrel never sinks into the body.
 */
const BACK_SCALE = 1.45
const BACK_GRIP = new Vector3(-0.36, 1.86, -0.34)
const BACK_DIR = new Vector3(0.62, -0.78, -0.03).normalize()
const BACK_FACE = new Vector3(0, 0, -1)

const _x = new Vector3()
const _y = new Vector3()
const _z = new Vector3()
const _v = new Vector3()
const _q = new Quaternion()
const _ax = new Vector3(1, 0, 0)
const _ay = new Vector3(0, 1, 0)

/** Turns the bat so its +Y runs along `dir` and its hitting face (+Z) towards `face`. */
function batTurn(dir, face, out) {
  _y.copy(dir).normalize()
  _z.copy(face).addScaledVector(_y, -face.dot(_y))
  if (_z.lengthSq() < 1e-6) _z.set(0, 0, 1).addScaledVector(_y, -_y.z)
  _z.normalize()
  _x.crossVectors(_y, _z)
  // makeBasis wants columns: x, y, z.
  out.setFromRotationMatrix(_m4.makeBasis(_x, _y, _z))
  return out
}
const _m4 = new Matrix4()

/**
 * The upper body's turn: bent forward `swing` about the hips, then twisted `twist`; for
 * carrying things that ride on it (the bat on your back) and aiming the arms from it.
 */
function upperBody(swing, twist, out) {
  out.setFromAxisAngle(_ax, swing)
  return out.multiply(_q.setFromAxisAngle(_ay, twist))
}

const _spine = new Quaternion()
const _spineInv = new Quaternion()
const _shoulder = new Vector3()
const _d = new Vector3()

/**
 * Points one arm (`side` +1 left, -1 right) from its shoulder at `target` (character
 * space, metres), the upper body bent `spineSwing` and twisted `spineTwist`, and
 * stretches it - within reason - to reach: both hands land on the bat's handle.
 */
function aimArmAt(side, target, spineSwing, spineTwist, w) {
  upperBody(spineSwing, spineTwist, _spine)
  _spineInv.copy(_spine).invert()
  // The shoulder, turned with the upper body about its pivot.
  _shoulder.set(side * BODY.shoulderX, BODY.shoulderY - BODY.pivot, 0).applyQuaternion(_spine)
  _shoulder.y += BODY.pivot + pose.lift
  // Shoulder to target, in the upper body's own frame (the arm's parent).
  _d.subVectors(target, _shoulder).applyQuaternion(_spineInv)
  const len = Math.max(0.05, _d.length())
  const out = side * _d.x
  const sway = Math.asin(Math.min(1, Math.max(-1, out / len)))
  const swing = Math.atan2(-_d.z, -_d.y)
  const name = side > 0 ? 'ArmL1' : 'ArmR1'
  add(name, swing, sway * (side > 0 ? OUT_L : OUT_R), 0, w)
  const stretch = Math.min(1.22, Math.max(0.72, len / (BODY.arm + 0.045))) - 1
  if (side > 0) pose.stretchL += stretch * w
  else pose.stretchR += stretch * w
}

// --- Batting --------------------------------------------------------------------------

/**
 * The swing, as keyframes over its progress `s` (0 loaded, 0.5 the bat meets the ball,
 * 1 the finish): the bat's heading `phi` (radians about the vertical: 0 points it out over
 * the plate, +Z; PI/2 at the pitcher, +X - it comes round from behind your right side,
 * through the zone and on round over your left shoulder: 2 PI in all), its elevation
 * `elev` (up from level), where the hands are (x, y, z, character space), and how far the
 * upper body has turned (`twist`, from coiled away from the pitcher to facing them).
 */
const SWING_KEYS = [
  { s: 0, phi: Math.PI + 0.35, elev: 0.95, hx: -0.16, hy: 1.47, hz: 0.14, twist: -0.42 },
  { s: 0.06, phi: Math.PI + 0.46, elev: 1.05, hx: -0.21, hy: 1.5, hz: 0.1, twist: -0.5 },
  { s: 0.28, phi: Math.PI * 1.55, elev: 0.32, hx: -0.12, hy: 1.17, hz: 0.28, twist: -0.1 },
  { s: 0.5, phi: Math.PI * 2 + 0.2, elev: -0.06, hx: 0.08, hy: 1.02, hz: 0.38, twist: 0.38 },
  { s: 0.72, phi: Math.PI * 2.5 + 0.1, elev: 0.25, hx: 0.28, hy: 1.18, hz: 0.28, twist: 0.85 },
  { s: 1, phi: Math.PI * 3 - 0.25, elev: 0.85, hx: 0.3, hy: 1.48, hz: 0.04, twist: 1.1 },
]
/** Keyframes of the reset between cage swings: on round, over your head, back to loaded. */
const RESET_KEYS = [
  { s: 0, phi: Math.PI * 3 - 0.25, elev: 0.85, hx: 0.3, hy: 1.48, hz: 0.04, twist: 1.1 },
  { s: 0.5, phi: Math.PI * 3 + 0.05, elev: 1.2, hx: 0.04, hy: 1.66, hz: -0.02, twist: 0.35 },
  { s: 1, phi: Math.PI * 3 + 0.35, elev: 0.95, hx: -0.16, hy: 1.47, hz: 0.14, twist: -0.42 },
]

/** The swing's timing (seconds from pressing SWING): a little more coil, the drive, contact. */
export const SWING_CONTACT = 0.14
const SWING_LOAD = 0.06
const SWING_FINISH = 0.38

/** Swing progress (0-1, see SWING_KEYS) `t` seconds after the swing starts. */
export function swingProgress(t) {
  if (t <= 0) return 0
  if (t < SWING_LOAD) return 0.06 * (t / SWING_LOAD)
  if (t < SWING_CONTACT) {
    // The drive: accelerating into the ball.
    const u = (t - SWING_LOAD) / (SWING_CONTACT - SWING_LOAD)
    return 0.06 + 0.44 * u * u * (1.6 - 0.6 * u)
  }
  if (t < SWING_FINISH) {
    // Through and round, slowing into the finish.
    const u = (t - SWING_CONTACT) / (SWING_FINISH - SWING_CONTACT)
    return 0.5 + 0.5 * (1 - (1 - u) * (1 - u))
  }
  return 1
}

const _key = { phi: 0, elev: 0, hx: 0, hy: 0, hz: 0, twist: 0 }
const KEY_FIELDS = Object.keys(_key)

/** Samples `keys` at progress `s` (smoothly between keys) into _key. */
function sampleKeys(keys, s) {
  let i = 1
  while (i < keys.length - 1 && keys[i].s < s) i += 1
  const a = keys[i - 1]
  const b = keys[i]
  const u = clamp01((s - a.s) / Math.max(1e-6, b.s - a.s))
  const k = u * u * (3 - 2 * u) * 0.35 + u * 0.65
  for (const f of KEY_FIELDS) _key[f] = a[f] + (b[f] - a[f]) * k
  return _key
}

const _grip = new Vector3()
const _dir = new Vector3()
const _face = new Vector3()
const _hand = new Vector3()

/**
 * Poses the arms on the bat and puts the bat in your hands, from a sampled key (_key):
 * the hands together on the handle (the left below the right), the bat out along its
 * heading, its face towards where it's swinging. `spineSwing` is the forward bend.
 */
function gripBat(key, spineSwing, w, waggle = 0, leftW = w) {
  const elev = key.elev + waggle
  _dir.set(Math.cos(elev) * Math.sin(key.phi), Math.sin(elev), Math.cos(elev) * Math.cos(key.phi))
  _grip.set(key.hx, key.hy + pose.lift, key.hz)
  // The face looks the way the barrel is swinging (round the body, +phi).
  _face.set(Math.cos(key.phi), 0, -Math.sin(key.phi))
  aimArmAt(-1, _hand.copy(_grip).addScaledVector(_dir, 0.05), spineSwing, key.twist, w)
  aimArmAt(1, _hand.copy(_grip).addScaledVector(_dir, -0.08), spineSwing, key.twist, leftW)
  pose.bat.mode = 'hand'
  pose.bat.scale = 1
  pose.bat.pos.copy(_grip)
  batTurn(_dir, _face, pose.bat.quat)
}

/**
 * The batting stance's legs: feet wide, knees bent, weight back; `s` (0-1) carries it
 * through the swing - the front foot lifting and striding at the pitcher, the hips firing
 * and the back foot pivoting onto its toe.
 */
function battingLegs(s, w) {
  const stride = smooth(0.02, 0.18, s) * (1 - smooth(0.2, 0.42, s))
  const fire = smooth(0.25, 0.6, s)
  add('LegL1', -0.22 - 0.35 * stride + 0.12 * fire, (0.26 + 0.1 * stride) * OUT_L, 0.3 * fire, w)
  add('LegL2', 0.36 + 0.45 * stride - 0.2 * fire, 0, 0, w)
  add('LegR1', -0.18 + 0.15 * fire, (0.24 - 0.06 * fire) * OUT_R, 0.45 * fire, w)
  add('LegR2', 0.34 + 0.4 * fire, 0, 0, w)
  pose.lift -= (0.09 - 0.03 * fire) * w
}

/**
 * Up at bat, waiting on the pitch: in the stance, the bat cocked over the back shoulder
 * and waggling, eyes on the pitcher over the front shoulder. `coil` (0-1) is the
 * pitcher's wind-up: you load up as they throw.
 */
function battingReady(time, coil, w, toss = 0, slow = 0) {
  const waggle = Math.sin(time * 4.2) * 0.12 * (1 - coil) * (1 - slow)
  const key = sampleKeys(SWING_KEYS, 0.06 * coil)
  const bend = 0.2
  add('Spine1', bend, 0, key.twist, w)
  // Eyes on the ball: up after the toss, following it down.
  const lookUp = Math.max(toss, slow * (1 - coil))
  add('Neck1', -0.12 - 0.55 * lookUp, 0, Math.min(1.75, 1.25 - key.twist) - 0.5 * lookUp, w)
  battingLegs(0.02 * coil, w)
  pose.lift += Math.sin(time * 4.2 + 1) * 0.012 * w * (1 - slow)
  // The front (left) hand lets go of the bat to flick the ball up, then grips again.
  gripBat(key, bend, w, waggle, w * (1 - toss))
  add('ArmL1', -2.5, 0.25 * OUT_L, 0, w * toss)
}

/**
 * The swing, `t` seconds after it started: coil, stride, the hips and shoulders firing,
 * the bat whipping round through the ball (SWING_CONTACT) and on into a high finish over
 * the front shoulder, held while you watch it go. `power` (0-1) exaggerates it for a
 * better-timed hit.
 */
function battingSwing(t, power, w) {
  const s = swingProgress(t)
  const key = sampleKeys(SWING_KEYS, s)
  const bend = lerp(0.2, 0.04, smooth(0.5, 1, s))
  add('Spine1', bend, 0, key.twist * (1 + 0.12 * power), w)
  // Head still through the zone, then up to watch the ball fly.
  add('Neck1', lerp(-0.12, -0.3 * power, smooth(0.6, 1, s)), 0, lerp(Math.min(1.75, 1.25 - key.twist), 0.25, smooth(0.45, 0.95, s)), w)
  battingLegs(s, w)
  gripBat(key, bend, w)
}

/** Between cage swings: the bat round over your head and back to loaded, `u` (0-1) of the way. */
function battingReset(u, w) {
  const key = sampleKeys(RESET_KEYS, u)
  const bend = lerp(0.04, 0.2, u)
  add('Spine1', bend, 0, key.twist, w)
  add('Neck1', -0.12, 0, Math.min(1.75, 1.25 - key.twist), w)
  battingLegs(lerp(1, 0, smooth(0, 0.7, u)) * 0.6, w)
  gripBat(key, bend, w)
}

/**
 * After the hit: the finish held, then the bat flipped away - spinning end over end - for
 * a cheer with both fists up when it was a great one, or a nod and the bat back over the
 * shoulder when it wasn't. `t` is seconds since the swing, `great` whether to celebrate.
 */
function afterHit(t, great, time, w) {
  const relax = smooth(1.1, 1.6, t)
  if (relax < 1) battingSwing(t, great ? 1 : 0.4, w * (1 - relax))
  if (relax <= 0) return
  if (great) {
    cheering(time, w * relax)
    // The bat, tossed: up and spinning end over end beside you, then gone.
    const flip = t - 1.1
    if (flip < 1.1) {
      const up = 3.2 * flip - 4.6 * flip * flip
      _grip.set(0.55, 1.2 + Math.max(-1.2, up), 0.25 + flip * 0.4)
      _dir.set(0, Math.cos(flip * 13), Math.sin(flip * 13))
      _face.set(1, 0, 0)
      pose.bat.mode = flip < 0.95 ? 'hand' : 'none'
      pose.bat.scale = 1
      pose.bat.pos.copy(_grip)
      batTurn(_dir, _face, pose.bat.quat)
    } else {
      pose.bat.mode = 'none'
    }
  } else {
    stance(w * relax, time)
    // Back over the shoulder once you've let the swing go.
    if (relax > 0.5) batOnBack(0.03)
  }
}

/** The bat strapped across your back, riding with the upper body. */
function batOnBack(spineSwing = 0, twist = 0) {
  upperBody(spineSwing, twist, _spine)
  pose.bat.mode = 'back'
  pose.bat.scale = BACK_SCALE
  _v.copy(BACK_GRIP)
  _v.y -= BODY.pivot
  pose.bat.pos.copy(_v.applyQuaternion(_spine))
  pose.bat.pos.y += BODY.pivot + pose.lift
  batTurn(_dir.copy(BACK_DIR).applyQuaternion(_spine), _face.copy(BACK_FACE).applyQuaternion(_spine), pose.bat.quat)
}

/**
 * Swinging in a batting cage, one swing per pitch (`phase` advances 2 PI each
 * TRAIN_INTERVAL): the swing through the ball, then the bat round over your head and
 * back to loaded for the next. Contact comes CAGE_CONTACT of the way through each cycle.
 */
const CAGE_SWING = 0.62
export const CAGE_CONTACT = (SWING_CONTACT / SWING_FINISH) * CAGE_SWING
function cageSwings(phase, w) {
  const c = (((phase / (Math.PI * 2)) % 1) + 1) % 1
  if (c < CAGE_SWING) battingSwing((c / CAGE_SWING) * SWING_FINISH, 0.6, w)
  else battingReset((c - CAGE_SWING) / (1 - CAGE_SWING), w)
}

/**
 * @param {{ time?: number, speed?: number, maxSpeed?: number, grounded?: boolean,
 *   vy?: number, stride?: number, run?: number, bat?: string, swingT?: number,
 *   coil?: number, great?: boolean, cheer?: number, emote?: string|null }} motion
 *   `run` (0-1) is swinging in a batting cage (`stride` is the swing's phase); the name
 *   is the template's, and what other players are told ('run').
 *   `bat` is 'ready' (up at bat: `toss` 0-1 the front hand flicking the ball up, `coil`
 *   0-1 loading up as it falls, `slow` 0-1 the slow motion of its fall),
 *   'swing' (swinging, `swingT` seconds ago), 'after' (the hit's away: `swingT` seconds
 *   since the swing, `great` whether to celebrate) - or unset: walking about with the bat
 *   on your back. `cheer` (0-1) is celebrating.
 *   `emote` is a Boxity emote id to play over this pose, or null. It isn't posed here:
 *   the Bloxity avatar blends the emote clip on top of this pose (avatarRig.updateEmote),
 *   so the same motion object drives both.
 */
export function computePose(motion) {
  const { time = 0, speed = 0, maxSpeed = 6, grounded = true, vy = 0, stride: phase = time * 5, run = 0, bat, swingT = 0, coil = 0, cheer = 0 } = motion
  for (const name of POSED_BONES) {
    const b = pose.bones[name]
    b.swing = 0
    b.sway = 0
    b.twist = 0
  }
  pose.lift = 0
  pose.stretchL = 1
  pose.stretchR = 1
  pose.bat.mode = 'back'
  pose.bat.scale = 1

  if (bat === 'ready') {
    battingReady(time, clamp01(coil), 1, clamp01(motion.toss || 0), clamp01(motion.slow || 0))
    return pose
  }
  if (bat === 'swing') {
    battingSwing(swingT, 0.8, 1)
    return pose
  }
  if (bat === 'after') {
    afterHit(swingT, Boolean(motion.great), time, 1)
    return pose
  }
  if (run > 0 && grounded) {
    cageSwings(phase, clamp01(run))
    return pose
  }
  if (cheer > 0) {
    cheering(time, cheer)
    stance(clamp01(1 - cheer), time)
    batOnBack(0.03)
    return pose
  }
  const ratio = grounded ? clamp01(speed / Math.max(maxSpeed, 0.001)) : 0
  if (grounded) {
    const still = 1 - smooth(0.05, 0.4, ratio)
    stance(still, time)
    if (ratio > 0.02) stride(phase, ratio)
  } else {
    airborne(vy)
  }
  const spine = pose.bones.Spine1
  batOnBack(spine.swing, spine.twist)
  return pose
}
