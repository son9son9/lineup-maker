// 쿼터별 라인업 최적화 (HiGHS MILP). 브라우저/Node 공용 ES module.
// data = { formation: [{pos:'GK', count:1}, ...], quarters: 4,
//          players: [{name, skills:{POS:score}, avail:[true,true,true,true]}],
//          fairnessWeight: 50 }
// highs = loadHighs() 결과 인스턴스

export function buildLP(data) {
  const Q = data.quarters;
  const W = data.fairnessWeight ?? 50;
  const players = data.players;
  const forms = data.formation.filter(f => f.count > 0);
  const vars = []; // {name,p,q,pos,score}
  players.forEach((pl, p) => {
    for (let q = 0; q < Q; q++) {
      if (pl.avail && pl.avail[q] === false) continue;
      forms.forEach((f, i) => {
        const s = pl.skills[f.pos];
        if (s && s > 0) vars.push({ name: `x_${p}_${q}_${i}`, p, q, pos: f.pos, i, score: s });
      });
    }
  });

  const L = [];
  const slacks = [];
  const obj = vars.map(v => `+ ${v.score} ${v.name}`);
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
  // 공정성: mx >= pc_p, mn <= pc_p + (Q - avail_p)
  players.forEach((pl, p) => {
    const vs = vars.filter(v => v.p === p).map(v => `+ ${v.name}`);
    const availQ = pl.avail ? pl.avail.filter(Boolean).length : Q;
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

export function solve(highs, data) {
  const { lp, vars } = buildLP(data);
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
