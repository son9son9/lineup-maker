import loadHighs from 'highs';
import { solve } from './solver.js';
import { DEFAULT_FORMATION, DEFAULT_PLAYERS } from './defaults.js';
const data = { quarters: 4, fairnessWeight: 50, formation: DEFAULT_FORMATION, players: structuredClone(DEFAULT_PLAYERS) };
const highs = await loadHighs();
const base = solve(highs, data);
const sigs = new Set(); const sortedSigs = new Set(); const fits = new Set(); const gaps=new Set();
for (let i = 0; i < 20; i++) {
  const r = solve(highs, data, Math.floor(Math.random()*2**31));
  const qs = r.lineup.map(q => q.map(s => s.pos + ':' + s.players.map(p => p.name).sort().join('/')).join(' '));
  sigs.add(qs.join('|')); sortedSigs.add([...qs].sort().join('|')); fits.add(r.fit);
  gaps.add(Math.max(...r.counts)-Math.min(...r.counts));
}
console.log('base fit', base.fit, '| random fits', [...fits], 'gaps', [...gaps]);
console.log('distinct lineups', sigs.size, '/20 ; distinct ignoring quarter order', sortedSigs.size);
