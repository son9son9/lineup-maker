import loadHighs from 'highs';
import { solve } from './solver.js';
import { DEFAULT_FORMATION, DEFAULT_PLAYERS } from './defaults.js';
const data = { quarters: 4, fairnessWeight: 50, formation: DEFAULT_FORMATION, players: structuredClone(DEFAULT_PLAYERS) };
const highs = await loadHighs();
const a = solve(highs, data, 1);
const fx = q => a.lineup[q].flatMap(s => s.players.map(p => ({ p: p.idx, pos: s.pos })));
const key = l => l.map(s => s.pos + ':' + s.players.map(p => p.idx).sort().join('/')).join(' ');
// lock Q1, Q2, reroll 10x
data.fixed = [fx(0), fx(1), null, null];
let ok = true; const seen = new Set();
for (let i = 0; i < 10; i++) {
  const b = solve(highs, data, 100 + i);
  if (key(b.lineup[0]) !== key(a.lineup[0]) || key(b.lineup[1]) !== key(a.lineup[1])) ok = false;
  seen.add(key(b.lineup[2]) + key(b.lineup[3]));
  if (Math.max(...b.counts) - Math.min(...b.counts) > 1) ok = false;
}
console.log('locks kept & fair:', ok, '| distinct Q3/Q4:', seen.size, '/10');
// locked player becomes unavailable in Q1 → still forced; absent player removed → slot reopened
data.players[0].avail = [false, true, true, true];
let b = solve(highs, data, 7);
console.log('override avail ok:', key(b.lineup[0]) === key(a.lineup[0]));
const gone = fx(0)[3].p; // remove a locked player
data.fixed = [fx(0).filter(x => x.p !== gone), fx(1).filter(x => x.p !== gone), null, null];
data.players[gone].avail = [false,false,false,false];
b = solve(highs, data, 8);
console.log('reopened slot filled, vacancies:', JSON.stringify(b.vacancies), 'gone plays:', b.counts[gone]);
