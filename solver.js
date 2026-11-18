// 쿼터별 라인업 최적화 (HiGHS MILP). 브라우저/Node 공용 ES module.
// data = { formation: [{pos:'GK', count:1}, ...], quarters: 4,
//          players: [{name, skills:{POS:score}, avail:[true,true,true,true], fixedPos?:'LW'}],
//          fairnessWeight: 50, fixed: [null, [{p, pos}], ...] }
// highs = loadHighs() 결과 인스턴스

// 시드 기반 난수 (mulberry32)
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// seed가 있으면 각 변수에 아주 작은 랜덤 보너스를 더해 '동점 최적해' 중 하나를 무작위로 고른다.
// 보너스 총합 < 1 이고 원래 목적함수는 정수라서, 최적이 아닌 해가 뽑히는 일은 없다.
export function buildLP(data, seed) {
  const Q = data.quarters;
  const W = data.fairnessWeight ?? 50;
  const players = data.players;
  const forms = data.formation.filter(f => f.count > 0);
  // data.fixed[q] = [{p, pos}] 이면 그 쿼터는 잠금: 해당 배치를 강제(가용여부/점수 무시).
  // 잠긴 쿼터라도 빈 자리(불참자 등)는 다른 선수로 채울 수 있다.
  const fixed = data.fixed || [];
  const vars = []; // {name,p,q,pos,score,fix}
  players.forEach((pl, p) => {
    for (let q = 0; q < Q; q++) {
      const f = fixed[q]?.find(a => a.p === p);
      if (f) {
        const i = forms.findIndex(x => x.pos === f.pos);
        if (i >= 0) { vars.push({ name: `x_${p}_${q}_${i}`, p, q, pos: f.pos, i, score: pl.skills[f.pos] || 0, fix: true }); continue; }
      }
      if (pl.avail && pl.avail[q] === false) continue;
      // 포지션 고정(pl.fixedPos): 뛸 때는 그 포지션만 (점수 없어도 허용)
      const pin = pl.fixedPos && forms.findIndex(x => x.pos === pl.fixedPos);
      if (pin != null && pin !== false && pin >= 0) {
        vars.push({ name: `x_${p}_${q}_${pin}`, p, q, pos: pl.fixedPos, i: pin, score: pl.skills[pl.fixedPos] || 0 });
        continue;
      }
      forms.forEach((f, i) => {
        const s = pl.skills[f.pos];
        if (s && s > 0) vars.push({ name: `x_${p}_${q}_${i}`, p, q, pos: f.pos, i, score: s });
      });
    }
  });

  const L = [];
  const slacks = [];
  const totalSlots = data.formation.reduce((a, f) => a + Math.max(0, f.count), 0) * Q;
  const rand = seed == null ? null : rng(seed);
  const eps = 0.9 / Math.max(1, totalSlots);
  const obj = vars.map(v => `+ ${rand ? (v.score + rand() * eps).toFixed(8) : v.score} ${v.name}`);
  obj.push(`- ${W} mx`, `+ ${W} mn`);
  for (let q = 0; q < Q; q++) forms.forEach((_, i) => obj.push(`- 10000 s_${q}_${i}`));
  L.push('Maximize', ' obj: ' + chunk(obj));
  L.push('Subject To');
  let c = 0;
  // 슬롯 채우기
  for (let q = 0; q < Q; q++) {
    forms.forEach((f, i) => {
      const vs = vars.filter(v => v.q === q && v.i === i).map(v => `+ ${v.name}`);
      vs.push(`+ s_${q}_${i}`); slacks.push({ name: `s_${q}_${i}`, count: f.count });
      L.push(` c${c++}: ${chunk(vs)} = ${f.count}`);
    });
  }
  // 한 쿼터 한 포지션
  players.forEach((_, p) => {
    for (let q = 0; q < Q; q++) {
      const vs = vars.filter(v => v.p === p && v.q === q).map(v => `+ ${v.name}`);
      if (vs.length > 1) L.push(` c${c++}: ${chunk(vs)} <= 1`);
    }
  });
  // 잠금 강제
  vars.filter(v => v.fix).forEach(v => L.push(` c${c++}: ${v.name} = 1`));
  // 공정성: mx >= pc_p, mn <= pc_p + (Q - 뛸 수 있는 쿼터 수)
  players.forEach((pl, p) => {
    const mine = vars.filter(v => v.p === p);
    const vs = mine.map(v => `+ ${v.name}`);
    const availQ = new Set(mine.map(v => v.q)).size;
    if (availQ === 0) return;
    const sum = vs.length ? chunk(vs) : '0 mx';
    L.push(` c${c++}: ${sum} - mx <= 0`);
    L.push(` c${c++}: ${sum} - mn >= ${-(Q - availQ)}`);
  });
  L.push('Bounds', ` 0 <= mx <= ${Q}`, ` 0 <= mn <= ${Q}`, ...slacks.map(x => ` 0 <= ${x.name} <= ${x.count}`));
  if (vars.length) L.push('Binary', ...chunkLines(vars.map(v => v.name)));
  L.push('End');
  return { lp: L.join('\n'), vars };
}

function chunk(terms) {
  // HiGHS LP reader 줄 길이 제한 회피
  const out = []; for (let i = 0; i < terms.length; i += 20) out.push(terms.slice(i, i + 20).join(' '));
  return out.join('\n   ');
}
function chunkLines(names) {
  const out = []; for (let i = 0; i < names.length; i += 20) out.push(' ' + names.slice(i, i + 20).join(' '));
  return out;
}

export function solve(highs, data, seed) {
  const { lp, vars } = buildLP(data, seed);
  const res = highs.solve(lp, { time_limit: 20, mip_rel_gap: 0 , output_flag: false});
  if (res.Status !== 'Optimal' && res.Status !== 'Time limit reached') {
    return { ok: false, status: res.Status };
  }
  const Q = data.quarters;
  const forms = data.formation.filter(f => f.count > 0);
  const lineup = Array.from({ length: Q }, () => forms.map(f => ({ pos: f.pos, players: [] })));
  const counts = data.players.map(() => 0);
  let fit = 0;
  for (const v of vars) {
    const col = res.Columns[v.name];
    if (col && col.Primal > 0.5) {
      lineup[v.q][v.i].players.push({ idx: v.p, name: data.players[v.p].name, score: v.score });
      counts[v.p]++; fit += v.score;
    }
  }
  const vacancies = [];
  lineup.forEach((q, qi) => q.forEach((s, i) => {
    const miss = forms[i].count - s.players.length;
    if (miss > 0) vacancies.push({ q: qi, pos: s.pos, miss });
  }));
  return { ok: true, status: res.Status, lineup, counts, fit, vacancies };
}
