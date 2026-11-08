/**
 * Stuntdouble Core Brain Architecture (stuntdouble-brain-ts)
 * Copyright (c) 2026 Yusuf Günay. Licensed under MPL-2.0.
 *
 * Implements a zero-dependency, deterministic/stochastic 4-Layer Autonomous Proxy Agent:
 *   Layer 4: Narrative & Tactical Orchestrator (Presentation & Stance control)
 *   Layer 3: Regressive A* GOAP Planner (Goal-Oriented Action Planning) + Utility AI Scorer
 *   Layer 2: Shared Tactical Blackboard + 2D Spatial Influence Map
 *   Layer 1: 16-Slot Context Steering (Interest - Danger Vector Synthesis)
 */

// ============================================================================
// 0. CORE TYPES & INTERFACES
// ============================================================================

export type AutonomyMode =
  | 'FULL_COMBAT'     // Complete autonomous combat & movement (Default)
  | 'CO_PILOT'        // Human steers & attacks; Stuntdouble intercepts only urgent reflexes (Parry/Dodge/Heal)
  | 'GRIND_AUTOPILOT' // Open-world waypoint navigation, auto-loot/harvest, and trash-mob clearing
  | 'SHADOW_SURVIVAL' // Zero-offense evasion & parry showcase to study boss attack patterns safely
  | 'COMMANDER';      // Human issues high-level target/stance orders; Stuntdouble executes motor combat

/**
 * Composable behavior flags (bit mask). The five AutonomyMode names are presets over these.
 * Conflict rules (fixed, identical in TS / C# / C++ / Lua):
 *   DEFENSIVE overrides offense; ASSIST is inert while COMBAT is set AND an enemy exists;
 *   CRUISE runs only while no enemy exists; ASSIST+CRUISE: cruise when clear, human pass-through
 *   plus reflex intercept when an enemy exists; no active behavior => human input passes, Stuntdouble idle.
 */
export const Behavior = {
  COMBAT: 1,
  ASSIST: 2,
  CRUISE: 4,
  DEFENSIVE: 8,
  COMMAND: 16,
} as const;
export type Behaviors = number;

export const AUTONOMY_PRESETS: Record<AutonomyMode, Behaviors> = {
  FULL_COMBAT: Behavior.COMBAT,
  CO_PILOT: Behavior.ASSIST,
  GRIND_AUTOPILOT: Behavior.CRUISE | Behavior.COMBAT,
  SHADOW_SURVIVAL: Behavior.DEFENSIVE,
  COMMANDER: Behavior.COMBAT | Behavior.COMMAND,
};

/** Accepts a legacy AutonomyMode name or a raw flag mask and returns the mask. */
export function resolveBehaviors(mode: AutonomyMode | Behaviors): Behaviors {
  return typeof mode === 'number' ? mode & 31 : AUTONOMY_PRESETS[mode];
}

export type PresentationMode = 'TACTICAL' | 'CINEMATIC_LIVE' | 'CINEMATIC_RESOLVE';
export type TacticalStance = 'AGGRESSIVE' | 'BALANCED' | 'DEFENSIVE' | 'EVASIVE' | 'STEALTH';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * XZ-plane distance. Deliberately `Math.sqrt(dx*dx + dz*dz)` rather than `Math.hypot`:
 * hypot's compensated summation differs from a plain sqrt in the last ulp, which would
 * break bit-level agreement with the C#, C++ and Lua kernels in packages/conformance.
 */
export function distXZ(ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Decimal quantisation shared by every Stuntdouble kernel: floor(x * 10^digits + 0.5) / 10^digits.
 * `toFixed`/`toString` pipelines disagree on halfway cases between runtimes, so the
 * conformance harness compares values produced by this exact routine on all four sides.
 */
export function quantize(value: number, digits: number): number {
  const scale = Math.pow(10, digits);
  return Math.floor(value * scale + 0.5) / scale;
}

export interface BehaviorProfile {
  id: string;
  name: string;
  aggression: number;      // [0, 1] Bias towards offensive actions and gap closing
  discipline: number;      // [0, 1] Inverse of stochastic noise; adherence to optimal score
  cinematicFlair: number;  // [0, 1] Preference for finishers, parries, and dramatic camera cuts
  reactionDelayMs: number; // Simulated human/protagonist motor latency
  preferredRange: number;  // Optimal engagement distance in meters
}

export interface EntitySnapshot {
  id: string;
  position: Vec3;
  velocity: Vec3;
  healthRatio: number;     // [0, 1]
  staminaRatio: number;    // [0, 1]
  isAttacking: boolean;
  isWindUp: boolean;       // Enemy telegraphing an incoming strike
  isRanged: boolean;
  /** Optional: seconds until a projectile this entity already fired reaches the target (<= 0 or absent = none in flight). */
  projectileEta?: number;
  /** Optional: true while this hostile is staggered in a post-attack recovery window (a defended strike). */
  recovering?: boolean;
  /** Optional: this hostile's real attack reach in meters. Ranged threat detection uses it; absent = legacy 16 m. */
  attackRange?: number;
  /** Optional (self snapshot): half-extent of a square arena; walls become steering hazards. 0/absent = unknown. */
  bounds?: number;
  threatWeight: number;    // Base danger level (e.g., 1.0 grunt, 3.0 elite/boss)
}

/**
 * Boolean proposition set used by the GOAP planner. Restricting the domain to
 * booleans is what makes the regressive search byte-for-byte reproducible in
 * TypeScript, C#, C++ and Lua (see packages/conformance).
 */
export type WorldStateMap = Record<string, boolean>;

export interface CameraDirective {
  mode: 'PASSIVE' | 'DYNAMIC_ORBIT' | 'ACTION_TRACK' | 'IMPACT_SLOWMO' | 'FINISH_CUT';
  timeScale: number;       // 1.0 normal, 0.25 slow-mo, 2.0 fast-resolve
  fovMultiplier: number;   // e.g., 0.85 for tight dramatic focus
  focusTargetId: string | null;
}

// ============================================================================
// 1. LAYER 1: 16-SLOT CONTEXT STEERING (Andrew Fray / Craig Reynolds)
// ============================================================================

export class ContextSteering {
  private readonly slotCount: number;
  private readonly directions: Vec3[];

  constructor(slotCount = 16) {
    this.slotCount = slotCount;
    this.directions = [];
    for (let i = 0; i < slotCount; i++) {
      const angle = (i / slotCount) * Math.PI * 2;
      this.directions.push({ x: Math.cos(angle), y: 0, z: Math.sin(angle) });
    }
  }

  /**
   * Computes the conflict-free movement vector on the XZ plane using Interest and Danger maps.
   * Prevents oscillation traps common in classical vector-sum steering.
   */
  public computeMoveVector(
    selfPos: Vec3,
    targetPos: Vec3,
    preferredDistance: number,
    hazards: { position: Vec3; radius: number; weight: number }[]
  ): { direction: Vec3; speedMultiplier: number } {
    const interest = new Float64Array(this.slotCount);
    const danger = new Float64Array(this.slotCount);

    const dx = targetPos.x - selfPos.x;
    const dz = targetPos.z - selfPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const toTargetDir: Vec3 = dist > 1e-5 ? { x: dx / dist, y: 0, z: dz / dist } : { x: 0, y: 0, z: 0 };

    // Populate Interest Map
    for (let i = 0; i < this.slotCount; i++) {
      const slotDir = this.directions[i];
      const dot = slotDir.x * toTargetDir.x + slotDir.z * toTargetDir.z;

      if (dist > preferredDistance * 1.15) {
        // Close the gap
        interest[i] = Math.max(0, dot);
      } else if (dist < preferredDistance * 0.8) {
        // Too close: prefer backing away or strafing
        interest[i] = Math.max(0, -dot * 0.8 + (1 - Math.abs(dot)) * 0.5);
      } else {
        // In sweet spot: prefer strafing perpendicular to target
        interest[i] = 1.0 - Math.abs(dot);
      }
    }

    // Populate Danger Map
    for (const h of hazards) {
      const hx = h.position.x - selfPos.x;
      const hz = h.position.z - selfPos.z;
      const hDist = Math.sqrt(hx * hx + hz * hz);
      if (hDist >= h.radius || hDist < 1e-5) continue;

      const hDir: Vec3 = { x: hx / hDist, y: 0, z: hz / hDist };
      const proximityUrgency = (1.0 - hDist / h.radius) * h.weight;

      for (let i = 0; i < this.slotCount; i++) {
        const slotDir = this.directions[i];
        const alignment = slotDir.x * hDir.x + slotDir.z * hDir.z;
        if (alignment > 0) {
          const dVal = alignment * proximityUrgency;
          if (dVal > danger[i]) danger[i] = dVal;
        }
      }
    }

    // Synthesize: mask high danger and pick maximum remaining interest
    let bestSlot = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < this.slotCount; i++) {
      const score = interest[i] - danger[i] * 1.35;
      if (score > bestScore) {
        bestScore = score;
        bestSlot = i;
      }
    }

    const chosen = this.directions[bestSlot];
    const speedMultiplier = Math.max(0.2, Math.min(1.0, bestScore + 0.5));
    return { direction: { ...chosen }, speedMultiplier };
  }
}

// ============================================================================
// 2. LAYER 2: BLACKBOARD & SPATIAL INFLUENCE MAP
// ============================================================================

export class InfluenceMap2D {
  public readonly gridSize: number;
  public readonly cellSize: number;
  private readonly grid: Float64Array;

  constructor(gridSize = 16, cellSize = 2.5) {
    this.gridSize = gridSize;
    this.cellSize = cellSize;
    this.grid = new Float64Array(gridSize * gridSize);
  }

  public update(centerPos: Vec3, hostiles: EntitySnapshot[], allies: EntitySnapshot[] = []): void {
    this.grid.fill(0);
    const halfSpan = (this.gridSize * this.cellSize) / 2;

    for (let gx = 0; gx < this.gridSize; gx++) {
      for (let gz = 0; gz < this.gridSize; gz++) {
        const worldX = centerPos.x - halfSpan + (gx + 0.5) * this.cellSize;
        const worldZ = centerPos.z - halfSpan + (gz + 0.5) * this.cellSize;

        let score = 0;
        for (const h of hostiles) {
          const d = distXZ(worldX, worldZ, h.position.x, h.position.z);
          score -= (h.threatWeight * (h.isWindUp ? 1.75 : 1.0)) / (1.0 + d * 0.45);
        }
        for (const a of allies) {
          const d = distXZ(worldX, worldZ, a.position.x, a.position.z);
          score += a.threatWeight / (1.0 + d * 0.5);
        }
        this.grid[gz * this.gridSize + gx] = score;
      }
    }
  }

  /**
   * Returns the safest tactical coordinate (highest influence value) within local grid.
   */
  public findSafestPocket(centerPos: Vec3): Vec3 {
    const halfSpan = (this.gridSize * this.cellSize) / 2;
    let bestIdx = 0;
    let bestVal = -Infinity;

    for (let i = 0; i < this.grid.length; i++) {
      if (this.grid[i] > bestVal) {
        bestVal = this.grid[i];
        bestIdx = i;
      }
    }

    const gx = bestIdx % this.gridSize;
    const gz = Math.floor(bestIdx / this.gridSize);
    return {
      x: centerPos.x - halfSpan + (gx + 0.5) * this.cellSize,
      y: centerPos.y,
      z: centerPos.z - halfSpan + (gz + 0.5) * this.cellSize,
    };
  }
}

export class TacticalBlackboard {
  public self!: EntitySnapshot;
  public hostiles: EntitySnapshot[] = [];
  public profile!: BehaviorProfile;
  public presentationMode: PresentationMode = 'TACTICAL';
  public stance: TacticalStance = 'BALANCED';
  public primaryTarget: EntitySnapshot | null = null;
  public imminentThreat: EntitySnapshot | null = null;
  /** Nearest ranged hostile that is winding up (inside its real reach, legacy 16 m) or has a projectile in flight; null if none. */
  public rangedThreat: EntitySnapshot | null = null;
  /** Nearest melee hostile staggered in its recovery window (punish opportunity); null if none. */
  public counterTarget: EntitySnapshot | null = null;
  public pressureIndex = 0;
  public influenceMap = new InfluenceMap2D(12, 2.5);
  public customData: Record<string, unknown> = {};

  public refresh(self: EntitySnapshot, hostiles: EntitySnapshot[], profile: BehaviorProfile): void {
    this.self = self;
    this.hostiles = hostiles.filter((h) => h.healthRatio > 0);
    this.profile = profile;

    // Identify imminent wind-up threat and primary target
    let nearestDist = Infinity;
    let bestTarget: EntitySnapshot | null = null;
    let windUpThreat: EntitySnapshot | null = null;
    let rangedThreat: EntitySnapshot | null = null;
    let counterTarget: EntitySnapshot | null = null;
    let rangedDist = Infinity;
    let counterDist = Infinity;
    let rawPressure = 0;

    for (const h of this.hostiles) {
      const d = distXZ(h.position.x, h.position.z, self.position.x, self.position.z);
      rawPressure += h.threatWeight / Math.max(1.0, d * 0.35);

      if (h.isWindUp && d < 4.5 && !h.isRanged) {
        windUpThreat = h;
      }
      // [CROWD-004] the ranged threat radius is the enemy's real reach, not a fixed 16 m
      // (absent field = legacy 16 m so older snapshots keep their exact behaviour).
      const rangedLimit = (h.attackRange ?? 0) > 0 ? h.attackRange! : 16.0;
      if (h.isRanged && ((h.isWindUp && d <= rangedLimit) || (h.projectileEta ?? 0) > 0) && d < rangedDist) {
        rangedDist = d;
        rangedThreat = h;
      }
      // [CROWD-004] a defended strike leaves the attacker staggered: one short punish window,
      // used by the brain instead of locking into DEFENSIVE forever under crowd pressure.
      if (!h.isRanged && h.recovering === true && d <= 3.5 && d < counterDist) {
        counterDist = d;
        counterTarget = h;
      }
      // [CORE-003] ranged enemies are squishy and drain the fight: they count as half as far for target choice.
      const key = h.isRanged ? d * 0.5 : d;
      if (key < nearestDist) {
        nearestDist = key;
        bestTarget = h;
      }
    }

    this.primaryTarget = bestTarget;
    this.imminentThreat = windUpThreat;
    this.rangedThreat = rangedThreat;
    this.counterTarget = counterTarget;
    this.pressureIndex = Math.min(1.0, rawPressure / 3.5);
    this.influenceMap.update(self.position, this.hostiles);
  }

  public toWorldState(): WorldStateMap {
    const hasTarget = this.primaryTarget !== null;
    const dist = hasTarget
      ? distXZ(
          this.primaryTarget!.position.x,
          this.primaryTarget!.position.z,
          this.self.position.x,
          this.self.position.z
        )
      : Infinity;

    return {
      hasHostiles: this.hostiles.length > 0,
      inMeleeRange: dist <= 2.8,
      inPreferredRange: dist <= this.profile.preferredRange * 1.2,
      underImminentAttack: this.imminentThreat !== null,
      threatNeutralized: this.imminentThreat === null,
      healthCritical: this.self.healthRatio < 0.3,
      staminaSufficient: this.self.staminaRatio > 0.25,
      targetVulnerable: hasTarget && this.primaryTarget!.healthRatio < 0.25,
      enemyEliminated: !hasTarget,
      survived: this.self.healthRatio >= 0.65 && this.imminentThreat === null,
    };
  }
}

// ============================================================================
// 3. LAYER 3A: UTILITY AI CURVES & COMPENSATED SCORING (Dave Mark)
// ============================================================================

export const Curves = {
  linear: (x: number): number => Math.max(0, Math.min(1, x)),
  inverseLinear: (x: number): number => Math.max(0, Math.min(1, 1 - x)),
  quadratic: (x: number, k = 2): number => Math.pow(Math.max(0, Math.min(1, x)), k),
  logistic: (x: number, k = 10, x0 = 0.5): number => {
    const clamped = Math.max(0, Math.min(1, x));
    return 1.0 / (1.0 + Math.exp(-k * (clamped - x0)));
  },
};

/**
 * Deterministic ε_δ discipline jitter (see paper/WHITEPAPER.md §Layer 3A).
 *
 * A golden-ratio additive recurrence (the Kronecker / Van der Corput low-discrepancy
 * sequence) is used instead of a PRNG so the exact same ±amplitude is reproduced by
 * every runtime and every conformance run — no seeding, no platform RNG drift.
 */
export class DisciplineJitter {
  private static readonly GOLDEN_CONJUGATE = 0.6180339887498949;
  private cursor = 0;

  public reset(): void {
    this.cursor = 0;
  }

  /** Returns ε_δ ∈ [-amp, +amp] where amp = (1 - discipline) / 10. */
  public next(discipline: number): number {
    this.cursor += 1;
    const scaled = this.cursor * DisciplineJitter.GOLDEN_CONJUGATE;
    const u = scaled - Math.floor(scaled);
    const d = Math.max(0, Math.min(1, discipline));
    return ((1 - d) / 10) * (2 * u - 1);
  }
}

export interface Consideration {
  name: string;
  evaluate: (bb: TacticalBlackboard) => number; // Must return normalized [0, 1]
  curve: (normValue: number) => number;
}

export class UtilityAction {
  public readonly id: string;
  public readonly considerations: Consideration[];

  constructor(id: string, considerations: Consideration[]) {
    this.id = id;
    this.considerations = considerations;
  }

  /**
   * Computes Dave Mark's Makeup Value Compensated multiplicative utility score:
   * Prevents actions with more considerations from being unfairly penalized.
   */
  public score(bb: TacticalBlackboard): number {
    if (this.considerations.length === 0) return 0;

    const n = this.considerations.length;
    const modificationFactor = 1.0 - 1.0 / n;
    let runningScore = 1.0;

    for (const c of this.considerations) {
      const raw = Math.max(0, Math.min(1, c.evaluate(bb)));
      const q = Math.max(0, Math.min(1, c.curve(raw)));
      const makeUpValue = (1.0 - q) * modificationFactor;
      runningScore *= q + makeUpValue * q;
      if (runningScore <= 1e-6) return 0;
    }

    return runningScore;
  }
}

// ============================================================================
// 4. LAYER 3B: REGRESSIVE A* GOAP PLANNER (Jeff Orkin / F.E.A.R.)
// ============================================================================

export interface GoapAction {
  name: string;
  preconditions: WorldStateMap;
  effects: WorldStateMap;
  baseCost: number;
  dynamicCost?: (bb: TacticalBlackboard) => number;
}

interface PlanNode {
  unmetGoal: WorldStateMap;
  actions: GoapAction[];
  gCost: number;
  fCost: number;
}

export class GoapPlanner {
  /**
   * Performs backward regressive A* search from desired Goal State to Current World State.
   */
  public plan(
    currentState: WorldStateMap,
    goalState: WorldStateMap,
    availableActions: GoapAction[],
    bb: TacticalBlackboard
  ): GoapAction[] | null {
    const openSet: PlanNode[] = [
      {
        unmetGoal: { ...goalState },
        actions: [],
        gCost: 0,
        fCost: this.heuristic(currentState, goalState),
      },
    ];
    const closedSet = new Set<string>();

    let iterations = 0;
    const maxIterations = 256;

    while (openSet.length > 0 && iterations++ < maxIterations) {
      openSet.sort((a, b) => a.fCost - b.fCost);
      const current = openSet.shift()!;

      if (this.isSatisfied(currentState, current.unmetGoal)) {
        return [...current.actions].reverse();
      }

      const key = this.serializeState(current.unmetGoal);
      if (closedSet.has(key)) continue;
      closedSet.add(key);

      for (const action of availableActions) {
        if (!this.doesActionSatisfyAny(action, current.unmetGoal, currentState)) continue;

        const nextUnmet = this.regressState(current.unmetGoal, action);
        const stepCost = action.dynamicCost ? action.dynamicCost(bb) : action.baseCost;
        const g = current.gCost + Math.max(0.05, stepCost);
        const h = this.heuristic(currentState, nextUnmet);

        openSet.push({
          unmetGoal: nextUnmet,
          actions: [...current.actions, action],
          gCost: g,
          fCost: g + h,
        });
      }
    }

    return null;
  }

  private isSatisfied(current: WorldStateMap, required: WorldStateMap): boolean {
    for (const [k, v] of Object.entries(required)) {
      if (current[k] !== v) return false;
    }
    return true;
  }

  private doesActionSatisfyAny(
    action: GoapAction,
    unmetGoal: WorldStateMap,
    currentState: WorldStateMap
  ): boolean {
    let helps = false;
    for (const [k, v] of Object.entries(action.effects)) {
      if (unmetGoal[k] !== undefined) {
        if (unmetGoal[k] === v && currentState[k] !== v) {
          helps = true;
        } else if (unmetGoal[k] !== v) {
          // Conflicting effect
          return false;
        }
      }
    }
    return helps;
  }

  private regressState(unmetGoal: WorldStateMap, action: GoapAction): WorldStateMap {
    const next: WorldStateMap = { ...unmetGoal };
    for (const k of Object.keys(action.effects)) {
      delete next[k];
    }
    for (const [k, v] of Object.entries(action.preconditions)) {
      next[k] = v;
    }
    return next;
  }

  private heuristic(current: WorldStateMap, required: WorldStateMap): number {
    let diff = 0;
    for (const [k, v] of Object.entries(required)) {
      if (current[k] !== v) diff++;
    }
    return diff * 0.5;
  }

  private serializeState(state: WorldStateMap): string {
    return Object.keys(state)
      .sort()
      .map((k) => `${k}:${String(state[k])}`)
      .join('|');
  }
}

// ============================================================================
// 5. LAYER 4: ORCHESTRATOR & UNIFIED Stuntdouble BRAIN
// ============================================================================

export interface StuntDecision {
  autonomyMode: AutonomyMode | Behaviors; // echoes the tick argument (legacy name or mask)
  behaviors: Behaviors;                   // resolved flag mask actually used
  stance: TacticalStance;
  interceptHumanInput: boolean; // True when Stuntdouble overrides human controller this tick
  selectedUtilityAction: string;
  utilityScore: number;
  goapPlan: string[];
  immediateCommand: string;
  steeringMove: Vec3;
  speedMultiplier: number;
  /** True when this tick is a counter-punish inside an enemy recovery window (time critical). */
  punishWindow: boolean;
  cameraDirective: CameraDirective;
}

export class StuntBrain {
  public readonly blackboard = new TacticalBlackboard();
  public readonly steering = new ContextSteering(16);
  public readonly planner = new GoapPlanner();
  private readonly jitter = new DisciplineJitter();
  private readonly utilityActions: UtilityAction[];
  private readonly goapActions: GoapAction[];
  /** [CROWD-004] pressure hysteresis: once crowd pressure forces DEFENSIVE, stay there until it relaxes. */
  private defensiveHold = false;

  constructor(customUtilityActions?: UtilityAction[], customGoapActions?: GoapAction[]) {
    this.utilityActions = customUtilityActions ?? StuntBrain.defaultUtilityActions();
    this.goapActions = customGoapActions ?? StuntBrain.defaultGoapActions();
  }

  /**
   * Executes a single cognitive tick across all 4 architectural layers.
   */
  public tick(
    self: EntitySnapshot,
    hostiles: EntitySnapshot[],
    profile: BehaviorProfile,
    presentationMode: PresentationMode = 'TACTICAL',
    autonomyMode: AutonomyMode | Behaviors = 'FULL_COMBAT',
    waypointOrLootPos?: Vec3
  ): StuntDecision {
    // 1. Update Layer 2 (Blackboard + Spatial Influence Map)
    this.blackboard.presentationMode = presentationMode;
    this.blackboard.refresh(self, hostiles, profile);

    // [FLAGS] resolve behaviors (identical block in every port)
    const behaviors = resolveBehaviors(autonomyMode);
    const hasEnemy = this.blackboard.hostiles.length > 0;
    const fCombat = (behaviors & Behavior.COMBAT) !== 0;
    const fDefensive = (behaviors & Behavior.DEFENSIVE) !== 0;
    const assistActive = (behaviors & Behavior.ASSIST) !== 0 && !(fCombat && hasEnemy);
    const cruiseActive = (behaviors & Behavior.CRUISE) !== 0 && !hasEnemy;
    const inactive = !(fCombat || fDefensive || assistActive || cruiseActive);

    // 2. Layer 4: Orchestrator evaluates stance & high-level goal based on behaviors
    const stance = fDefensive ? 'DEFENSIVE' : this.evaluateStance();
    this.blackboard.stance = stance;
    const goalState = this.selectGoalForStance(stance);

    // 3. Layer 3A: Evaluate Utility AI with compensated scoring (+ deterministic ε_δ jitter)
    let bestUtility = this.utilityActions[0];
    let bestScore = -1;
    this.jitter.reset();
    for (const ua of this.utilityActions) {
      if (fDefensive && (ua.id === 'STRIKE_COMBO' || ua.id === 'EXECUTE_FINISHER')) {
        continue; // DEFENSIVE strictly parries and evades without attacking
      }
      const jittered = ua.score(this.blackboard) + this.jitter.next(profile.discipline);
      const s = Math.max(0, Math.min(1, jittered));
      if (s > bestScore) {
        bestScore = s;
        bestUtility = ua;
      }
    }

    // 4. Layer 3B: Regressive A* GOAP Plan from current WorldState to Orchestrator Goal
    const worldState = this.blackboard.toWorldState();
    const rawPlan = this.planner.plan(worldState, goalState, this.goapActions, this.blackboard) ?? [];
    const goapPlanNames = rawPlan.map((a) => a.name);

    // Determine immediate command and human-input interception policy per AutonomyMode
    let immediateCommand =
      bestScore > 0.78 + 0.4 * (0.78 - profile.aggression) ? bestUtility.id : goapPlanNames[0] ?? bestUtility.id; // [CORE-003] commit threshold is continuous in aggression (0.78 at aggression 0.78)
    let interceptHumanInput = true;

    if (inactive) {
      // [FLAGS] no active behavior: human input passes, Stuntdouble does nothing
      interceptHumanInput = false;
      immediateCommand = 'HUMAN_PASS_THROUGH';
    } else if (cruiseActive) {
      immediateCommand = waypointOrLootPos ? 'CRUISE_OR_LOOT' : 'IDLE_SCAN';
    } else if (assistActive) {
      // Only intercept human controls when an urgent defensive reflex (Parry/Evade/Heal) crosses threshold
      const isUrgentReflex =
        (bestUtility.id === 'DEFLECT_COUNTER' || bestUtility.id === 'EVADE_REPOSITION') &&
        bestScore >= 0.75;
      interceptHumanInput = isUrgentReflex || self.healthRatio < 0.25;
      if (!interceptHumanInput) {
        immediateCommand = 'HUMAN_PASS_THROUGH';
      }
    }

    // [CROWD-004] punish window: after a defended strike (parry/dodge) the staggered attacker is
    // hit once, provided nothing else is about to land and stamina permits; then defence resumes.
    const counter = this.blackboard.counterTarget;
    if (
      !inactive && !cruiseActive && !assistActive && counter !== null &&
      self.healthRatio >= 0.3 && self.staminaRatio > 0.25
    ) {
      immediateCommand = 'STRIKE_COMBO';
    }

    // [CORE-003] continuous aggression: low-aggression profiles keep a stamina reserve and skip
    // non-finisher attacks below it (reserve = (1 - aggression) * 0.6; monotone over the whole range).
    if (
      !inactive && !cruiseActive && !assistActive && this.blackboard.imminentThreat === null &&
      (immediateCommand === 'STRIKE_COMBO' || immediateCommand === 'HEAVY_ASSAULT') &&
      self.staminaRatio < (1.0 - profile.aggression) * 0.9
    ) {
      immediateCommand = 'CLOSE_DISTANCE';
    }

    // [CORE-003] critical health and nothing about to land in melee: heal beats fleeing.
    if (
      !inactive && !cruiseActive && !assistActive && this.blackboard.imminentThreat === null &&
      self.healthRatio < 0.3 && goapPlanNames.length > 0 && goapPlanNames[0] === 'TACTICAL_HEAL'
    ) {
      immediateCommand = 'TACTICAL_HEAL';
    }

    // [CORE-003] ranged threat (wind-up up to 16 m or projectile in flight): sidestep, do not parry.
    const rt = this.blackboard.rangedThreat;
    const rangedReflex = !inactive && rt !== null && this.blackboard.imminentThreat === null && immediateCommand !== 'TACTICAL_HEAL';
    if (rangedReflex) {
      // Steering is always lateral; the dodge itself is timed to the projectile (impact within 0.4 s).
      const eta = rt!.projectileEta ?? 0;
      const dodgeNow = eta > 0 && eta <= 0.4;
      if (dodgeNow) immediateCommand = 'EVADE_REPOSITION';
      if (dodgeNow || !assistActive) interceptHumanInput = true;
    }

    // 5. Layer 1: Context Steering vector synthesis
    let navTarget = self.position;
    if (cruiseActive && waypointOrLootPos) {
      navTarget = waypointOrLootPos;
    } else if (counter !== null) {
      // [CROWD-004] step into the punish window instead of backing away from it.
      navTarget = counter.position;
    } else if (stance === 'EVASIVE' || stance === 'DEFENSIVE') {
      navTarget = this.blackboard.influenceMap.findSafestPocket(self.position);
    } else if (this.blackboard.primaryTarget) {
      navTarget = this.blackboard.primaryTarget.position;
    }

    const hazards = this.blackboard.hostiles.map((h) => ({
      position: h.position,
      radius: h.isWindUp ? 4.2 : 2.5,
      weight: h.threatWeight * (h.isWindUp ? 1.8 : 1.0),
    }));
    // [CROWD-004] when the adapter reports the arena extent, walls repel like hazards; under crowd
    // pressure the retreat no longer paints itself into a corner.
    const bounds = self.bounds ?? 0;
    if (bounds > 0) {
      const wallRadius = 12;
      const wallWeight = 2.0;
      hazards.push(
        { position: { x: bounds + 1, y: 0, z: self.position.z }, radius: wallRadius, weight: wallWeight },
        { position: { x: -bounds - 1, y: 0, z: self.position.z }, radius: wallRadius, weight: wallWeight },
        { position: { x: self.position.x, y: 0, z: bounds + 1 }, radius: wallRadius, weight: wallWeight },
        { position: { x: self.position.x, y: 0, z: -bounds - 1 }, radius: wallRadius, weight: wallWeight }
      );
    }

    const prefRange = cruiseActive ? 0.5 : profile.preferredRange;

    let { direction, speedMultiplier } = this.steering.computeMoveVector(
      self.position,
      navTarget,
      prefRange,
      hazards
    );
    if (inactive) {
      // [FLAGS] idle: no steering output
      direction = { x: 0, y: 0, z: 0 };
      speedMultiplier = 0;
    } else if (rangedReflex) {
      // Lateral to the firing line; side follows current motion (stable), aggression blends in a charge.
      let ux = rt!.position.x - self.position.x;
      let uz = rt!.position.z - self.position.z;
      const ul = Math.sqrt(ux * ux + uz * uz);
      if (ul > 1e-6) { ux /= ul; uz /= ul; } else { ux = 0; uz = 0; }
      const lx = -uz;
      const lz = ux;
      const side = self.velocity.x * lx + self.velocity.z * lz >= 0 ? 1.0 : -1.0;
      let mx = side * lx + (1.0 + profile.aggression * 0.6) * ux;
      let mz = side * lz + (1.0 + profile.aggression * 0.6) * uz;
      const ml = Math.sqrt(mx * mx + mz * mz);
      if (ml > 1e-9) { mx /= ml; mz /= ml; } else { mx = 0; mz = 0; }
      direction = { x: mx, y: 0, z: mz };
      speedMultiplier = 1.0;
    }

    // 6. Layer 4: Optional Presentation & Camera Director
    const cameraDirective = this.computeCameraDirective(
      presentationMode,
      immediateCommand,
      profile
    );

    return {
      autonomyMode,
      behaviors,
      stance,
      interceptHumanInput,
      selectedUtilityAction: bestUtility.id,
      utilityScore: quantize(bestScore, 4),
      goapPlan: goapPlanNames,
      immediateCommand,
      steeringMove: direction,
      speedMultiplier: quantize(speedMultiplier, 3),
      punishWindow: counter !== null && immediateCommand === 'STRIKE_COMBO',
      cameraDirective,
    };
  }

  private evaluateStance(): TacticalStance {
    const bb = this.blackboard;
    if (bb.hostiles.length === 0) { this.defensiveHold = false; return 'STEALTH'; }
    if (bb.self.healthRatio < 0.28) { this.defensiveHold = false; return 'EVASIVE'; }
    // [CROWD-004] a punish window releases the defensive lock for exactly as long as it lasts;
    // once the enemy is back up the stance falls back to DEFENSIVE on the next tick.
    if (bb.counterTarget !== null && bb.imminentThreat === null) { this.defensiveHold = false; return 'BALANCED'; }
    if (bb.imminentThreat !== null || bb.pressureIndex > 0.72) { // [CORE-003] continuous (was a fixed 0.72)
      this.defensiveHold = true;
      return 'DEFENSIVE';
    }
    // [CROWD-004] hysteresis: leave DEFENSIVE only when the crowd actually thins out.
    if (this.defensiveHold && bb.pressureIndex > 0.55) return 'DEFENSIVE';
    this.defensiveHold = false;
    if (bb.profile.aggression >= 0.65 && bb.self.staminaRatio > 0.35) return 'AGGRESSIVE';
    return 'BALANCED';
  }

  private selectGoalForStance(stance: TacticalStance): WorldStateMap {
    switch (stance) {
      case 'EVASIVE':
        return { survived: true };
      case 'DEFENSIVE':
        return { threatNeutralized: true };
      case 'AGGRESSIVE':
      case 'BALANCED':
        return { enemyEliminated: true };
      case 'STEALTH':
      default:
        return { threatNeutralized: true };
    }
  }

  private computeCameraDirective(
    mode: PresentationMode,
    command: string,
    profile: BehaviorProfile
  ): CameraDirective {
    const targetId = this.blackboard.primaryTarget?.id ?? null;

    if (mode === 'TACTICAL') {
      return {
        mode: 'PASSIVE',
        timeScale: 1.0,
        fovMultiplier: 1.0,
        focusTargetId: targetId,
      };
    }

    if (mode === 'CINEMATIC_RESOLVE') {
      return {
        mode: 'FINISH_CUT',
        timeScale: 1.75,
        fovMultiplier: 0.82,
        focusTargetId: targetId,
      };
    }

    // CINEMATIC_LIVE: Action Director dynamically frames parries, finishers, and dodges
    if (command === 'EXECUTE_FINISHER' || command === 'DEFLECT_COUNTER') {
      return {
        mode: 'IMPACT_SLOWMO',
        timeScale: profile.cinematicFlair > 0.5 ? 0.35 : 0.65,
        fovMultiplier: 0.85,
        focusTargetId: targetId,
      };
    }

    return {
      mode: 'ACTION_TRACK',
      timeScale: 1.0,
      fovMultiplier: 0.92,
      focusTargetId: targetId,
    };
  }

  public static defaultUtilityActions(): UtilityAction[] {
    return [
      new UtilityAction('DEFLECT_COUNTER', [
        {
          name: 'ImminentStrike',
          evaluate: (bb) => (bb.imminentThreat ? 1.0 : 0.0),
          curve: Curves.linear,
        },
        {
          name: 'ProtagonistFlair',
          evaluate: (bb) => bb.profile.cinematicFlair * 0.5 + 0.5,
          curve: Curves.linear,
        },
      ]),
      new UtilityAction('EXECUTE_FINISHER', [
        {
          name: 'TargetNearDeath',
          evaluate: (bb) =>
            bb.primaryTarget ? 1.0 - bb.primaryTarget.healthRatio : 0.0,
          curve: Curves.logistic,
        },
        {
          name: 'CloseProximity',
          evaluate: (bb) => {
            if (!bb.primaryTarget) return 0;
            const d = distXZ(
              bb.primaryTarget.position.x,
              bb.primaryTarget.position.z,
              bb.self.position.x,
              bb.self.position.z
            );
            return Math.max(0, 1.0 - d / 3.5);
          },
          curve: Curves.quadratic,
        },
      ]),
      new UtilityAction('EVADE_REPOSITION', [
        {
          name: 'LowHealthUrgency',
          evaluate: (bb) => 1.0 - bb.self.healthRatio,
          curve: (x) => Curves.logistic(x, 12, 0.65),
        },
        {
          name: 'HighCrowdPressure',
          evaluate: (bb) => bb.pressureIndex,
          curve: Curves.linear,
        },
      ]),
      new UtilityAction('STRIKE_COMBO', [
        {
          name: 'StaminaAvailable',
          evaluate: (bb) => bb.self.staminaRatio,
          curve: Curves.linear,
        },
        {
          name: 'AggressionDrive',
          evaluate: (bb) => bb.profile.aggression,
          curve: Curves.linear,
        },
      ]),
    ];
  }

  public static defaultGoapActions(): GoapAction[] {
    return [
      {
        name: 'CLOSE_DISTANCE',
        preconditions: { hasHostiles: true },
        effects: { inMeleeRange: true, inPreferredRange: true },
        baseCost: 1.0,
      },
      {
        name: 'DEFLECT_COUNTER',
        preconditions: { underImminentAttack: true },
        effects: { underImminentAttack: false, threatNeutralized: true, targetVulnerable: true },
        baseCost: 0.6,
      },
      {
        name: 'HEAVY_ASSAULT',
        preconditions: { inMeleeRange: true, staminaSufficient: true },
        effects: { targetVulnerable: true },
        baseCost: 1.1,
      },
      {
        name: 'EXECUTE_FINISHER',
        preconditions: { inMeleeRange: true, targetVulnerable: true },
        effects: { enemyEliminated: true, threatNeutralized: true },
        baseCost: 0.4,
      },
      {
        name: 'TACTICAL_HEAL',
        preconditions: { healthCritical: true },
        effects: { healthCritical: false, survived: true },
        baseCost: 0.8,
      },
      {
        name: 'EVADE_TO_COVER',
        preconditions: { underImminentAttack: true },
        effects: { underImminentAttack: false, survived: true, threatNeutralized: true },
        baseCost: 0.9,
      },
    ];
  }
}
