// 상태 · 날짜 · 판정 로직 (화면과 분리 — node 로도 테스트 가능)
(function (root) {
  const M = (typeof module !== 'undefined' && module.exports) ? require('./match.js') : root.Match;

  const MEALS = ['아침', '점심', '저녁'];
  const UNITS = ['개', 'g', 'kg', 'ml', 'L', '대', '단', '모', '통', '줌', '컵', '큰술', '작은술', '장', '팩'];

  // 유아식에 자주 쓰는 재료 (자동완성 기본 목록)
  const COMMON = [
    ['양파', '개'], ['대파', '대'], ['쪽파', '줌'], ['당근', '개'], ['애호박', '개'], ['감자', '개'], ['고구마', '개'],
    ['단호박', '개'], ['브로콜리', '개'], ['콜리플라워', '개'], ['양배추', '통'], ['알배추', '통'], ['시금치', '단'],
    ['청경채', '개'], ['비타민', '줌'], ['무', '개'], ['오이', '개'], ['가지', '개'], ['파프리카', '개'], ['토마토', '개'],
    ['표고버섯', '개'], ['새송이버섯', '개'], ['양송이버섯', '개'], ['느타리버섯', '줌'], ['팽이버섯', '팩'],
    ['소고기 안심', 'g'], ['소고기 다짐육', 'g'], ['소고기 우둔', 'g'], ['닭가슴살', 'g'], ['닭안심', 'g'], ['돼지고기 안심', 'g'],
    ['대구살', 'g'], ['연어', 'g'], ['흰살생선', 'g'], ['새우', 'g'], ['두부', '모'], ['달걀', '개'], ['치즈', '장'],
    ['쌀', 'g'], ['찹쌀', 'g'], ['오트밀', 'g'], ['현미', 'g'], ['사과', '개'], ['배', '개'], ['바나나', '개'],
    ['아보카도', '개'], ['블루베리', 'g'], ['다시마', '장'], ['멸치', 'g'], ['김', '장'], ['참기름', '작은술'], ['들기름', '작은술'], ['우유', 'ml'],
  ];

  // ---------- 날짜 ----------
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const mondayOf = s => { const d = parse(s); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return iso(d); };
  const todayIso = () => iso(new Date());
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  const dow = s => DOW[parse(s).getDay()];
  const md = s => { const d = parse(s); return `${pad(d.getMonth() + 1)}.${pad(d.getDate())}`; };

  // ---------- 수량 ----------
  const fmtQ = q => { const r = Math.round(q * 100) / 100; return String(r); };
  function toBase(q, u) {
    if (u === 'kg') return [q * 1000, 'g'];
    if (u === 'L') return [q * 1000, 'ml'];
    return [q, u];
  }
  function fmtAmt(q, u) {
    if (u === 'g' && q >= 1000) return fmtQ(q / 1000) + 'kg';
    if (u === 'ml' && q >= 1000) return fmtQ(q / 1000) + 'L';
    return fmtQ(q) + u;
  }

  // ---------- 상태 ----------
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const now = () => Date.now();
  const empty = () => ({ v: 1, fridge: [], menus: [], aliases: {}, recipes: {} });
  const alive = a => a.filter(x => !x.deleted);

  function mergeById(a = [], b = []) {
    const m = new Map();
    for (const x of a) m.set(x.id, x);
    for (const y of b) { const x = m.get(y.id); if (!x || (y.updatedAt || 0) > (x.updatedAt || 0)) m.set(y.id, y); }
    const cutoff = now() - 30 * 864e5;
    return [...m.values()].filter(x => !(x.deleted && (x.updatedAt || 0) < cutoff));
  }
  function merge(a, b) {
    if (!a) return b; if (!b) return a;
    const al = { ...(a.aliases || {}) };
    for (const [k, v] of Object.entries(b.aliases || {})) if (!al[k] || (v.t || 0) > (al[k].t || 0)) al[k] = v;
    const rc = { ...(a.recipes || {}) };
    for (const [k, v] of Object.entries(b.recipes || {})) {
      const o = rc[k];
      if (!o) { rc[k] = v; continue; }
      const win = (v.updatedAt || 0) > (o.updatedAt || 0) ? v : o;
      // 피드백은 둘 다 합친다 (id 기준, 지운 건 deleted 표시로 남김)
      rc[k] = { ...win, notes: mergeById(o.notes || [], v.notes || []) };
    }
    return { v: 1, fridge: mergeById(a.fridge, b.fridge), menus: mergeById(a.menus, b.menus), aliases: al, recipes: rc };
  }

  function catalog(S) {
    const m = new Map();
    for (const [n, u] of COMMON) m.set(n, { name: n, unit: u });
    for (const mm of alive(S.menus)) for (const g of mm.ings || []) if (g.name) m.set(g.name, { name: g.name, unit: g.unit });
    for (const f of alive(S.fridge)) m.set(f.name, { name: f.name, unit: f.unit, hint: '냉장고 ' + fmtQ(f.qty) + f.unit });
    return [...m.values()];
  }
  const aliasMap = S => Object.fromEntries(Object.entries(S.aliases || {}).map(([k, v]) => [k, v.to]));

  // 냉장고 총량 (재료 canon|기준단위 → 수량)
  function stockMap(S) {
    const st = new Map();
    for (const f of alive(S.fridge)) {
      if (!(f.qty > 0)) continue;
      const [q, u] = toBase(f.qty, f.unit);
      const k = M.canon(f.name) + '|' + u;
      st.set(k, (st.get(k) || 0) + q);
    }
    return st;
  }
  function unitsOf(st, name) {
    const c = M.canon(name) + '|';
    return [...st.keys()].filter(k => k.startsWith(c)).map(k => [k.slice(c.length), st.get(k)]);
  }

  const mealIdx = m => Math.max(0, MEALS.indexOf(m));
  // 같은 끼니 안 순서: 사용자가 정한 ord 먼저, 없으면 만든 순서
  // ---------- 같은 끼니 안 순서 ----------
  // 1) 직접 순서를 정한 끼니(전부 ord 있음)는 그 순서
  // 2) 아니면, 메뉴 구성이 똑같은 다른 끼니 중 가장 최근에 직접 정한 순서(템플릿)를 따름
  // 3) 둘 다 없으면 만든 순서
  const slotKey = names => names.slice().sort().join('\u0001');
  let TPL = new Map(); // 구성 키 → { names:[순서], at }
  function buildTemplates(menus) {
    const g = new Map();
    for (const m of menus) { if (m.deleted) continue; const k = m.date + '|' + m.meal; (g.get(k) || g.set(k, []).get(k)).push(m); }
    const tpl = new Map();
    for (const arr of g.values()) {
      if (arr.length < 2 || !arr.every(m => m.ord != null)) continue;
      const at = Math.max(...arr.map(m => m.ordAt || 0));
      const names = arr.slice().sort((a, b) => a.ord - b.ord).map(m => m.name);
      const k = slotKey(names), cur = tpl.get(k);
      if (!cur || at > cur.at) tpl.set(k, { names, at });
    }
    TPL = tpl;
    return tpl;
  }
  function orderSlot(arr) {
    const byCreated = arr.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    if (arr.length > 1 && arr.every(m => m.ord != null)) return arr.slice().sort((a, b) => a.ord - b.ord || (a.createdAt || 0) - (b.createdAt || 0));
    const t = arr.length > 1 && TPL.get(slotKey(arr.map(m => m.name)));
    if (!t) return arr.some(m => m.ord != null) ? arr.slice().sort((a, b) => (a.ord ?? 1e9) - (b.ord ?? 1e9) || (a.createdAt || 0) - (b.createdAt || 0)) : byCreated;
    const pool = byCreated.slice(), out = [];
    for (const n of t.names) { const i = pool.findIndex(m => m.name === n); if (i >= 0) out.push(pool.splice(i, 1)[0]); }
    return out.concat(pool);
  }
  function sortMenus(arr) {
    const g = new Map();
    for (const m of arr) { const k = m.date + '|' + m.meal; (g.get(k) || g.set(k, []).get(k)).push(m); }
    const keys = [...g.keys()].sort((a, b) => { const [da, ma] = a.split('|'), [db, mb] = b.split('|'); return da.localeCompare(db) || mealIdx(ma) - mealIdx(mb); });
    return keys.flatMap(k => orderSlot(g.get(k)));
  }
  // 자동 정렬: 템플릿과 순서가 다른 끼니를 템플릿대로 맞춤 → 바뀐 끼니 목록
  function autoSortPlan(menus) {
    buildTemplates(menus);
    const g = new Map();
    for (const m of menus) { if (m.deleted) continue; const k = m.date + '|' + m.meal; (g.get(k) || g.set(k, []).get(k)).push(m); }
    const changes = [];
    for (const arr of g.values()) {
      if (arr.length < 2) continue;
      const t = TPL.get(slotKey(arr.map(m => m.name))); if (!t) continue;
      const cur = orderSlot(arr).map(m => m.name).join('\u0001');
      if (arr.every(m => m.ord != null) && cur === t.names.join('\u0001')) continue;
      const pool = arr.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)), out = [];
      for (const n of t.names) { const i = pool.findIndex(m => m.name === n); if (i >= 0) out.push(pool.splice(i, 1)[0]); }
      changes.push({ list: out.concat(pool), at: t.at });
    }
    return changes;
  }

  /**
   * 판정: 이번 주 월요일 이후의 안 만든 메뉴에 날짜 순서대로 냉장고 재료를 배정.
   * → Map(menuId → { state: 'done'|'ready'|'short', lines:[{name, need, unit, have, short, note}], short:[...] })
   */
  function evaluate(S, fromIso) {
    const total = stockMap(S);
    const remain = new Map(total);
    const res = new Map();
    for (const m of sortMenus(alive(S.menus))) {
      const consume = !m.done && m.date >= fromIso;
      const lines = [];
      for (const g of m.ings || []) {
        if (!g.name) continue;
        const [need, u] = toBase(Number(g.qty) || 0, g.unit);
        const k = M.canon(g.name) + '|' + u;
        const have = total.get(k) || 0;
        let avail = remain.has(k) ? remain.get(k) : 0;
        let short = 0, note = '';
        if (avail + 1e-9 >= need) { if (consume) remain.set(k, avail - need); }
        else {
          short = need - avail;
          if (consume) remain.set(k, 0);
          if (!have) { const other = unitsOf(total, g.name); if (other.length) note = '냉장고엔 ' + other.map(([uu, q]) => fmtAmt(q, uu)).join(', ') + ' (단위 다름)'; }
        }
        lines.push({ name: g.name, need, unit: u, have, short, note });
      }
      if (m.done) lines.forEach(l => { l.short = 0; l.note = ''; });
      const shortL = lines.filter(l => l.short > 1e-9);
      res.set(m.id, { state: m.done ? 'done' : (shortL.length ? 'short' : 'ready'), lines, short: shortL });
    }
    return res;
  }

  // 장보기: fromIso 이후 안 만든 메뉴의 부족분 합계
  function shopping(S, fromIso, ev) {
    const thisMon = fromIso, nextMon = addDays(fromIso, 7);
    const m = new Map();
    for (const mm of sortMenus(alive(S.menus))) {
      if (mm.done || mm.date < fromIso) continue;
      const r = ev.get(mm.id); if (!r) continue;
      for (const l of r.short) {
        const k = M.canon(l.name) + '|' + l.unit;
        const it = m.get(k) || { name: l.name, unit: l.unit, qty: 0, weeks: new Set(), menus: [] };
        it.qty += l.short;
        it.weeks.add(mm.date < nextMon ? '이번 주' : mm.date < addDays(nextMon, 7) ? '다음 주' : mm.date < addDays(nextMon, 14) ? '다다음 주' : md(mondayOf(mm.date)) + ' 주');
        it.menus.push(mm);
        m.set(k, it);
      }
    }
    return [...m.values()].sort((a, b) => a.menus[0].date.localeCompare(b.menus[0].date));
  }

  const api = { MEALS, UNITS, COMMON, iso, parse, addDays, mondayOf, todayIso, dow, md, pad, fmtQ, fmtAmt, toBase, uid, now, empty, alive, merge, catalog, aliasMap, stockMap, evaluate, shopping, sortMenus, buildTemplates, autoSortPlan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Data = api;
})(typeof window !== 'undefined' ? window : globalThis);
