// 재료 이름 매칭 — 자동완성 + 분기 방지 (띄어쓰기 · 오타 · 단어 순서 · 같은 뜻 · 별칭 학습)
(function (root) {
  // 같은 뜻 다른 말 (왼쪽 → 오른쪽으로 통일해서 비교)
  const SYN = [
    ['쇠고기', '소고기'], ['소 고기', '소고기'], ['우둔살', '우둔'],
    ['계란', '달걀'], ['달걀노른자', '노른자'], ['계란노른자', '노른자'],
    ['다짐육', '다진'], ['다진것', '다진'], ['다진 것', '다진'], [' 간 ', ' 다진 '],
    ['닭 가슴살', '닭가슴살'], ['닭가슴', '닭가슴살'], ['닭 안심', '닭안심'],
    ['흰 살', '흰살'], ['흰살 생선', '흰살생선'],
    ['파프리카(빨강)', '빨간 파프리카'],
    ['애기 배추', '알배추'],
  ];

  const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, '');

  function canon(s) {
    let t = ' ' + String(s || '').trim().toLowerCase().replace(/\s+/g, ' ') + ' ';
    for (const [a, b] of SYN) {
      if (a === b) continue;
      t = t.split(a).join(b);
    }
    // '소고기다진' 처럼 동의어 치환 후 순서만 다른 것도 잡히도록 공백 제거
    return t.replace(/\s+/g, '');
  }

  const charKey = s => canon(s).split('').sort().join('');

  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }

  // 같은 재료로 볼 만한지 — 이유 문자열 또는 null
  function sameReason(query, name) {
    const q = String(query || '').trim();
    if (!q || q === name) return null;
    if (norm(q) === norm(name)) return '띄어쓰기만 달라요';
    const cq = canon(q), cn = canon(name);
    if (cq === cn) return '같은 뜻의 다른 표기예요';
    if (cq.length >= 2 && charKey(q) === charKey(name)) return '단어 순서만 달라요';
    const d = lev(cq, cn);
    if (cq.length >= 3 && cn.length >= 3 && d <= (Math.min(cq.length, cn.length) >= 6 ? 2 : 1)) return '표기가 비슷해요';
    return null;
  }

  /**
   * suggest(query, catalog, aliases)
   *  catalog: [{name, unit, hint}]  aliases: { [norm(variant)]: canonicalName }
   *  → { exact, same:[{name,reason,unit,hint}], more:[{name,unit,hint}] }
   */
  function suggest(query, catalog, aliases) {
    const q = String(query || '').trim();
    const out = { exact: null, same: [], more: [] };
    if (!q) return out;
    const byName = new Map(catalog.map(c => [c.name, c]));
    const aliasTo = aliases && aliases[norm(q)];
    if (aliasTo && aliasTo !== q) {
      const c = byName.get(aliasTo) || { name: aliasTo };
      out.same.push({ ...c, reason: '전에 이 이름으로 골랐어요' });
    }
    const cq = canon(q);
    for (const c of catalog) {
      if (c.name === q) { out.exact = c; continue; }
      if (out.same.some(s => s.name === c.name)) continue;
      const r = sameReason(q, c.name);
      if (r) { out.same.push({ ...c, reason: r }); continue; }
      const cn = canon(c.name);
      if (cn.includes(cq) || norm(c.name).includes(norm(q))) out.more.push(c);
    }
    const rank = r => ['전에 이 이름으로 골랐어요', '띄어쓰기만 달라요', '같은 뜻의 다른 표기예요', '단어 순서만 달라요', '표기가 비슷해요'].indexOf(r);
    out.same.sort((a, b) => rank(a.reason) - rank(b.reason));
    // 이미 정확히 있는 이름이면 경고하지 않고, 더 확실한 후보가 있으면 '비슷해요'는 추천 쪽으로 내린다
    const strong = out.same.some(s => s.reason !== '표기가 비슷해요');
    if (out.exact || strong) {
      const weak = out.same.filter(s => out.exact || s.reason === '표기가 비슷해요');
      out.same = out.same.filter(s => !weak.includes(s));
      out.more = weak.map(({ reason, ...c }) => c).concat(out.more);
    }
    out.same = out.same.slice(0, 3);
    out.more.sort((a, b) => {
      const pa = canon(a.name).startsWith(cq) ? 0 : 1, pb = canon(b.name).startsWith(cq) ? 0 : 1;
      return pa - pb || a.name.length - b.name.length;
    });
    out.more = out.more.slice(0, 6);
    return out;
  }

  const api = { norm, canon, charKey, lev, sameReason, suggest };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Match = api;
})(typeof window !== 'undefined' ? window : globalThis);
