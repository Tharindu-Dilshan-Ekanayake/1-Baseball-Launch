import { useCallback, useEffect, useRef, useState } from 'react'

import { HIT_GRADES, hitGrade, SWING_WINDOW } from '@shared/balance'

import { cancelPull, launch, pressHit, slowAt } from '../../game/launch'
import { actions } from '../../net/actions'
import { useGame } from '../../store/game'
import Icon from '../Icon'
import StrokeText from '../StrokeText'
import { ChunkyButton } from './parts'
import { GRADIENTS, u } from './style'

/** A press is ignored this soon after the last (a double tap, a bouncing key). */
const PRESS_COOLDOWN_MS = 250

/**
 * The meter's grade bands, centred on the moment the ball crosses the plate: each grade
 * spans the times its meter reading covers (HIT_GRADES `min`), the ball marker sliding
 * across from "still coming" (left) to "gone by" (right).
 */
const BANDS = HIT_GRADES.filter((g) => g.min > 0).map((g) => ({ id: g.id, half: (1 - g.min) / 2 }))
const BAND_COLORS = {
  perfect: 'linear-gradient(180deg, #fff6a3 0%, #ffd21f 55%, #ff9c00 100%)',
  great: 'linear-gradient(180deg, #d9ff9a 0%, #5fe83a 55%, #1fb52a 100%)',
  good: 'linear-gradient(180deg, #bff4ff 0%, #4fc8ff 55%, #1f8ae0 100%)',
}
/** Each grade's colour for the live label over the meter. */
const GRADE_COLORS = { perfect: '#ffd21f', great: '#7dff4a', good: '#9fe8ff', weak: '#ff6a5a' }

/**
 * The batting station's HUD: the HIT! button, the swing meter and the slow motion. Walk
 * onto a batter's box and you step up to bat by yourself. Press HIT (the button, Space, E,
 * Enter or a click) and you toss the ball high over the plate; as it falls the game goes
 * into slow motion (a vignette closes in round the screen) and the ball marker slides
 * across the meter - bang in the middle (gold) the moment it reaches the bat. Press again,
 * SWING, as it does: the closer to the middle, the further the ball flies and the more it
 * pays (HIT_GRADES). Swing outside the meter and you whiff; then toss again. With the Auto
 * Swing pass, a toggle under it tosses and swings for you (a plain hit, no meter). Walk
 * off to step out.
 *
 * The meter and the vignette move straight on the DOM every animation frame (launch.js
 * keeps the toss's clock); React only hears about stepping in and out, and the button's
 * HIT / SWING.
 */
export function RollButton() {
  const near = useGame((s) => s.zone.atPlate && !s.roll && !s.rollResult && !s.panel)
  const ownsAuto = useGame((s) => Boolean(s.profile.passes.autoRoll))
  const autoOn = useGame((s) => Boolean(s.profile.passes.autoRoll && s.profile.settings.autoRoll))
  /** Up at bat right now (mirrors launch.gripping for React), and the ball in the air (HIT or SWING). */
  const [atBat, setAtBat] = useState(false)
  const [tossed, setTossed] = useState(false)
  const lastPress = useRef(-Infinity)
  const markerRef = useRef(null)
  const labelRef = useRef(null)
  const meterRef = useRef(null)
  const vignetteRef = useRef(null)
  const visible = near || atBat

  const press = useCallback(() => {
    const now = performance.now()
    if (now - lastPress.current < PRESS_COOLDOWN_MS) return
    lastPress.current = now
    pressHit(now)
  }, [])

  // Stepping in and out happens in the player (walking on and off the box): keep up.
  useEffect(() => {
    if (!visible) return undefined
    const id = setInterval(() => {
      setAtBat(launch.gripping || launch.released)
      setTossed(launch.stage !== 'ready' && !launch.released)
    }, 80)
    return () => clearInterval(id)
  }, [visible])

  // A panel opened or the hit started: step out (a hit steps you back in after).
  const panel = useGame((s) => s.panel)
  const rolling = useGame((s) => Boolean(s.roll))
  const [blocked, setBlocked] = useState(false)
  if (Boolean(panel || rolling) !== blocked) {
    setBlocked(Boolean(panel || rolling))
    if (panel || rolling) setAtBat(false)
  }
  useEffect(() => {
    if (blocked && panel && launch.gripping && !launch.released) cancelPull()
  }, [blocked, panel])

  useEffect(() => {
    if (!visible) return undefined
    const onKey = (e) => {
      if (!e.repeat && (e.code === 'KeyE' || e.code === 'Enter' || e.code === 'KeyF')) press()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, press])

  // The meter, every frame, while up at bat: the ball sliding across, and the grade a
  // swing right now would get.
  useEffect(() => {
    if (!atBat) return undefined
    let raf = 0
    const tick = () => {
      const now = performance.now()
      const thrown = launch.stage !== 'ready' || launch.released
      const t = (now - launch.arriveAt) / 1000
      const x = thrown ? Math.min(1, Math.max(0, 0.5 + t / (2 * SWING_WINDOW))) : 0
      const marker = markerRef.current
      if (marker) marker.style.left = `${x * 100}%`
      // The meter only while there's a ball in the air (or the swing's grade on it).
      if (meterRef.current) meterRef.current.style.opacity = thrown ? '1' : '0'
      if (vignetteRef.current) vignetteRef.current.style.opacity = String(slowAt(now))
      let text
      let color = '#ffffff'
      if (launch.released) {
        const grade = hitGrade(launch.accuracy)
        text = grade.label
        color = GRADE_COLORS[grade.id]
      } else if (!thrown) {
        text = 'Press HIT to toss the ball up!'
      } else if (launch.stage === 'whiff') {
        text = 'MISSED! Toss again...'
        color = GRADE_COLORS.weak
      } else if (launch.charge > 0) {
        const grade = hitGrade(launch.charge)
        text = t < 0 ? `SWING! ${grade.label.replace(/[!.]+$/, '')}` : grade.label.replace(/[!.]+$/, '')
        color = GRADE_COLORS[grade.id]
      } else {
        text = t < 0 ? 'WAIT FOR IT...' : 'TOO LATE!'
      }
      for (const layer of labelRef.current?.querySelectorAll('.pp-text-stroke, .pp-text-fill') ?? []) layer.textContent = text
      const fill = labelRef.current?.querySelector('.pp-text-fill')
      if (fill) fill.style.color = color
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [atBat])

  if (!visible) return null
  const manual = atBat && !autoOn
  return (
    <>
      {/* Slow motion: the screen's edges closing in, cold and dark, while the ball falls. */}
      {atBat && (
        <div
          ref={vignetteRef}
          className="pointer-events-none absolute inset-0 flex items-end justify-center"
          style={{
            opacity: 0,
            transition: 'opacity 0.25s linear',
            background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(8,18,52,0.55) 80%, rgba(4,8,30,0.85) 100%)',
          }}
        >
          <span style={{ fontSize: u(40), marginBottom: u(430), letterSpacing: u(6), opacity: 0.85 }}>
            <StrokeText stroke={u(7)}>SLOW MOTION</StrokeText>
          </span>
        </div>
      )}
      {/* The swing meter, up under the top bar: the middle of the screen is the ball. */}
      {manual && (
        <div className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 flex-col items-center" style={{ top: u(150) }}>
          <span ref={labelRef} className="whitespace-nowrap" style={{ fontSize: u(54), color: '#ffffff' }}>
            <StrokeText stroke={u(11)}>Press HIT to toss the ball up!</StrokeText>
          </span>
          <div ref={meterRef} className="flex flex-col items-center" style={{ opacity: 0, transition: 'opacity 0.15s' }}>
          <div
            className="relative overflow-hidden"
            style={{
              width: u(600),
              height: u(54),
              borderRadius: u(27),
              border: `${u(6)} solid #1b1b1f`,
              background: 'linear-gradient(180deg, #ff8a7a 0%, #e8423a 100%)',
              boxShadow: `0 ${u(6)} 0 rgba(0,0,0,0.35)`,
            }}
          >
            {/* The grade bands: GOOD, then GREAT, then PERFECT in the middle. */}
            {BANDS.slice()
              .reverse()
              .map((b) => (
                <div key={b.id} className="absolute top-0 bottom-0" style={{ left: `${(0.5 - b.half) * 100}%`, right: `${(0.5 - b.half) * 100}%`, background: BAND_COLORS[b.id] }} />
              ))}
            {/* The plate: the line the ball must be on. */}
            <div className="absolute top-0 bottom-0" style={{ left: '50%', width: u(5), marginLeft: u(-2.5), background: '#ffffff' }} />
            {/* The ball itself: a baseball sliding across as it falls. */}
            <div
              ref={markerRef}
              className="absolute"
              style={{
                left: '0%',
                top: '50%',
                width: u(44),
                height: u(44),
                marginLeft: u(-22),
                marginTop: u(-22),
                borderRadius: '50%',
                background: 'radial-gradient(circle at 35% 30%, #ffffff 0%, #f1ece0 55%, #c9c1ae 100%)',
                border: `${u(4)} solid #1b1b1f`,
                boxShadow: `inset ${u(-6)} 0 0 ${u(-2)} rgba(224,38,47,0.55), inset ${u(6)} 0 0 ${u(-2)} rgba(224,38,47,0.55)`,
              }}
            />
          </div>
          <span className="flex items-center" style={{ fontSize: u(30), marginTop: u(10), gap: u(8) }}>
            <StrokeText stroke={u(7)}>SWING when the ball hits the white line!</StrokeText>
          </span>
          </div>
        </div>
      )}
      {/* HIT / SWING in the middle, near the bottom (the level bar and the other buttons
          step aside while it's up - HUD.jsx): right under the batter and the falling ball. */}
      <div className="absolute left-1/2 flex -translate-x-1/2 flex-col items-center" style={{ bottom: u(90) }}>
        {!atBat && (
          <span className="pointer-events-none flex items-center" style={{ fontSize: u(34), gap: u(8), marginBottom: u(14) }}>
            <Icon name="arrowDown" size={u(40)} />
            <StrokeText stroke={u(7)}>Press HIT to step up and bat!</StrokeText>
          </span>
        )}
        {(manual || !atBat) && (
          <ChunkyButton
            key={tossed ? 'swing' : 'hit'}
            className={`pp-hit ${tossed ? 'pp-hit-swing' : 'pp-hit-idle'}`}
            gradient={tossed ? GRADIENTS.goldButton : GRADIENTS.greenButton}
            onPointerDown={(e) => {
              e.preventDefault()
              press()
            }}
            title={tossed ? 'Swing (Space / E)' : 'Hit: toss the ball up (Space / E)'}
            radius={30}
            border={6}
            style={{ height: u(124), padding: `0 ${u(56)}`, minWidth: u(380) }}
          >
            <span className="flex items-center" style={{ fontSize: u(64), gap: u(16) }}>
              <Icon name={tossed ? 'bat' : 'ball'} size={u(68)} />
              <StrokeText stroke={u(12)}>{tossed ? 'SWING!' : 'HIT!'}</StrokeText>
            </span>
          </ChunkyButton>
        )}
        {ownsAuto && (
          <ChunkyButton
            gradient={autoOn ? GRADIENTS.goldButton : GRADIENTS.greyButton}
            onClick={() => actions.setSetting('autoRoll', !autoOn)}
            title="Auto Swing"
            radius={10}
            border={4}
            style={{ height: u(56), padding: `0 ${u(20)}`, marginTop: u(12) }}
          >
            <span style={{ fontSize: u(32) }}>
              <StrokeText stroke={u(7)}>Auto Swing: {autoOn ? 'ON' : 'OFF'}</StrokeText>
            </span>
          </ChunkyButton>
        )}
      </div>
    </>
  )
}

export default RollButton
