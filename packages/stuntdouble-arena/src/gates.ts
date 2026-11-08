import type { RunResult, Scenario } from './sim.ts';

export interface GateResult { name: string; pass: boolean; detail: string }

export function avoidRatio(r: RunResult): number {
  return r.reactable > 0 ? 1 - (r.hit - r.unreactableHit) / r.reactable : 1;
}

export function evaluateGates(sc: Scenario, r: RunResult, baseline?: RunResult): GateResult[] {
  const g = sc.gates;
  const out: GateResult[] = [];
  const add = (name: string, pass: boolean, detail: string) => out.push({ name, pass, detail });
  if (g.survive) add('survive', r.survived, `hp ${r.hpEnd}/100`);
  if (g.winAll) add('winAll', r.enemiesKilled === r.enemiesTotal, `${r.enemiesKilled}/${r.enemiesTotal} killed in ${r.time}s`);
  if (g.minKills !== undefined) add('kills', r.enemiesKilled >= g.minKills, `${r.enemiesKilled} killed (need ${g.minKills}): defence must punish, not only kite`);
  if (g.minAvoid !== undefined) {
    const reactableHits = r.hit - r.unreactableHit;
    const ratio = r.reactable > 0 ? 1 - reactableHits / r.reactable : 1;
    add('avoid', ratio >= g.minAvoid, `${(ratio * 100).toFixed(0)}% of ${r.reactable} reactable telegraphs avoided (parry ${r.parried}, dodge ${r.dodged}, out-of-reach ${r.whiff}, hit ${reactableHits}; need ${(g.minAvoid * 100).toFixed(0)}%)`);
  }
  if (g.maxAttackCommands !== undefined) add('noOffense', r.attackCommands <= g.maxAttackCommands, `${r.attackCommands} attack commands`);
  add('steerStable', r.reversalRatio <= g.maxReversal, `reversal ${(r.reversalRatio * 100).toFixed(1)}% (max ${(g.maxReversal * 100).toFixed(0)}%)`);
  if (g.maxWall !== undefined) add('noWallHug', r.wallRatio <= g.maxWall, `${(r.wallRatio * 100).toFixed(1)}% of ticks at the edge (max ${(g.maxWall * 100).toFixed(0)}%)`);
  if (g.maxCmdShare !== undefined) add('noSpam', r.cmdTopShare <= g.maxCmdShare, `top command ${(r.cmdTopShare * 100).toFixed(0)}% of all commands (max ${(g.maxCmdShare * 100).toFixed(0)}%)`);
  if (g.noUnreactable) add('reactsToAll', r.unreactableHit === 0, `${r.unreactableHit} hits from telegraphs the brain could not see`);
  if (g.waypointsAll) add('waypoints', r.waypointsReached === r.waypointsTotal, `${r.waypointsReached}/${r.waypointsTotal}`);
  if (g.autoEngage) {
    const ok = r.standbyInputs === 0 && r.engageDelay >= 0 && r.engageDelay <= 0.2 && r.handbackDelay >= 1.9 && r.handbackDelay <= 2.3;
    add('autoEngage', ok, `${r.standbyInputs} inputs in standby, takeover ${r.engageDelay}s after first hostile, hand-back ${r.handbackDelay}s after last kill`);
  }
  if (g.beatsNative !== undefined && baseline) {
    const a = avoidRatio(r);
    const b = avoidRatio(baseline);
    add('beatsNative', a >= b + g.beatsNative && (r.survived || !baseline.survived) && r.hpEnd >= baseline.hpEnd,
      `with Stuntdouble: avoid ${(a * 100).toFixed(0)}% hp ${r.hpEnd} (${r.overrides} overrides, parry ${r.parried}); native only: avoid ${(b * 100).toFixed(0)}% hp ${baseline.hpEnd}${baseline.survived ? '' : ' (died)'}; need +${(g.beatsNative * 100).toFixed(0)} pts`);
  }
  if (g.zeroLockedInput) {
    add('lockedInput', r.lockedInputs === 0 && r.manualHandbackOk, `${r.lockedInputs} commands while locked, manual handback ${r.manualHandbackOk ? 'same tick' : 'LATE'}`);
  }
  return out;
}

export function gatePass(sc: Scenario, r: RunResult, baseline?: RunResult): boolean {
  return evaluateGates(sc, r, baseline).every((x) => x.pass);
}
