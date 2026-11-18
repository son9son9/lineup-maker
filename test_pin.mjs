import loadHighs from 'highs';
import { solve } from './solver.js';
import { DEFAULT_FORMATION, DEFAULT_PLAYERS } from './defaults.js';
const highs = await loadHighs();
const mk = () => ({ quarters: 4, fairnessWeight: 50, formation: DEFAULT_FORMATION, players: structuredClone(DEFAULT_PLAYERS) });
const posOf = (r, p) => r.lineup.flatMap((q, qi) => q.flatMap(s => s.players.filter(x => x.idx === p).map(() => qi + 1 + s.pos)));
// 1) pin 송용협(0) to RW, 김효겸(10) to CB
let d = mk(); d.players[0].fixedPos = 'RW'; d.players[10].fixedPos = 'CB';
let r = solve(highs, d, 3);
console.log('pin 송용협 RW:', posOf(r, 0).join(','), '| 김효겸 CB:', posOf(r, 10).join(','), '| vac', r.vacancies.length, '| gap', Math.max(...r.counts) - Math.min(...r.counts));
// 2) pin to a position with no skill (김준혁 -> ST)
d = mk(); d.players[12].fixedPos = 'ST'; r = solve(highs, d, 4);
console.log('pin 김준혁 ST (no skill):', posOf(r, 12).join(',') || '(bench)', r.counts[12]);
// 3) slot lock: lock only 박성환(9) at LW in Q2, partial fixed
d = mk(); d.fixed = [null, [{ p: 9, pos: 'LW' }], null, null];
let same = true; for (let i = 0; i < 8; i++) { r = solve(highs, d, 50 + i); if (!posOf(r, 9).includes('2LW')) same = false; }
console.log('slot lock Q2 LW 박성환 kept x8:', same);
