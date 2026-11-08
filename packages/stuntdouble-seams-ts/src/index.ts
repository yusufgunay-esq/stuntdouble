/**
 * Stuntdouble seam contract (stuntdouble-seams-ts)
 * Copyright (c) 2026 Yusuf Günay. Licensed under MPL-2.0.
 *
 * A real game adapter implements the three seams below and hands them to StuntRuntime.
 * The arena (packages/stuntdouble-arena) implements them against a simulator, so every
 * behaviour the runtime promises is exercised by tests before it touches a real game.
 */
import {
  StuntBrain,
  type StuntDecision,
  type AutonomyMode,
  type Behaviors,
  type BehaviorProfile,
  type EntitySnapshot,
  type PresentationMode,
  type Vec3,
} from '../../stuntdouble-brain-ts/src/index.ts';

/** Read side: what the game currently shows. Must be cheap and side-effect free. */
export interface PerceptionSeam {
  self(): EntitySnapshot;
  hostiles(): EntitySnapshot[];
  /** Current navigation / loot target, or undefined when there is none. */
  waypoint(): Vec3 | undefined;
}

/** Write side: the ONLY way Stuntdouble touches the game's controls. */
export interface InputSeam {
  /** Discrete brain command id (STRIKE_COMBO, DEFLECT_COUNTER, ...). */
  command(id: string): void;
  /** Movement on the XZ plane; direction is unit length (or zero), speed in [0, 1]. */
  steer(direction: Vec3, speed: number): void;
  /** Neutralise every control Stuntdouble holds and hand them back to the human. */
  release(): void;
}

/** Safety interlocks. Any true value means Stuntdouble must not drive the game. */
export interface InterlockSeam {
  cutscene(): boolean;
  menu(): boolean;
  loading(): boolean;
  /** The human grabbed the controls (stick / key / click). */
  manualOverride(): boolean;
}

/**
 * Optional: the game's own AI for the controlled character (S1 companion/elite-NPC brain,
 * S2 developer autoplay). When available, it is the base layer; Stuntdouble only overrides it in
 * its weak moments (see StuntRuntime). The override reason is recorded on every tick.
 */
export interface NativeProposal {
  command: string;
  /** Optional native movement; when absent the brain's steering is used. */
  steer?: { direction: Vec3; speed: number };
}
export interface NativeAiSeam {
  available(): boolean;
  proposeCommand(): NativeProposal | null;
}

export type RuntimeState =
  | 'OFF'          // disarmed (toggle) or engage:'manual' and not switched on
  | 'STANDBY'      // engage:'onCombat': armed, no combat, human plays
  | 'LOCKED'       // cutscene / menu / loading: Stuntdouble is inert
  | 'MANUAL'       // human override: Stuntdouble is inert, resumes when the override ends
  | 'PASS_THROUGH' // brain decided the human keeps control this tick
  | 'ACTIVE';      // brain drives the input seam

export interface RuntimeOptions {
  perception: PerceptionSeam;
  input: InputSeam;
  interlock: InterlockSeam;
  profile: BehaviorProfile;
  /** Legacy mode name or flag mask. Default FULL_COMBAT. */
  behaviors?: AutonomyMode | Behaviors;
  presentation?: PresentationMode;
  brain?: StuntBrain;
  /**
   * 'onCombat' (default): take over when a hostile is perceived, give control back after the
   * fight (no hostile for handbackSeconds). Behaviors containing CRUISE stay engaged (explicit autopilot).
   * 'manual': Stuntdouble drives only while switched on with toggle() (bind any key you like via toggleKey).
   */
  engage?: 'onCombat' | 'manual';
  /** Informational: the key the adapter binds to toggle() in manual mode (no fixed default key). */
  toggleKey?: string;
  /** Seconds without hostiles before onCombat hands control back. Default 2. */
  handbackSeconds?: number;
  /** Optional native AI base layer. */
  native?: NativeAiSeam;
  /** false = follow the native AI blindly (baseline for the arena). Default true. */
  overrideNative?: boolean;
  /** Start enabled. Default: true for onCombat, false for manual. */
  enabled?: boolean;
}

/** Why Stuntdouble replaced the native AI's proposal this tick. */
export interface OverrideRecord {
  reason: 'imminent-strike' | 'low-health' | 'defensive-no-offense' | 'punish-window';
  native: string;
  used: string;
}

export interface RuntimeTick {
  state: RuntimeState;
  decision: StuntDecision | null;
  override?: OverrideRecord;
}

const REFLEX = new Set(['DEFLECT_COUNTER', 'EVADE_REPOSITION', 'EVADE_TO_COVER', 'TACTICAL_HEAL']);
const OFFENSE = new Set(['STRIKE_COMBO', 'HEAVY_ASSAULT', 'EXECUTE_FINISHER']);

export class StuntRuntime {
  public enabled: boolean;
  public profile: BehaviorProfile;
  public behaviors: AutonomyMode | Behaviors;
  public presentation: PresentationMode;
  public lastState: RuntimeState = 'OFF';
  public readonly brain: StuntBrain;
  private readonly perception: PerceptionSeam;
  private readonly input: InputSeam;
  private readonly interlock: InterlockSeam;
  public readonly engage: 'onCombat' | 'manual';
  public readonly toggleKey?: string;
  public readonly overrides: OverrideRecord[] = [];
  private readonly handbackSeconds: number;
  private readonly native?: NativeAiSeam;
  private readonly overrideNative: boolean;
  private engaged = false;
  private calm = 0;
  private holding = false;

  constructor(o: RuntimeOptions) {
    this.perception = o.perception;
    this.input = o.input;
    this.interlock = o.interlock;
    this.profile = o.profile;
    this.behaviors = o.behaviors ?? 'FULL_COMBAT';
    this.presentation = o.presentation ?? 'TACTICAL';
    this.brain = o.brain ?? new StuntBrain();
    this.engage = o.engage ?? 'onCombat';
    this.toggleKey = o.toggleKey;
    this.handbackSeconds = o.handbackSeconds ?? 2;
    this.native = o.native;
    this.overrideNative = o.overrideNative ?? true;
    this.enabled = o.enabled ?? this.engage === 'onCombat';
  }

  /** Bind to any key. Switching off releases anything Stuntdouble holds immediately. */
  public toggle(): boolean {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  public setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.letGo();
  }

  public setProfile(p: BehaviorProfile): void {
    this.profile = p;
  }

  public setBehaviors(b: AutonomyMode | Behaviors): void {
    this.behaviors = b;
  }

  public isLocked(): boolean {
    return this.interlock.cutscene() || this.interlock.menu() || this.interlock.loading();
  }

  /** One control step. Call at the game's decision rate; dtSeconds feeds the onCombat hand-back timer. */
  public tick(dtSeconds = 0): RuntimeTick {
    // Inert states never read the world and never write a command or steering value;
    // the only call they may make is a single neutral release() when Stuntdouble was holding.
    if (!this.enabled) return this.inert('OFF');
    if (this.isLocked()) return this.inert('LOCKED');
    if (this.interlock.manualOverride()) return this.inert('MANUAL');

    const self = this.perception.self();
    const hostiles = this.perception.hostiles();
    if (this.engage === 'onCombat') {
      const cruise = typeof this.behaviors === 'number' ? (this.behaviors & 4) !== 0 : this.behaviors === 'GRIND_AUTOPILOT';
      if (!cruise) {
        if (hostiles.some((h) => h.healthRatio > 0)) {
          this.engaged = true;
          this.calm = 0;
        } else if (this.engaged) {
          this.calm += dtSeconds;
          if (this.calm >= this.handbackSeconds) this.engaged = false;
        }
        if (!this.engaged) return this.inert('STANDBY');
      }
    }

    const decision = this.brain.tick(
      self,
      hostiles,
      this.profile,
      this.presentation,
      this.behaviors,
      this.perception.waypoint()
    );

    if (!decision.interceptHumanInput) {
      this.letGo();
      this.lastState = 'PASS_THROUGH';
      return { state: 'PASS_THROUGH', decision };
    }
    let command = decision.immediateCommand;
    let steer = { direction: decision.steeringMove, speed: decision.speedMultiplier };
    let override: OverrideRecord | undefined;
    const proposal =
      this.native && this.native.available() && hostiles.length > 0 ? this.native.proposeCommand() : null;
    if (proposal) {
      // Native AI is the base layer; Stuntdouble only overrides its weak moments.
      let reason: OverrideRecord['reason'] | null = null;
      if (this.overrideNative) {
        if (decision.punishWindow && proposal.command !== command) {
          // A defended strike opens a short recovery window; losing it to the native AI's
          // "keep closing" command is how the layered agent used to bleed out in a crowd.
          reason = 'punish-window';
        } else if (REFLEX.has(command) && proposal.command !== command) {
          reason = self.healthRatio < 0.3 ? 'low-health' : 'imminent-strike';
        } else if ((decision.behaviors & 8) !== 0 && OFFENSE.has(proposal.command)) {
          reason = 'defensive-no-offense';
        }
      }
      if (reason) {
        override = { reason, native: proposal.command, used: command };
        this.overrides.push(override);
      } else {
        command = proposal.command;
        // Danger context (DEFENSIVE / EVASIVE stance): the native command stands, but positioning stays
        // with Stuntdouble; the native AI is not allowed to walk the player back into the fight.
        const danger = decision.stance === 'DEFENSIVE' || decision.stance === 'EVASIVE';
        if (proposal.steer && !(this.overrideNative && danger)) steer = proposal.steer;
      }
    }
    this.input.command(command);
    this.input.steer(steer.direction, steer.speed);
    this.holding = true;
    this.lastState = 'ACTIVE';
    return { state: 'ACTIVE', decision, override };
  }

  private inert(state: RuntimeState): RuntimeTick {
    this.letGo();
    this.lastState = state;
    return { state, decision: null };
  }

  private letGo(): void {
    if (this.holding) {
      this.holding = false;
      this.input.release();
    }
  }
}
