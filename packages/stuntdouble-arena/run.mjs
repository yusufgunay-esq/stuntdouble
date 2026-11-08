#!/usr/bin/env node
/**
 * Stuntdouble arena runner.
 *   node packages/stuntdouble-arena/run.mjs [--scenario id] [--seed n] [--json] [--html out.html]
 *   node packages/stuntdouble-arena/run.mjs --compare [--scenario arena_t3]   (4 agents x seeds 1-8 per hard tier; exit 1 if the fixed hard-tier gate fails)
 * Exit code 1 if any gate fails. Copyright (c) 2026 Yusuf Günay. MPL-2.0.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (!process.features.typescript) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const { writeFileSync } = await import('node:fs');
const { SCENARIOS, TIER_SCENARIOS } = await import('./src/scenarios.ts');
const { compare, compareGate, COMPARE_SEEDS } = await import('./src/compare.ts');
const { runScenario } = await import('./src/sim.ts');
const { evaluateGates } = await import('./src/gates.ts');
const { renderHtml } = await import('./src/html.ts');

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const only = opt('--scenario');
const seed = Number(opt('--seed') ?? 1);
const htmlOut = opt('--html');
const json = argv.includes('--json');

if (argv.includes('--compare')) {
  const tiers = only ? TIER_SCENARIOS.filter((s) => s.id === only) : TIER_SCENARIOS;
  if (!tiers.length) { console.error('unknown tier: ' + only + ' (have: ' + TIER_SCENARIOS.map((s) => s.id).join(', ') + ')'); process.exit(2); }
  let ok = true;
  console.log(`Stuntdouble arena compare  seeds=${COMPARE_SEEDS[0]}-${COMPARE_SEEDS[COMPARE_SEEDS.length - 1]}`);
  for (const sc of tiers) {
    const st = compare(sc, COMPARE_SEEDS);
    console.log('');
    console.log(`${sc.id}  ${sc.title}`);
    console.log('  agent                 survived  hp end  damage  hits  kills');
    for (const r of st) console.log(`  ${r.label.padEnd(21)} ${(r.survived + '/' + r.runs).padStart(8)}  ${r.hpEnd.toFixed(0).padStart(6)}  ${r.damage.toFixed(0).padStart(6)}  ${r.hits.toFixed(1).padStart(4)}  ${r.kills.toFixed(1).padStart(5)}`);
    if (sc.tier !== undefined && sc.tier >= 3) {
      const g = compareGate(st, sc.id);
      ok &&= g.pass;
      for (const d of g.detail) console.log('  ' + d);
    }
  }
  console.log(ok ? 'COMPARE GATE PASS' : 'COMPARE GATE FAILED');
  process.exit(ok ? 0 : 1);
}

const all = [...SCENARIOS, ...TIER_SCENARIOS];
const list = only ? all.filter((s) => s.id === only) : all;
if (!list.length) { console.error('unknown scenario: ' + only + ' (have: ' + all.map((s) => s.id).join(', ') + ')'); process.exit(2); }

const rows = [];
let allPass = true;
for (const sc of list) {
  const result = runScenario(sc, seed, { record: !!htmlOut });
  const baseline = sc.native ? runScenario(sc, seed, { nativeOnly: true }) : undefined;
  const gates = evaluateGates(sc, result, baseline);
  const pass = gates.every((g) => g.pass);
  allPass &&= pass;
  rows.push({ sc, result, gates, pass });
}

if (htmlOut) {
  writeFileSync(htmlOut, renderHtml(rows.map((r) => ({ id: r.sc.id, title: r.sc.title, obstacles: r.sc.obstacles, waypoints: r.sc.waypoints ?? [], result: r.result, gates: r.gates }))));
  console.error('wrote ' + htmlOut);
}

if (json) {
  console.log(JSON.stringify(rows.map((r) => ({ scenario: r.sc.id, pass: r.pass, gates: r.gates, result: { ...r.result, steps: undefined } })), null, 2));
} else {
  console.log(`Stuntdouble arena  seed=${seed}`);
  for (const r of rows) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.sc.id.padEnd(14)} ${r.sc.title}`);
    for (const g of r.gates) console.log(`        ${g.pass ? 'ok  ' : 'FAIL'} ${g.name.padEnd(12)} ${g.detail}`);
  }
  console.log(allPass ? 'ALL GATES PASS' : 'GATES FAILED');
}
process.exit(allPass ? 0 : 1);
