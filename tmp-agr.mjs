import { TIER_SCENARIOS } from './packages/stuntdouble-arena/src/scenarios.ts';
import { runScenario } from './packages/stuntdouble-arena/src/sim.ts';
const sc = TIER_SCENARIOS.find(s=>s.id==='t4_crowd');
const seeds=[1,2,3,4,5,6];
for (const a of [0.3,0.45,0.6]) {
  let sum=0, kills=0, surv=0;
  for (const s of seeds) { const r=runScenario(sc,s,{profile:{...sc.profile,aggression:a}}); sum+=r.attackCommands/Math.max(1,r.stateTicks.ACTIVE??1); kills+=r.enemiesKilled; if(r.survived)surv++; }
  console.log(a,'rate',(sum/seeds.length).toFixed(4),'kills',(kills/seeds.length).toFixed(1),'surv',surv);
}
