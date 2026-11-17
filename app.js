import { solve } from './solver.js';
import { POSITIONS, DEFAULT_FORMATION, DEFAULT_PLAYERS } from './defaults.js';

const KEY = 'lineup-maker-v1';
const $ = s => document.querySelector(s);
const clone = o => JSON.parse(JSON.stringify(o));

const defaults = () => ({
  teamName: '쌔바 FC',
  quarters: 4,
  fairnessWeight: 50,
  formation: clone(DEFAULT_FORMATION),
  players: clone(DEFAULT_PLAYERS),
  result: null,
});

let state = load();
let curQ = 0;
let highsPromise = null;

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.players)) return { ...defaults(), ...s };
  } catch {}
  return defaults();
}
function save() { localStorage.setItem(KEY, JSON.stringify(state)); }
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), 1800);
}
function getHighs() {
  if (!highsPromise) highsPromise = import('./vendor/highs.mjs').then(m => m.default());
  return highsPromise;
}
const mainPos = p => Object.entries(p.skills).sort((a, b) => b[1] - a[1])[0]?.[0] || '-';
function normAvail(p) {
  const Q = state.quarters;
  if (!Array.isArray(p.avail)) p.avail = [];
  while (p.avail.length < Q) p.avail.push(true);
  p.avail.length = Q;
}
// 결과 자체를 무효화 (포메이션/쿼터 수/선수 삭제 등 구조 변경)
function invalidate() { state.result = null; save(); renderResult(); }
// 출석·가용·점수 변경: 결과와 잠금은 유지하고 '조건 바뀜' 표시만
function markStale() {
  if (state.result) { state.result.stale = true; }
  save(); renderResult();
}
const LOCK_SVG = '<svg class="lk" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke-width="1.6"/></svg>';

/* ---------- tabs ---------- */
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('on', p.id === 'tab-' + b.dataset.tab));
  if (b.dataset.tab === 'match') renderAttend();
}));

const teamInput = $('#teamName');
teamInput.addEventListener('input', () => { state.teamName = teamInput.value; save(); });

/* ---------- attendance ---------- */
function renderAttend() {
  const ul = $('#attendList'); ul.innerHTML = '';
  state.players.forEach(p => {
    normAvail(p);
    const li = document.createElement('li');
    const who = document.createElement('button');
    who.className = 'who' + (p.attending ? ' on' : '');
    who.innerHTML = `<span class="check"></span><span><span class="nm"></span>${p.merc ? '<span class="tag">용병</span>' : ''}<br><span class="main-pos">${mainPos(p)}</span></span>`;
    who.querySelector('.nm').textContent = p.name;
    who.addEventListener('click', () => { p.attending = !p.attending; markStale(); renderAttend(); });
    const qs = document.createElement('div');
    qs.className = 'qs' + (p.attending ? '' : ' dis');
    p.avail.forEach((a, q) => {
      const b = document.createElement('button');
      b.textContent = `Q${q + 1}`; b.className = a ? '' : 'off';
      b.title = a ? `${q + 1}쿼터 가능` : `${q + 1}쿼터 불가`;
      b.addEventListener('click', () => { p.avail[q] = !p.avail[q]; markStale(); renderAttend(); });
      qs.appendChild(b);
    });
    li.append(who, qs); ul.appendChild(li);
  });
  const n = state.players.filter(p => p.attending).length;
  const need = state.formation.reduce((s, f) => s + f.count, 0);
  const pill = $('#attendCount');
  pill.textContent = `${n}명 / 필요 ${need}`;
  pill.classList.toggle('bad', n < need);
}

$('#runBtn').addEventListener('click', async () => {
  const btn = $('#runBtn'), msg = $('#runMsg');
  const roster = state.players.map((p, i) => ({ ...p, _i: i })).filter(p => p.attending);
  msg.className = 'run-msg';
  if (!roster.length) { msg.textContent = '출석한 선수가 없어요.'; msg.classList.add('err'); return; }
  const prev = state.result;
  const locked = prev && prev.lineup.length === state.quarters ? (prev.locked || []).slice() : [];
  if (locked.length && locked.filter(Boolean).length === state.quarters) {
    msg.textContent = '모든 쿼터가 잠겨 있어요. 다시 돌릴 쿼터의 잠금을 풀어주세요.'; msg.classList.add('err'); return;
  }
  const rosterPos = new Map(roster.map((p, k) => [p._i, k]));
  const fixed = Array.from({ length: state.quarters }, (_, q) => locked[q]
    ? prev.lineup[q].flatMap(s => s.players.filter(pl => rosterPos.has(pl.idx)).map(pl => ({ p: rosterPos.get(pl.idx), pos: s.pos })))
    : null);
  const dropped = locked.reduce((n, l, q) => n + (l ? prev.lineup[q].reduce((a, s) => a + s.players.filter(pl => !rosterPos.has(pl.idx)).length, 0) : 0), 0);
  btn.disabled = true; btn.textContent = '계산 중…'; msg.textContent = '';
  try {
    const highs = await getHighs();
    const t0 = performance.now();
    const input = {
      quarters: state.quarters,
      fairnessWeight: state.fairnessWeight,
      formation: state.formation,
      players: roster.map(p => ({ name: p.name, skills: p.skills, avail: p.avail })),
      fixed,
    };
    // 동점 최적해 중 무작위 선택. 직전 결과와 같으면 몇 번 다시 뽑는다.
    const prevSig = state.result?.sig;
    let res, sig, tries = 0;
    do {
      res = solve(highs, input, Math.floor(Math.random() * 2 ** 31));
      if (!res.ok) throw new Error('해를 못 찾았어요 (' + res.status + ')');
      sig = res.lineup.map(q => q.map(s => s.players.map(p => roster[p.idx]._i).sort().join('.')).join('/')).join('|');
    } while (sig === prevSig && ++tries < 6);
    // roster index → state index
    res.lineup.forEach(q => q.forEach(s => s.players.forEach(pl => { pl.idx = roster[pl.idx]._i; })));
    state.result = {
      lineup: res.lineup, fit: res.fit, vacancies: res.vacancies, sig, round: (state.result?.round || 0) + 1,
      locked: Array.from({ length: state.quarters }, (_, q) => !!locked[q]),
      roster: roster.map(p => p._i), quarters: state.quarters, at: Date.now(),
    };
    save(); renderResult();
    const same = sig === prevSig;
    const nLock = locked.filter(Boolean).length;
    msg.textContent = `${state.result.round}번째 조합 · ${Math.round(performance.now() - t0)}ms` +
      (nLock ? ` · 잠긴 ${nLock}개 쿼터 유지` : '') +
      (dropped ? ` · 잠긴 쿼터의 불참자 ${dropped}명 자리는 새로 채움` : '') +
      (same ? ' · 이 조건에선 다른 최적 조합이 없어요' : ' · 다시 누르면 같은 점수의 다른 조합') +
      (res.vacancies.length ? ' · 공석 있음' : '');
    if (res.vacancies.length) msg.classList.add('err');
  } catch (e) {
    msg.textContent = e.message || String(e); msg.classList.add('err');
  } finally {
    btn.disabled = false; runLabel();
  }
});

/* ---------- result ---------- */
const SPOT = { GK: [50, 89, 0], LB: [13, 70, 0], CB: [50, 74, 32], RB: [87, 70, 0], CDM: [50, 55, 34],
  CAM: [50, 37, 30], LW: [15, 24, 0], RW: [85, 24, 0], ST: [50, 11, 26] };

function chipXY(pos, k, n) {
  const [x, y, spread] = SPOT[pos] || [50, 50, 30];
  if (n <= 1) return [x, y];
  const w = spread || 30;
  return [x - w / 2 + (w * k) / (n - 1), y];
}

function runLabel() { $('#runBtn').textContent = state.result ? '다른 조합 보기 ↻' : '라인업 짜기'; }

function renderResult() {
  const r = state.result;
  runLabel();
  $('#emptyState').hidden = !!r;
  $('#resultView').hidden = !r;
  if (!r) return;
  const Q = r.lineup.length;
  if (curQ >= Q) curQ = 0;

  // quarter tabs
  const qt = $('#qTabs'); qt.innerHTML = '';
  r.locked ||= Array(Q).fill(false);
  r.lineup.forEach((q, i) => {
    const fit = q.reduce((s, sl) => s + sl.players.reduce((a, p) => a + p.score, 0), 0);
    const b = document.createElement('button');
    b.className = (i === curQ ? 'on' : '') + (r.locked[i] ? ' locked' : '');
    b.innerHTML = `${r.locked[i] ? LOCK_SVG : ''}${i + 1}Q<span class="fit">적합도 ${fit}</span>`;
    b.setAttribute('aria-label', `${i + 1}쿼터${r.locked[i] ? ' (잠김)' : ''}`);
    b.addEventListener('click', () => { curQ = i; renderResult(); });
    qt.appendChild(b);
  });

  // 쿼터 도구: 잠금 / 다른 쿼터와 바꾸기
  const tools = $('#qTools'); tools.innerHTML = '';
  const lk = document.createElement('button');
  lk.className = 'lock-btn' + (r.locked[curQ] ? ' on' : '');
  lk.innerHTML = LOCK_SVG + (r.locked[curQ] ? `${curQ + 1}Q 잠김 · 해제` : `${curQ + 1}Q 잠그기`);
  lk.title = '잠근 쿼터는 다른 조합을 돌려도 그대로 유지돼요';
  lk.addEventListener('click', () => { r.locked[curQ] = !r.locked[curQ]; save(); renderResult(); });
  const sw = document.createElement('div'); sw.className = 'swap';
  sw.innerHTML = `<span>${curQ + 1}Q와 바꾸기</span>`;
  r.lineup.forEach((_, j) => {
    if (j === curQ) return;
    const b = document.createElement('button');
    b.textContent = `${j + 1}Q`;
    b.addEventListener('click', () => swapQuarters(curQ, j));
    sw.appendChild(b);
  });
  tools.append(lk, sw);
  $('.pitch-wrap').classList.toggle('is-locked', !!r.locked[curQ]);
  if (r.stale) {
    const m = $('#runMsg'); m.className = 'run-msg err';
    m.textContent = '출석/포지션이 바뀌었어요. 버튼을 누르면 잠긴 쿼터는 두고 나머지를 다시 짭니다.';
  }

  // pitch
  const chips = $('#chips'); chips.innerHTML = '';
  const formCount = Object.fromEntries(state.formation.map(f => [f.pos, f.count]));
  r.lineup[curQ].forEach(slot => {
    const n = Math.max(slot.players.length, formCount[slot.pos] || slot.players.length);
    for (let k = 0; k < n; k++) {
      const pl = slot.players[k];
      const [x, y] = chipXY(slot.pos, k, n);
      const c = document.createElement('div');
      const p = pl && state.players[pl.idx];
      c.className = 'chip ' + (pl ? 's' + pl.score : 'vac') + (slot.pos === 'GK' && pl ? ' gk' : '') + (p?.merc ? ' merc' : '');
      c.style.left = x + '%'; c.style.top = y + '%';
      c.innerHTML = `<div class="dot">${slot.pos}</div><div class="label"></div>`;
      c.querySelector('.label').textContent = pl ? (p?.name ?? pl.name) : '공석';
      c.title = pl ? `${slot.pos} · 적합도 ${pl.score}` : '공석';
      chips.appendChild(c);
    }
  });

  // bench
  const playing = new Set(r.lineup[curQ].flatMap(s => s.players.map(p => p.idx)));
  const bench = $('#bench'); bench.innerHTML = '';
  r.roster.filter(i => !playing.has(i)).forEach(i => {
    const p = state.players[i]; if (!p) return;
    const d = document.createElement('div'); d.className = 'bench-item';
    d.textContent = p.name;
    const sm = document.createElement('small');
    sm.textContent = p.avail?.[curQ] === false ? '이 쿼터 불가' : mainPos(p);
    d.appendChild(sm); bench.appendChild(d);
  });
  if (!bench.children.length) bench.innerHTML = '<div class="hint">없음</div>';
  bench.insertAdjacentHTML('beforeend', `<div class="legend">
    <span><i style="background:var(--bib);border-color:var(--bib)"></i>주포지션</span>
    <span><i style="background:#fff"></i>서브(2)</span>
    <span><i style="background:#fff;border-color:var(--warn)"></i>커버(1)</span></div>`);
  const vac = r.vacancies.filter(v => v.q === curQ);
  $('#vacancy').textContent = vac.length ? '공석: ' + vac.map(v => `${v.pos}${v.miss > 1 ? '×' + v.miss : ''}`).join(', ') + ' — 가능한 선수가 부족해요' : '';

  // matrix
  const cell = {}; // idx -> q -> {pos,score}
  r.lineup.forEach((q, qi) => q.forEach(s => s.players.forEach(p => { (cell[p.idx] ||= {})[qi] = { pos: s.pos, score: p.score }; })));
  const tbl = $('#matrix');
  let h = '<thead><tr><th>선수</th>' + r.lineup.map((_, i) => `<th>${r.locked[i] ? LOCK_SVG : ''}${i + 1}Q</th>`).join('') + '<th>출전</th></tr></thead><tbody>';
  const rows = r.roster.map(i => ({ i, p: state.players[i], n: Object.keys(cell[i] || {}).length })).filter(x => x.p);
  rows.forEach(({ i, p, n }) => {
    h += `<tr${playing.has(i) ? ' class="hl"' : ''}><td>${esc(p.name)}</td>`;
    for (let q = 0; q < Q; q++) {
      const c = cell[i]?.[q];
      h += c ? `<td class="p s${c.score}">${c.pos}</td>` : `<td class="b">${p.avail?.[q] === false ? '×' : '–'}</td>`;
    }
    h += `<td class="tot">${n}/${Q}</td></tr>`;
  });
  tbl.innerHTML = h + '</tbody>';
  const counts = rows.map(x => x.n);
  $('#summary').textContent = `총 적합도 ${r.fit} · 출전 쿼터 ${Math.min(...counts)}~${Math.max(...counts)} · 노란 칸=주포지션, 주황 글씨=커버 포지션, ×=불참 쿼터`;
}
function swapQuarters(a, b) {
  const r = state.result; if (!r) return;
  // 쿼터를 옮겼을 때 그 쿼터에 못 뛰는 사람 체크
  const bad = [];
  [[a, b], [b, a]].forEach(([from, to]) => r.lineup[from].forEach(s => s.players.forEach(pl => {
    const p = state.players[pl.idx];
    if (p && (p.avail?.[to] === false || !p.attending)) bad.push(`${p.name}(${to + 1}Q 불가)`);
  })));
  if (bad.length && !confirm(`바꾸면 못 뛰는 쿼터에 들어가는 선수가 있어요:\n${bad.join(', ')}\n\n그래도 바꿀까요?`)) return;
  [r.lineup[a], r.lineup[b]] = [r.lineup[b], r.lineup[a]];
  r.locked ||= Array(r.lineup.length).fill(false);
  [r.locked[a], r.locked[b]] = [r.locked[b], r.locked[a]];
  r.vacancies.forEach(v => { if (v.q === a) v.q = b; else if (v.q === b) v.q = a; });
  r.sig = r.lineup.map(q => q.map(s => s.players.map(p => p.idx).sort().join('.')).join('/')).join('|');
  curQ = b; save(); renderResult();
  toast(`${a + 1}Q ↔ ${b + 1}Q 바꿨어요`);
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

$('#copyBtn').addEventListener('click', async () => {
  const r = state.result; if (!r) return;
  const lines = [`[${state.teamName} 라인업]`];
  r.lineup.forEach((q, qi) => {
    lines.push('', `■ ${qi + 1}쿼터`);
    q.forEach(s => lines.push(`${s.pos.padEnd(4)} ${s.players.map(p => state.players[p.idx]?.name ?? p.name).join(', ') || '공석'}`));
    const playing = new Set(q.flatMap(s => s.players.map(p => p.idx)));
    const b = r.roster.filter(i => !playing.has(i)).map(i => state.players[i]?.name).filter(Boolean);
    if (b.length) lines.push(`벤치 ${b.join(', ')}`);
  });
  try { await navigator.clipboard.writeText(lines.join('\n')); toast('복사했어요'); }
  catch { prompt('아래 텍스트를 복사하세요', lines.join('\n')); }
});

/* ---------- players ---------- */
const CYCLE = { 0: 3, 3: 2, 2: 1, 1: 0 };
function renderPlayers() {
  const t = $('#skillTable');
  t.innerHTML = '<thead><tr><th>이름</th>' + POSITIONS.map(p => `<th>${p}</th>`).join('') + '<th></th><th></th></tr></thead>';
  const tb = document.createElement('tbody');
  state.players.forEach((p, i) => {
    const tr = document.createElement('tr');
    const tdn = document.createElement('td'); tdn.className = 'name';
    const inp = document.createElement('input'); inp.className = 'pname'; inp.value = p.name; inp.setAttribute('aria-label', '이름');
    inp.addEventListener('change', () => { p.name = inp.value.trim() || p.name; save(); renderAttend(); renderResult(); });
    tdn.appendChild(inp); tr.appendChild(tdn);
    POSITIONS.forEach(pos => {
      const td = document.createElement('td');
      const b = document.createElement('button');
      const v = p.skills[pos] || 0;
      b.className = 'sk v' + v; b.textContent = v || '·';
      b.setAttribute('aria-label', `${p.name} ${pos} ${v}점`);
      b.addEventListener('click', () => {
        const nv = CYCLE[p.skills[pos] || 0];
        if (nv) p.skills[pos] = nv; else delete p.skills[pos];
        markStale(); renderPlayers();
      });
      td.appendChild(b); tr.appendChild(td);
    });
    const tdm = document.createElement('td');
    const m = document.createElement('button'); m.className = 'merc-t' + (p.merc ? ' on' : ''); m.textContent = '용병';
    m.addEventListener('click', () => { p.merc = !p.merc; save(); renderPlayers(); });
    tdm.appendChild(m); tr.appendChild(tdm);
    const tdd = document.createElement('td');
    const d = document.createElement('button'); d.className = 'del'; d.textContent = '×'; d.setAttribute('aria-label', '삭제');
    d.addEventListener('click', () => { if (confirm(`${p.name} 삭제할까요?`)) { state.players.splice(i, 1); invalidate(); renderPlayers(); } });
    tdd.appendChild(d); tr.appendChild(tdd);
    tb.appendChild(tr);
  });
  t.appendChild(tb);
}
$('#addPlayer').addEventListener('click', () => {
  state.players.push({ name: `새 선수${state.players.length + 1}`, skills: {}, merc: false, attending: true, avail: Array(state.quarters).fill(true) });
  markStale(); renderPlayers();
  const inputs = document.querySelectorAll('.pname'); inputs[inputs.length - 1]?.select();
});

$('#exportBtn').addEventListener('click', () => {
  const { result, ...rest } = state;
  const blob = new Blob([JSON.stringify(rest, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `${state.teamName || 'team'}-lineup.json`; a.click();
});
$('#importFile').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!Array.isArray(d.players)) throw 0;
    state = { ...defaults(), ...d, result: null }; save(); renderAll(); toast('가져왔어요');
  } catch { toast('파일 형식이 맞지 않아요'); }
  e.target.value = '';
});
$('#resetBtn').addEventListener('click', () => {
  if (confirm('모든 선수/설정을 기본값으로 되돌릴까요?')) { state = defaults(); save(); renderAll(); }
});

/* ---------- formation ---------- */
function renderFormation() {
  const box = $('#formEditor'); box.innerHTML = '';
  POSITIONS.forEach(pos => {
    let f = state.formation.find(x => x.pos === pos);
    const d = document.createElement('div'); d.className = 'fpos';
    d.innerHTML = `<b>${pos}</b><div class="stepper"><button aria-label="${pos} 줄이기">−</button><span>${f?.count || 0}</span><button aria-label="${pos} 늘리기">+</button></div>`;
    const [minus, plus] = d.querySelectorAll('button');
    const set = n => {
      f = state.formation.find(x => x.pos === pos);
      if (!f) { f = { pos, count: 0 }; state.formation.push(f); state.formation.sort((a, b) => POSITIONS.indexOf(a.pos) - POSITIONS.indexOf(b.pos)); }
      f.count = Math.max(0, Math.min(5, n)); invalidate(); renderFormation();
    };
    minus.addEventListener('click', () => set((f?.count || 0) - 1));
    plus.addEventListener('click', () => set((f?.count || 0) + 1));
    box.appendChild(d);
  });
  const total = state.formation.reduce((s, f) => s + f.count, 0);
  $('#formTotal').textContent = `합계 ${total}명`;
  $('#quarters').value = state.quarters;
  $('#fairness').value = String(state.fairnessWeight);
}
$('#quarters').addEventListener('change', e => {
  state.quarters = Math.max(1, Math.min(6, parseInt(e.target.value) || 4));
  state.players.forEach(normAvail); invalidate(); renderFormation();
});
$('#fairness').addEventListener('change', e => { state.fairnessWeight = Number(e.target.value); invalidate(); });

function renderAll() {
  teamInput.value = state.teamName;
  renderAttend(); renderPlayers(); renderFormation(); renderResult();
}
renderAll();
getHighs().catch(() => {}); // 미리 로드
if (location.hash === '#run') $('#runBtn').click();
