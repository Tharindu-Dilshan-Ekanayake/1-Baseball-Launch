import { useEffect, useRef, useState } from 'react'

import { rebirthMultiplier, TUTORIAL } from '@shared/balance'
import { formatDistance, formatNumber } from '@shared/format'
import { isMaxLevel, nextBall, nextTire, zoneIndexAt } from '@shared/logic'

import { zones } from '../../game/worldLook'

import { useGame } from '../../store/game'
import StrokeText from '../StrokeText'
import { u } from './style'

const BANNER_GRADIENT = 'linear-gradient(180deg, #fff6a8 0%, #ffd52a 45%, #ffa000 100%)'
const PANEL_GRADIENT = 'linear-gradient(180deg, #ffe45c 0%, #ffc21f 55%, #ff9a12 100%)'

/** The goal banner peeks in for this long (ms), once when the tutorial's done and again every EVERY_MS. */
const PEEK_MS = 5000
const EVERY_MS = 2 * 60 * 1000

/**
 * Whether the goal banner is showing: for PEEK_MS when it first appears, then again for
 * PEEK_MS every EVERY_MS - and straight away whenever a new chance turns up (`readyKey`
 * changes: a bat or ball you can now buy, a rebirth ready). Timers only: nothing
 * re-renders in between.
 */
function useGoalPeek(readyKey) {
  const [shown, setShown] = useState(true)
  const peek = useRef(null)
  useEffect(() => {
    let hide = setTimeout(() => setShown(false), PEEK_MS)
    peek.current = () => {
      setShown(true)
      clearTimeout(hide)
      hide = setTimeout(() => setShown(false), PEEK_MS)
    }
    const every = setInterval(() => peek.current(), EVERY_MS)
    return () => {
      clearTimeout(hide)
      clearInterval(every)
      peek.current = null
    }
  }, [])
  const firstKey = useRef(readyKey)
  useEffect(() => {
    if (!readyKey || readyKey === firstKey.current) return undefined
    firstKey.current = null
    const id = setTimeout(() => peek.current?.(), 0)
    return () => clearTimeout(id)
  }, [readyKey])
  return shown
}

/**
 * The tutorial for brand-new players: train, hit, buy a bat, buy a ball - then it's gone
 * for good. A small strip, "1/4" and the step with its progress ("(16/30)"), so the world stays in
 * view; the 3D arrows (TutorialArrows) show where to go.
 */
function TutorialBanner({ step }) {
  const current = TUTORIAL[step]
  const health = useGame((s) => s.profile.health)
  const atPlate = useGame((s) => s.zone.atPlate)
  let text = current.text
  if (current.health) text += ` (${formatNumber(Math.min(health, current.health))}/${formatNumber(current.health)})`
  if (current.event === 'roll' && atPlate) text = 'Press HIT to toss it up - then SWING as it drops to the line!'
  return (
    <div
      className="flex items-center"
      style={{
        gap: u(14),
        padding: `${u(6)} ${u(22)} ${u(6)} ${u(8)}`,
        borderRadius: u(30),
        border: `${u(4)} solid #111`,
        background: PANEL_GRADIENT,
        boxShadow: `0 ${u(4)} 0 rgba(0,0,0,0.3), inset 0 ${u(4)} 0 rgba(255,255,255,0.45)`,
      }}
    >
      <span
        className="flex items-center justify-center"
        style={{ minWidth: u(64), height: u(44), borderRadius: u(22), background: '#111', fontSize: u(26) }}
      >
        <StrokeText stroke={u(5)} gradient={BANNER_GRADIENT}>
          {step + 1}/{TUTORIAL.length}
        </StrokeText>
      </span>
      <span style={{ fontSize: u(34) }}>
        <StrokeText stroke={u(7)} style={{ whiteSpace: 'normal' }}>
          {text}
        </StrokeText>
      </span>
    </div>
  )
}

/**
 * The next goal, once the tutorial's done - something close enough to chase: rebirth when
 * you're at max level, else the next ball when you can afford it and not the next bat,
 * else the next bat and how far your Wins are from it, else the next stage down the field
 * past your best hit. A tap opens what it's about. Not always in the way: it peeks in for
 * five seconds every two minutes, and whenever something new is ready (useGoalPeek).
 */
function GoalBanner() {
  const profile = useGame((s) => s.profile)
  const pending = useGame((s) => s.pendingWins)
  const openPanel = useGame((s) => s.openPanel)
  let text
  let progress = null
  let panel = null
  /** Something you can do right now (buy, rebirth): its text, shown as soon as it turns up. */
  let ready = null
  if (isMaxLevel(profile)) {
    text = `REBIRTH READY! Rebirth for x${rebirthMultiplier(profile.rebirths + 1)} Power`
    panel = 'rebirth'
    ready = text
  } else {
    const next = nextTire(profile)
    const wins = Math.max(0, profile.wins - pending)
    const ball = nextBall({ ownedBalls: profile.ownedBalls || ['baseball'] })
    if (ball && wins >= ball.cost && (!next || wins < next.cost)) {
      text = `You can buy the ${ball.name}! Visit the Ball Shop`
      panel = 'balls'
      ready = text
    } else if (next) {
      text = wins >= next.cost ? `You can buy the ${next.name}! Visit the Bat Shop` : `Next bat: ${next.name}`
      if (wins >= next.cost) ready = text
      progress = Math.min(1, wins / Math.max(1, next.cost))
      if (wins < next.cost) text += ` (${formatNumber(wins)}/${formatNumber(next.cost)} Wins)`
    } else {
      const stages = zones()
      const nextStage = stages[Math.min(stages.length - 1, zoneIndexAt(profile.stats.bestDistance) + 1)]
      text = `Next stage: ${nextStage.name} at ${formatDistance(nextStage.start)} (best ${formatDistance(profile.stats.bestDistance)})`
      progress = Math.min(1, profile.stats.bestDistance / Math.max(1, nextStage.start))
    }
  }
  const shown = useGoalPeek(ready)
  return (
    <button
      type="button"
      onClick={panel && shown ? () => openPanel(panel) : undefined}
      aria-hidden={!shown}
      tabIndex={shown ? 0 : -1}
      className={`${panel && shown ? 'pp-btn pointer-events-auto' : ''} relative flex flex-col items-center overflow-hidden`}
      style={{
        opacity: shown ? 1 : 0,
        transform: `translateY(${shown ? 0 : u(-30)})`,
        transition: 'opacity 0.35s ease, transform 0.35s ease',
        padding: `${u(6)} ${u(24)} ${u(progress === null ? 6 : 14)}`,
        borderRadius: u(30),
        border: `${u(4)} solid #111`,
        background: panel ? 'linear-gradient(180deg, #b4efff 0%, #4cb8ff 50%, #2477e8 100%)' : PANEL_GRADIENT,
        boxShadow: `0 ${u(4)} 0 rgba(0,0,0,0.3), inset 0 ${u(4)} 0 rgba(255,255,255,0.45)`,
      }}
    >
      <span style={{ fontSize: u(32) }}>
        <StrokeText stroke={u(7)} style={{ whiteSpace: 'normal' }}>
          {text}
        </StrokeText>
      </span>
      {progress !== null && (
        <span className="absolute bottom-0 left-0 right-0" style={{ height: u(8), background: 'rgba(0,0,0,0.35)' }}>
          <span className="block h-full origin-left" style={{ transform: `scaleX(${progress})`, background: '#3fe05a' }} />
        </span>
      )}
    </button>
  )
}

/**
 * Top centre: the tutorial while there is one, then the next goal (GoalBanner). (The
 * playtime gift lives on the left menu: GiftTile.)
 */
export function TopCenter() {
  const step = useGame((s) => s.profile.tutorialStep)
  return (
    <div className="hud-topcenter pointer-events-none absolute left-1/2 flex -translate-x-1/2 flex-col items-center" style={{ width: 'max-content', maxWidth: '90vw' }}>
      {TUTORIAL[step] ? <TutorialBanner step={step} /> : <GoalBanner />}
    </div>
  )
}

export default TopCenter
