import { readFileSync } from 'node:fs';
import type { BehaviorProfile } from '../../stuntdouble-brain-ts/src/index.ts';
import { Behavior } from '../../stuntdouble-brain-ts/src/index.ts';
import type { EnemySpec, Scenario } from './sim.ts';

interface PresetFile { presets: (BehaviorProfile & { id: string })[] }
const presets = (JSON.parse(readFileSync(new URL('../../../schemas/profiles.json', import.meta.url), 'utf8')) as PresetFile).presets;

export function presetProfile(id: string): BehaviorProfile {
  const p = presets.find((x) => x.id === id);
  if (!p) throw new Error('unknown preset ' + id);
  return { id: p.id, name: p.name, aggression: p.aggression, discipline: p.discipline, cinematicFlair: p.cinematicFlair, reactionDelayMs: p.reactionDelayMs, preferredRange: p.preferredRange };
}

const spartan = presetProfile('spartan_mercenary');

const grunt = (id: string, x: number, z: number, extra: Partial<EnemySpec> = {}): EnemySpec => ({
  id, x, z, hp: 60, damage: 12, windup: 0.6, recover: 1.2, reach: 2.4, speed: 3.3, threat: 1, ...extra,
});

/**
 * Gate thresholds are fixed per scenario (not tuned per run) and protected by arena.test.ts.
 * minAvoid counts only telegraphs the brain can react to (wind-up started inside its 4.5 m
 * imminence radius); the rest is reported as `unreactableHit`.
 */
export const SCENARIOS: Scenario[] = [
  {
    id: 'duel',
    title: 'Duel: 1 melee grunt',
    behaviors: Behavior.COMBAT,
    profile: spartan,
    enemies: [grunt('g1', 7, 0)],
    obstacles: [{ x: 3, z: 4, r: 1.2 }],
    maxTime: 60,
    gates: { survive: true, winAll: true, minAvoid: 0.6, maxReversal: 0.25, zeroLockedInput: true },
  },
  {
    id: 'surround3',
    title: 'Surround: 3 grunts at 120 degrees',
    behaviors: Behavior.COMBAT,
    profile: spartan,
    enemies: [grunt('g1', 7, 0), grunt('g2', -3.5, 6.06), grunt('g3', -3.5, -6.06)],
    obstacles: [{ x: 0, z: 9, r: 1.2 }, { x: 0, z: -9, r: 1.2 }],
    maxTime: 90,
    gates: { survive: true, winAll: true, minAvoid: 0.5, maxReversal: 0.3, zeroLockedInput: true },
  },
  {
    id: 'archer_melee',
    title: 'Archer + melee grunt',
    behaviors: Behavior.COMBAT,
    profile: spartan,
    enemies: [
      grunt('m1', 6, 0),
      grunt('a1', 12, 4, { ranged: true, hp: 40, damage: 8, windup: 0.9, recover: 1.8, reach: 14, speed: 2, threat: 1.2 }),
    ],
    obstacles: [{ x: 6, z: 3, r: 1.2 }],
    maxTime: 90,
    gates: { survive: true, winAll: true, minAvoid: 0.5, maxReversal: 0.3, zeroLockedInput: true },
  },
  {
    id: 'boss_defensive',
    title: 'Boss combo, DEFENSIVE (zero offense)',
    behaviors: Behavior.DEFENSIVE,
    profile: presetProfile('covert_operative'),
    enemies: [{ id: 'boss', x: 6, z: 0, hp: 400, damage: 20, windup: 0.55, recover: 1.5, reach: 3, speed: 2.8, combo: 3, threat: 3 }],
    obstacles: [],
    maxTime: 45,
    gates: { survive: true, minAvoid: 0.6, maxAttackCommands: 0, maxReversal: 0.3, zeroLockedInput: true },
  },
  {
    id: 'cruise_ambush',
    title: 'Cruise to waypoints + ambush (CRUISE|COMBAT)',
    behaviors: Behavior.CRUISE | Behavior.COMBAT,
    profile: spartan,
    enemies: [
      grunt('x1', 5, 5, { rel: true, spawnAt: 5 }),
      grunt('x2', -5, 5, { rel: true, spawnAt: 5 }),
    ],
    obstacles: [{ x: 14, z: 1, r: 1.2 }],
    waypoints: [{ x: 10, z: 0 }, { x: 20, z: 6, loot: true }, { x: 30, z: 0 }, { x: 30, z: 12, loot: true }],
    maxTime: 90,
    gates: { survive: true, winAll: true, waypointsAll: true, minAvoid: 0.5, maxReversal: 0.3, zeroLockedInput: true },
  },
  {
    id: 'ambush_oncombat',
    title: 'onCombat hand-over: human walks, ambush appears, Stuntdouble takes over then gives back',
    behaviors: Behavior.COMBAT,
    profile: spartan,
    engage: 'onCombat',
    enemies: [grunt('x1', 5, 5, { rel: true, spawnAt: 5 }), grunt('x2', -5, 5, { rel: true, spawnAt: 5 })],
    obstacles: [],
    maxTime: 60,
    gates: { survive: true, winAll: true, autoEngage: true, maxReversal: 0.3, zeroLockedInput: true },
  },
  {
    id: 'native_overlay',
    title: 'Native AI base + Stuntdouble competence layer vs the same weak native AI alone',
    behaviors: Behavior.COMBAT,
    profile: spartan,
    native: 'weak',
    enemies: [grunt('g1', 7, 0, { speed: 3.5, damage: 14 }), grunt('g2', -3.5, 6.06, { speed: 3.5, damage: 14 }), grunt('g3', -3.5, -6.06, { speed: 3.5, damage: 14 })],
    obstacles: [],
    maxTime: 90,
    gates: { survive: true, winAll: true, minAvoid: 0.5, beatsNative: 0.25, maxReversal: 0.3, zeroLockedInput: true },
  },
  {
    id: 'interlock',
    title: 'Interlocks: cutscene + manual override during a fight',
    behaviors: Behavior.COMBAT,
    profile: spartan,
    enemies: [grunt('g1', 9, 0, { spawnAt: 0 }), grunt('g2', 12, 3, { spawnAt: 8 })],
    obstacles: [],
    locks: [{ from: 3, to: 5, kind: 'cutscene' }, { from: 10, to: 12, kind: 'manual' }],
    maxTime: 60,
    gates: { survive: true, maxReversal: 0.3, zeroLockedInput: true },
  },
];

/**
 * Difficulty tiers (003). Same player rules ("hard" mode: one-hit parry with lock, real projectiles),
 * rising enemy model: variable wind-ups, feints, coordinated simultaneous strikes, flanking, leading
 * archers, multi-hit boss combo. Thresholds live in compare.ts / arena.test.ts and are fixed.
 */
const hgrunt = (id: string, x: number, z: number, extra: Partial<EnemySpec> = {}): EnemySpec => ({
  id, x, z, hp: 50, damage: 14, windup: 0.55, recover: 1.0, reach: 2.4, speed: 3.3, threat: 1, ...extra,
});
const harcher = (id: string, x: number, z: number, extra: Partial<EnemySpec> = {}): EnemySpec => ({
  id, x, z, hp: 35, damage: 9, windup: 0.7, recover: 1.4, reach: 14, speed: 2, ranged: true, threat: 1.2, projSpeed: 16, ...extra,
});
// Human-plausibility metrics are gated too: no jitter, no wall hugging, no single-command spam, nothing unreactable.
const tierGates = { survive: true, maxReversal: 0.35, maxWall: 0.15, maxCmdShare: 0.85, noUnreactable: true, zeroLockedInput: true } as const;

export const TIER_SCENARIOS: Scenario[] = [
  {
    id: 'arena_t1',
    title: 'Tier 1 (easy): 2 grunts, 1 archer, variable wind-ups',
    tier: 1, hard: true,
    behaviors: Behavior.COMBAT, profile: spartan,
    enemies: [
      hgrunt('g1', 8, 0, { windupVar: 0.25 }), hgrunt('g2', -6, 6, { windupVar: 0.25 }),
      harcher('a1', 14, -6, { lead: 0, projSpeed: 14 }),
    ],
    obstacles: [{ x: 4, z: 4, r: 1.2 }, { x: -4, z: -6, r: 1.2 }],
    maxTime: 90,
    gates: { ...tierGates },
  },
  {
    id: 'arena_t2',
    title: 'Tier 2 (medium): coordinated trio with feints, flanking, 1 leading archer',
    tier: 2, hard: true,
    behaviors: Behavior.COMBAT, profile: spartan,
    enemies: [
      hgrunt('g1', 8, 0, { coord: true, feint: 0.2, windupVar: 0.3, flank: 0.7, speed: 3.6 }),
      hgrunt('g2', -5, 7, { coord: true, feint: 0.2, windupVar: 0.3, flank: -0.7, speed: 3.6 }),
      hgrunt('g3', -5, -7, { coord: true, feint: 0.2, windupVar: 0.3, flank: 0.7, speed: 3.6 }),
      harcher('a1', 14, -6, { lead: 0.3 }),
    ],
    obstacles: [{ x: 4, z: 4, r: 1.2 }, { x: -4, z: -6, r: 1.2 }, { x: 9, z: -4, r: 1.2 }],
    maxTime: 90,
    gates: { ...tierGates },
  },
  {
    id: 'arena_t3',
    title: 'Tier 3 (hard): 2 coordinated flankers, 2 leading archers, boss combo',
    tier: 3, hard: true,
    behaviors: Behavior.COMBAT, profile: spartan,
    enemies: [
      hgrunt('g1', 8, 0, { coord: true, feint: 0.3, windupVar: 0.35, flank: 0.9, speed: 3.7 }),
      hgrunt('g2', -5, 7, { coord: true, feint: 0.3, windupVar: 0.35, flank: -0.9, speed: 3.7 }),
      harcher('a1', 14, -6, { lead: 0.5, damage: 6, recover: 1.8 }),
      harcher('a2', -14, 4, { lead: 0.5, damage: 6, recover: 1.8 }),
      { id: 'boss', x: 0, z: -9, rel: true, spawnAt: 15, hp: 150, damage: 16, windup: 0.5, recover: 1.4, reach: 3, speed: 3.4, combo: 3, comboVar: 0.4, finisher: 1.5, threat: 3 },
    ],
    obstacles: [{ x: 4, z: 4, r: 1.2 }, { x: -4, z: -6, r: 1.2 }, { x: 9, z: -4, r: 1.2 }, { x: -9, z: 3, r: 1.2 }],
    maxTime: 90,
    gates: { ...tierGates },
  },
  {
    // [CROWD-004] The defect this tier exists to catch: 4 melee in an arc + 1 archer used to
    // pin the brain in DEFENSIVE forever (zero attack commands) and the fight was only survived
    // by kiting. The gate demands both: survive every seed AND land at least one kill.
    id: 't4_crowd',
    title: 'Tier 4 (crowd): 4 melee arc + 1 archer, punish windows under pressure',
    tier: 4, hard: true,
    behaviors: Behavior.COMBAT, profile: spartan,
    enemies: [
      hgrunt('g1', 7, 0, { feint: 0.15, windupVar: 0.25 }),
      hgrunt('g2', 4, 6, { feint: 0.15, windupVar: 0.25, flank: 0.4 }),
      hgrunt('g3', -5, 5, { feint: 0.15, windupVar: 0.25, flank: -0.4 }),
      hgrunt('g4', -5, -5, { feint: 0.15, windupVar: 0.25 }),
      harcher('a1', 13, -7, { lead: 0.3, damage: 6, recover: 1.6 }),
    ],
    obstacles: [{ x: 4, z: 3, r: 1.2 }, { x: -6, z: -3, r: 1.2 }, { x: 9, z: -3, r: 1.2 }],
    maxTime: 90,
    gates: { ...tierGates, minKills: 1 },
  },
];
