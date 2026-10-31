(function () {
  const D = window.Data, M = window.Match, Y = window.Sync;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => { const n = parseFloat(String(v || '').replace(',', '.')); return isFinite(n) ? n : NaN; };
  const ICON = {
    cal: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    gear: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  };

  // ---------------- 상태 ----------------
  const LS_STATE = 'bf_state';
  let S = (() => { try { return JSON.parse(localStorage.getItem(LS_STATE)) || D.empty(); } catch (e) { return D.empty(); } })();
  const U = { weekStart: D.mondayOf(D.todayIso()), selDay: D.todayIso(), mtab: 'plan' };
  let EV = new Map();

  function saveLocal() { try { localStorage.setItem(LS_STATE, JSON.stringify(S)); } catch (e) {} }
  function commit() { saveLocal(); render(); schedulePush(); }

  // ---------------- 동기화 ----------------
  let pushTimer = null, syncState = 'idle', syncMsg = '', lastSync = 0;
  function setSync(st, msg) { syncState = st; syncMsg = msg || ''; paintSync(); }
  function schedulePush() {
    if (!Y.token()) { setSync('local'); return; }
    setSync('saving');
    clearTimeout(pushTimer);
    pushTimer = setTimeout(doPush, 900);
  }
  async function doPush(retry = true) {
    try { await Y.push(S); lastSync = Date.now(); setSync('saved'); }
    catch (e) {
      if (e.conflict && retry) {
        try { const r = await Y.pull(); if (r.data) { S = D.merge(S, r.data); saveLocal(); render(); } return doPush(false); }
        catch (e2) { setSync('error', e2.message); }
      } else if (e.message === 'NO_TOKEN') setSync('local');
      else setSync('error', e.message);
    }
  }
  async function doPull() {
    if (syncState === 'saving') return;
    try {
      const r = await Y.pull();
      if (r.data) {
        const before = JSON.stringify(S);
        S = D.merge(S, r.data);
        if (JSON.stringify(S) !== before) { saveLocal(); render(); }
        // 이 기기에만 있던 변경이 있으면 올린다
        if (Y.token() && canonJSON(S) !== canonJSON(D.merge(r.data, r.data))) schedulePush();
        else if (Y.token()) setSync('saved');
      } else if (Y.token() && (S.menus.length || S.fridge.length)) schedulePush();
      lastSync = Date.now();
      if (!Y.token()) setSync('local');
    } catch (e) { if (!Y.token()) setSync('local'); else setSync('error', e.message); }
  }
  function canonJSON(x) {
    const byId = a => (a || []).slice().sort((p, q) => String(p.id).localeCompare(String(q.id)));
    const al = Object.keys(x.aliases || {}).sort().map(k => [k, x.aliases[k]]);
    return JSON.stringify([byId(x.fridge), byId(x.menus), al]);
  }
  function paintSync() {
    const el = $('#sync'); if (!el) return;
    const map = {
      idle: ['', ''], saving: ['저장 중…', ''], saved: ['저장됨', 'ok'],
      local: ['<span class="lg">이 기기에만 저장 중 · </span>연결하기', 'warn'], error: ['<span class="lg">동기화 오류 · </span>확인', 'warn'],
    };
    const [t, c] = map[syncState] || map.idle;
    el.innerHTML = t; el.className = 'sync ' + c; el.title = syncMsg;
  }

  // ---------------- 계산 ----------------
  const thisMon = () => D.mondayOf(D.todayIso());
  const menusAt = (date, meal) => D.sortMenus(D.alive(S.menus).filter(m => m.date === date && m.meal === meal));
  const fridgeAlive = () => D.alive(S.fridge).filter(f => f.qty > 1e-9).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const findMenu = id => S.menus.find(m => m.id === id);

  function statusHtml(m) {
    const r = EV.get(m.id) || { state: 'ready', short: [] };
    if (r.state === 'done') return '<span class="s-done">✓ 완성</span>';
    if (r.state === 'ready') return '<span class="s-ready"><i></i>재료 준비 완료</span>';
    return '<span class="s-short">부족 · ' + r.short.map(l => esc(l.name) + ' ' + D.fmtAmt(l.short, l.unit)).join(' · ') + '</span>';
  }

  // ---------------- 화면 ----------------
  function render() {
    EV = D.evaluate(S, thisMon());
    renderPlan();
    renderSide();
    paintSync();
    document.body.dataset.mtab = U.mtab;
    const shopN = D.shopping(S, thisMon(), EV).length;
    $$('.shop-count').forEach(e => e.textContent = shopN ? shopN : '');
  }

  function weekTitle(mon) {
    const t = thisMon();
    if (mon === t) return '이번 주';
    if (mon === D.addDays(t, 7)) return '다음 주';
    if (mon === D.addDays(t, -7)) return '지난주';
    return D.md(mon) + ' 주';
  }

  function sectionHtml(mon, second) {
    const days = [...Array(7)].map((_, i) => D.addDays(mon, i));
    const today = D.todayIso();
    let cnt = 0, done = 0, ready = 0, short = 0, emptyN = 0;
    let cells = '<div class="dh corner"></div>' + days.map(d =>
      `<div class="dh${d === today ? ' today' : ''}">${D.dow(d)}${d === today ? ' 오늘' : ''}<b>${D.parse(d).getDate()}</b></div>`).join('');
    for (const meal of D.MEALS) {
      cells += `<div class="rh">${meal}</div>`;
      for (const d of days) {
        const ms = menusAt(d, meal);
        if (!ms.length) { emptyN++; cells += `<button class="c emp" data-add="${d}|${meal}" aria-label="${D.md(d)} ${meal} 추가">+</button>`; continue; }
        cells += '<div class="c">' + ms.map(m => {
          cnt++; const st = (EV.get(m.id) || {}).state;
          if (st === 'done') done++; else if (st === 'ready') ready++; else short++;
          return `<button class="mi${st === 'done' ? ' done' : ''}" data-open="${m.id}"><span class="n">${esc(m.name)}</span>${statusHtml(m)}</button>`;
        }).join('') + `<button class="add-sm" data-add="${d}|${meal}" aria-label="${D.md(d)} ${meal} 요리 하나 더 추가">+ 하나 더</button></div>`;
      }
    }
    const stats = cnt ? `${cnt}끼 · 완성 ${done} · 준비 완료 ${ready} · 부족 ${short}${emptyN ? ' · 빈 칸 ' + emptyN : ''}` : '아직 등록한 식단이 없어요';
    const copyBtn = second ? `<button class="btn sm" data-copyweek="${mon}">${esc(weekTitle(D.addDays(mon, -7)))} 식단 복사</button>` : '';
    return `<section class="wk">
      <div class="st"><h2>${weekTitle(mon)}</h2><span>${D.md(mon)} – ${D.md(D.addDays(mon, 6))}</span><span class="stats">${stats}</span>${copyBtn}</div>
      <div class="tb"><div class="gr">${cells}</div></div></section>`;
  }

  function mobileHtml() {
    const mon = D.mondayOf(U.selDay);
    const days = [...Array(7)].map((_, i) => D.addDays(mon, i));
    const today = D.todayIso();
    const chips = days.map(d => {
      const ms = D.alive(S.menus).filter(m => m.date === d);
      const hasShort = ms.some(m => (EV.get(m.id) || {}).state === 'short');
      return `<button class="day${d === U.selDay ? ' on' : ''}${d === today ? ' td' : ''}" data-day="${d}">${D.dow(d)}<b>${D.parse(d).getDate()}</b><span class="${hasShort ? 'dot' : 'dot0'}"></span></button>`;
    }).join('');
    const dd = D.parse(U.selDay);
    const all = D.alive(S.menus).filter(m => m.date === U.selDay);
    const doneN = all.filter(m => m.done).length;
    let body = '';
    for (const meal of D.MEALS) {
      const ms = menusAt(U.selDay, meal);
      body += `<div class="ml"><span>${meal}</span>${ms.length ? `<button class="tbtn" data-add="${U.selDay}|${meal}">+ 하나 더</button>` : ''}</div>`;
      body += ms.map(m => `<button class="card${m.done ? ' done' : ''}" data-open="${m.id}"><span class="n">${esc(m.name)}</span>${statusHtml(m)}</button>`).join('');
      if (!ms.length) body += `<button class="card add" data-add="${U.selDay}|${meal}">+ 추가</button>`;
    }
    return `<div class="mob">
      <div class="mweek"><button class="ib" data-mweek="-7" aria-label="이전 주">‹</button><span>${weekTitle(mon)} · ${D.md(mon)} – ${D.md(D.addDays(mon, 6))}</span><button class="ib" data-mweek="7" aria-label="다음 주">›</button></div>
      <div class="days">${chips}</div>
      <div class="mday"><div class="mdt"><b>${dd.getMonth() + 1}월 ${dd.getDate()}일 ${D.dow(U.selDay)}요일</b><span>${all.length ? '완성 ' + doneN + ' / ' + all.length : ''}</span></div>
      ${legendHtml()}${body}</div></div>`;
  }
  const legendHtml = () => '<div class="legend"><span class="s-short">부족</span><span class="s-ready"><i></i>재료 준비 완료</span><span class="s-done">✓ 완성</span></div>';

  function renderPlan() {
    $('#plan').innerHTML = `<div class="desk">${sectionHtml(U.weekStart, false)}${sectionHtml(D.addDays(U.weekStart, 7), true)}</div>${mobileHtml()}`;
  }

  function renderSide() {
    const fr = fridgeAlive();
    $('#fcount').textContent = fr.length || '';
    $('#fridgeList').innerHTML = fr.length ? fr.map(f => `
      <div class="fr" data-fid="${f.id}">
        <span class="fn">${esc(f.name)}</span>
        <span class="stp"><button data-step="-1" aria-label="${esc(f.name)} 줄이기">−</button><button class="qv" data-qedit aria-label="${esc(f.name)} 수량 직접 입력">${D.fmtQ(f.qty)}${esc(f.unit)}</button><button data-step="1" aria-label="${esc(f.name)} 늘리기">+</button></span>
      </div>`).join('') : '<div class="emptytxt">냉장고에 있는 재료를 위에서 추가해 주세요.</div>';
    const sh = D.shopping(S, thisMon(), EV);
    $('#shopList').innerHTML = sh.length ? sh.map((it, i) => `
      <div class="fr shop">
        <span class="fn">${esc(it.name)}<span class="wk">${[...it.weeks].join(' · ')}</span></span>
        <span class="sq"><b>${D.fmtAmt(it.qty, it.unit)}</b><button class="tbtn" data-buy="${i}" title="산 만큼 냉장고에 담기">담기</button></span>
      </div>`).join('') : '<div class="emptytxt">부족한 재료가 없어요.</div>';
    $('#shopList')._items = sh;
  }

  // ---------------- 토스트 ----------------
  function toast(msg, undo) {
    const t = $('#toast');
    t.innerHTML = esc(msg) + (undo ? ' <button>되돌리기</button>' : '');
    t.classList.add('on');
    if (undo) $('button', t).onclick = () => { undo(); t.classList.remove('on'); };
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), undo ? 5000 : 2200);
  }

  // ---------------- 모달 ----------------
  const stack = [];
  function openModal(html, cls = '') {
    const wrap = document.createElement('div');
    wrap.className = 'mwrap';
    wrap.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div>`;
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) closeModal(); });
    document.body.appendChild(wrap);
    stack.push(wrap);
    const f = $('[autofocus]', wrap); if (f) setTimeout(() => f.focus(), 30);
    return $('.modal', wrap);
  }
  function closeModal() { const w = stack.pop(); if (w) w.remove(); }
  function closeAll() { while (stack.length) closeModal(); }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && stack.length && !document.querySelector('.ac.open, .calpop.open')) closeModal();
  });

  // ---------------- 자동완성 ----------------
  function setAlias(variant, to) {
    const k = M.norm(variant);
    if (!k || k === M.norm(to)) return;
    S.aliases = S.aliases || {};
    S.aliases[k] = { to, t: Date.now() };
  }

  /**
   * attachAC(input, opts) — opts.kind 'ing'|'menu', opts.onPick(name, item)
   */
  function attachAC(input, opts) {
    const box = document.createElement('div');
    box.className = 'ac'; box.setAttribute('role', 'listbox');
    input.parentElement.appendChild(box);
    input.setAttribute('autocomplete', 'off');
    let items = [], act = 0;
    const source = () => opts.kind === 'menu' ? menuCatalog() : D.catalog(S);

    function build() {
      const q = input.value.trim();
      if (!q) { close(); return; }
      const r = M.suggest(q, source(), opts.kind === 'menu' ? {} : D.aliasMap(S));
      items = [];
      let h = '';
      if (r.exact) { items.push({ kind: 'exact', name: r.exact.name, item: r.exact }); }
      if (r.same.length) {
        h += `<div class="ach blue">${opts.kind === 'menu' ? '전에 등록한 메뉴 아닌가요?' : '같은 재료 아닌가요?'}</div>`;
        r.same.forEach(s => items.push({ kind: 'same', name: s.name, item: s, reason: s.reason, hdr: true }));
      }
      const more = r.more.filter(x => !items.some(i => i.name === x.name));
      more.forEach(x => items.push({ kind: 'more', name: x.name, item: x }));
      if (!r.exact) items.push({ kind: 'new', name: q });
      act = 0;
      let html = '', i = 0, moreHdr = false;
      for (const it of items) {
        if (it.kind === 'same' && i === items.findIndex(x => x.kind === 'same')) html += h;
        if (it.kind === 'more' && !moreHdr) { html += `<div class="ach">${opts.kind === 'menu' ? '전에 등록한 메뉴' : '추천'}</div>`; moreHdr = true; }
        const hint = it.kind === 'same' ? it.reason + (it.item.hint ? ' · ' + it.item.hint : '') : (it.item && it.item.hint) || (it.kind === 'exact' ? (opts.kind === 'menu' ? '전에 등록한 메뉴' : '') : '');
        const label = it.kind === 'new' ? `'${esc(it.name)}' ${opts.kind === 'menu' ? '새 메뉴로' : '새 재료로 추가'}` : esc(it.name);
        html += `<button type="button" class="aco ${it.kind}" data-i="${i}" role="option"><b>${label}</b>${hint ? `<small>${esc(hint)}</small>` : ''}</button>`;
        i++;
      }
      box.innerHTML = html;
      box.classList.add('open');
      paint();
    }
    function paint() { $$('.aco', box).forEach((b, j) => b.classList.toggle('act', j === act)); }
    function close() { box.classList.remove('open'); box.innerHTML = ''; }
    function pick(it) {
      const q = input.value.trim();
      if (it.kind === 'same' && opts.kind !== 'menu') setAlias(q, it.name);
      input.value = it.name;
      input.dataset.ok = '1';
      close();
      opts.onPick && opts.onPick(it.name, it.item || null, it.kind);
    }
    input.addEventListener('input', () => { input.dataset.ok = ''; build(); });
    input.addEventListener('focus', () => { if (input.value.trim() && input.dataset.ok !== '1') build(); });
    input.addEventListener('blur', () => setTimeout(close, 160));
    input.addEventListener('keydown', e => {
      if (!box.classList.contains('open')) { if (e.key === 'ArrowDown') { build(); e.preventDefault(); } return; }
      if (e.key === 'ArrowDown') { act = Math.min(items.length - 1, act + 1); paint(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { act = Math.max(0, act - 1); paint(); e.preventDefault(); }
      else if (e.key === 'Enter') { if (items[act]) { pick(items[act]); e.preventDefault(); e.stopPropagation(); } }
      else if (e.key === 'Escape') { close(); e.stopPropagation(); }
    });
    box.addEventListener('mousedown', e => {
      const b = e.target.closest('.aco'); if (!b) return;
      e.preventDefault(); pick(items[+b.dataset.i]);
    });
    // 저장 전에 확인: 비슷한 이름이 있는데 그냥 타이핑만 한 경우 → 목록을 열어 고르게
    input.needsConfirm = () => {
      const q = input.value.trim();
      if (!q || input.dataset.ok === '1') return false;
      const r = M.suggest(q, source(), opts.kind === 'menu' ? {} : D.aliasMap(S));
      if (r.exact || !r.same.length) return false;
      input.focus(); build();
      return true;
    };
    return { build, close };
  }

  function menuCatalog() {
    const m = new Map();
    for (const mm of D.sortMenus(D.alive(S.menus))) m.set(mm.name, { name: mm.name, ings: mm.ings });
    return [...m.values()];
  }

  // ---------------- 달력 ----------------
  function attachCal(btn, getVal, setVal) {
    const pop = document.createElement('div');
    pop.className = 'calpop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', '날짜 선택');
    btn.parentElement.appendChild(pop);
    let view;
    function draw() {
      const sel = getVal(), today = D.todayIso();
      const first = new Date(view.getFullYear(), view.getMonth(), 1);
      const start = D.mondayOf(D.iso(first));
      const has = new Set(D.alive(S.menus).map(m => m.date));
      let h = `<div class="calh"><button type="button" class="ib" data-mv="-1" aria-label="이전 달">‹</button><b>${view.getFullYear()}년 ${view.getMonth() + 1}월</b><button type="button" class="ib" data-mv="1" aria-label="다음 달">›</button></div><div class="calg">`;
      h += ['월', '화', '수', '목', '금', '토', '일'].map(x => `<span>${x}</span>`).join('');
      for (let i = 0; i < 42; i++) {
        const d = D.addDays(start, i), dt = D.parse(d);
        if (i >= 35 && dt.getMonth() !== view.getMonth()) break;
        const cls = [dt.getMonth() !== view.getMonth() ? 'o' : '', d === sel ? 'sel' : '', d === today ? 'td' : ''].join(' ');
        h += `<button type="button" class="${cls}" data-d="${d}">${dt.getDate()}<i class="${has.has(d) ? '' : 'h'}"></i></button>`;
      }
      h += '</div><div class="calf"><i></i>식단이 있는 날 · 월요일 시작</div>';
      pop.innerHTML = h;
    }
    btn.addEventListener('click', () => {
      if (pop.classList.contains('open')) { pop.classList.remove('open'); return; }
      view = D.parse(getVal()); view.setDate(1); draw(); pop.classList.add('open');
    });
    pop.addEventListener('click', e => {
      const mv = e.target.closest('[data-mv]');
      if (mv) { view.setMonth(view.getMonth() + (+mv.dataset.mv)); draw(); return; }
      const b = e.target.closest('[data-d]');
      if (b) { setVal(b.dataset.d); pop.classList.remove('open'); btn.focus(); }
    });
    pop.addEventListener('keydown', e => { if (e.key === 'Escape') { pop.classList.remove('open'); btn.focus(); e.stopPropagation(); } });
    document.addEventListener('mousedown', e => { if (!pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) pop.classList.remove('open'); });
  }
  const dateLabel = d => { const x = D.parse(d); return `${x.getFullYear()}. ${x.getMonth() + 1}. ${x.getDate()} (${D.dow(d)})`; };

  // ---------------- 식단 상세 ----------------
  function openDetail(id) {
    const m = findMenu(id); if (!m) return;
    const r = EV.get(id) || { state: 'ready', lines: [] };
    const lines = r.lines.map(l => `<div class="ln${l.short > 1e-9 ? ' short' : ''}"><span>${esc(l.name)}</span><span>${D.fmtAmt(l.need, l.unit)} / ${l.have ? D.fmtAmt(l.have, l.unit) : '없음'}${l.short > 1e-9 ? ' · ' + D.fmtAmt(l.short, l.unit) + ' 부족' : ''}${l.note ? `<small>${esc(l.note)}</small>` : ''}</span></div>`).join('');
    const md = openModal(`
      <div class="mh"><div><div class="sub">${D.md(m.date)} (${D.dow(m.date)}) ${esc(m.meal)}</div><h3>${esc(m.name)}</h3></div><button class="x" data-close aria-label="닫기">×</button></div>
      <div class="stline">${statusHtml(m)}</div>
      ${r.lines.length ? `<div class="lnh"><span>재료 ${r.lines.length}개</span><span>필요 / 냉장고</span></div>${lines}` : '<div class="emptytxt">등록된 재료가 없어요.</div>'}
      ${r.state === 'short' && r.lines.some(l => l.short > 1e-9 && l.have) ? '<div class="note">냉장고에 있어도 앞선 날짜 메뉴에 먼저 배정된 양은 부족으로 계산돼요.</div>' : ''}
      <div class="mf">
        ${m.done ? `<button class="btn" data-act="undo">완성 취소</button>` : `<button class="btn pri" data-act="done">완성으로 표시</button>`}
        <button class="btn" data-act="edit">수정</button>
        <button class="btn ghost" data-act="del">삭제</button>
      </div>`, 'detail');
    md.addEventListener('click', e => {
      const a = e.target.closest('[data-act],[data-close]'); if (!a) return;
      if (a.hasAttribute('data-close')) return closeModal();
      const act = a.dataset.act;
      if (act === 'done') { closeModal(); openComplete(id); }
      else if (act === 'undo') { closeModal(); openUndo(id); }
      else if (act === 'edit') { closeModal(); openEdit({ id }); }
      else if (act === 'del') {
        closeModal();
        const prev = { ...m };
        Object.assign(m, { deleted: true, updatedAt: D.now() });
        commit();
        toast(`'${m.name}' 삭제했어요`, () => { Object.assign(m, prev, { deleted: false, updatedAt: D.now() }); commit(); });
      }
    });
  }

  // 냉장고에서 재료 찾기(같은 재료 · 같은 단위 계열)
  function fridgeMatch(name, baseUnit) {
    const c = M.canon(name);
    return D.alive(S.fridge).filter(f => M.canon(f.name) === c && D.toBase(1, f.unit)[1] === baseUnit);
  }

  function openComplete(id) {
    const m = findMenu(id); if (!m) return;
    const rows = (m.ings || []).filter(g => g.name).map((g, i) => {
      const [need, bu] = D.toBase(num(g.qty) || 0, g.unit);
      const fs = fridgeMatch(g.name, bu).filter(f => f.qty > 0);
      const have = fs.reduce((s, f) => s + D.toBase(f.qty, f.unit)[0], 0);
      const after = Math.max(0, have - need);
      const can = have > 0;
      return `<label class="cr${can ? '' : ' off'}"><input type="checkbox" data-i="${i}" ${can ? 'checked' : 'disabled'}><span>${esc(g.name)} <small>${D.fmtQ(num(g.qty) || 0)}${esc(g.unit)}</small></span><span class="q">${can ? `${D.fmtAmt(have, bu)} → <b>${D.fmtAmt(after, bu)}</b>` : '냉장고에 없음'}</span></label>`;
    }).join('');
    const md = openModal(`
      <div class="mh"><div><div class="sub">${D.md(m.date)} (${D.dow(m.date)}) ${esc(m.meal)}</div><h3>${esc(m.name)} 완성할까요?</h3></div><button class="x" data-close aria-label="닫기">×</button></div>
      <p class="desc">이 음식을 만들 때 쓴 재료를 냉장고에서 차감할까요? 차감하지 않을 재료는 체크를 빼 주세요.</p>
      ${rows ? `<div class="lnh"><span>재료</span><span>냉장고 → 차감 후</span></div>${rows}` : ''}
      <div class="mf col">
        <button class="btn pri big" data-act="deduct"></button>
        <button class="btn" data-act="plain">차감 없이 완성만 표시</button>
        <button class="btn ghost" data-close>취소</button>
      </div>`, 'complete');
    const paintBtn = () => { const n = $$('input[type=checkbox]:checked', md).length; const b = $('[data-act=deduct]', md); b.textContent = n ? `${n}개 차감하고 완성` : '완성'; };
    paintBtn();
    md.addEventListener('change', paintBtn);
    md.addEventListener('click', e => {
      const a = e.target.closest('[data-act],[data-close]'); if (!a) return;
      if (a.hasAttribute('data-close')) return closeModal();
      const deducted = [];
      if (a.dataset.act === 'deduct') {
        for (const cb of $$('input[type=checkbox]:checked', md)) {
          const g = m.ings[+cb.dataset.i];
          let [need, bu] = D.toBase(num(g.qty) || 0, g.unit);
          for (const f of fridgeMatch(g.name, bu)) {
            if (need <= 1e-9) break;
            const [fq] = D.toBase(f.qty, f.unit), factor = fq / (f.qty || 1);
            const take = Math.min(fq, need);
            f.qty = Math.max(0, Math.round((f.qty - take / (factor || 1)) * 1000) / 1000);
            f.updatedAt = D.now();
            need -= take;
            deducted.push({ name: f.name, qty: take, unit: bu });
          }
        }
      }
      Object.assign(m, { done: true, doneAt: D.now(), deducted, updatedAt: D.now() });
      closeModal(); commit();
      toast(deducted.length ? `완성 · 재료 ${deducted.length}개 차감했어요` : '완성으로 표시했어요');
    });
  }

  function addToFridge(name, qty, unit) {
    const [bq, bu] = D.toBase(qty, unit);
    const f = fridgeMatch(name, bu)[0] || D.alive(S.fridge).find(x => M.norm(x.name) === M.norm(name) && x.unit === unit);
    if (f) {
      const per = D.toBase(1, f.unit)[0];
      f.qty = Math.round((f.qty + bq / per) * 1000) / 1000; f.updatedAt = D.now();
      return f;
    }
    const dead = S.fridge.find(x => M.norm(x.name) === M.norm(name) && x.unit === unit);
    if (dead) { Object.assign(dead, { qty, deleted: false, updatedAt: D.now() }); return dead; }
    const nf = { id: D.uid(), name, qty, unit, updatedAt: D.now() };
    S.fridge.push(nf); return nf;
  }

  function openUndo(id) {
    const m = findMenu(id); if (!m) return;
    const ded = m.deducted || [];
    const md = openModal(`
      <div class="mh"><h3>완성을 취소할까요?</h3><button class="x" data-close aria-label="닫기">×</button></div>
      ${ded.length ? `<p class="desc">완성할 때 차감했던 재료를 냉장고에 되돌릴까요?</p><div class="chips">${ded.map(d => `<span>${esc(d.name)} ${D.fmtAmt(d.qty, d.unit)}</span>`).join('')}</div>` : ''}
      <div class="mf col">
        ${ded.length ? '<button class="btn pri" data-act="restore">재료 되돌리고 취소</button>' : ''}
        <button class="btn${ded.length ? '' : ' pri'}" data-act="only">완성만 취소</button>
        <button class="btn ghost" data-close>닫기</button>
      </div>`, 'small');
    md.addEventListener('click', e => {
      const a = e.target.closest('[data-act],[data-close]'); if (!a) return;
      if (a.hasAttribute('data-close')) return closeModal();
      if (a.dataset.act === 'restore') for (const d of ded) addToFridge(d.name, d.qty, d.unit);
      Object.assign(m, { done: false, doneAt: null, deducted: null, updatedAt: D.now() });
      closeModal(); commit(); toast('완성을 취소했어요');
    });
  }

  // ---------------- 식단 추가 · 수정 ----------------
  function ingRowHtml(g = {}) {
    const unit = g.unit || '개';
    const units = D.UNITS.includes(unit) ? D.UNITS : [unit, ...D.UNITS];
    return `<div class="irw"><div class="ir">
      <div class="acw"><input class="iname" aria-label="재료 이름" placeholder="재료 이름" value="${esc(g.name || '')}" ${g.name ? 'data-ok="1"' : ''}></div>
      <input class="iqty" aria-label="수량" inputmode="decimal" placeholder="0" value="${g.qty != null && g.qty !== '' ? esc(D.fmtQ(num(g.qty))) : ''}">
      <select class="iunit" aria-label="단위">${units.map(u => `<option${u === unit ? ' selected' : ''}>${esc(u)}</option>`).join('')}</select>
      <button type="button" class="ib rm" aria-label="재료 줄 삭제">×</button></div><div class="has"></div></div>`;
  }

  function openEdit({ id, date, meal }) {
    const m = id ? findMenu(id) : null;
    const st = { date: m ? m.date : (date || D.todayIso()), meal: m ? m.meal : (meal || '아침') };
    const ings = m ? (m.ings || []) : [];
    const md = openModal(`
      <div class="mh"><h3>${m ? '식단 수정' : '식단 추가'}</h3><button class="x" data-close aria-label="닫기">×</button></div>
      <form class="ef" novalidate>
        <div class="row2">
          <div class="fld"><span class="lb">날짜</span><div class="calw"><button type="button" class="in datebtn"><span></span>${ICON.cal}</button></div></div>
          <div class="fld"><span class="lb">끼니</span><div class="seg">${D.MEALS.map(x => `<button type="button" data-meal="${x}">${x}</button>`).join('')}</div></div>
        </div>
        <label class="lb" for="mname">메뉴 이름</label>
        <div class="acw"><input id="mname" class="in" placeholder="예: 소고기 브로콜리 진밥" value="${esc(m ? m.name : '')}" ${m ? 'data-ok="1"' : 'autofocus'}></div>
        <div class="lbr"><span class="lb">필요한 재료</span><small>수량은 0.5, 0.3처럼 소수점 가능</small></div>
        <div class="ings">${(ings.length ? ings : [{}, {}]).map(ingRowHtml).join('')}</div>
        <button type="button" class="addrow">+ 재료 한 줄 더</button>
        <div class="mf"><button type="submit" class="btn pri">저장</button><button type="button" class="btn ghost" data-close>취소</button></div>
      </form>`, 'edit');

    const dateBtn = $('.datebtn', md);
    const paintDate = () => { $('span', dateBtn).textContent = dateLabel(st.date); };
    const paintMeal = () => $$('.seg button', md).forEach(b => b.classList.toggle('on', b.dataset.meal === st.meal));
    paintDate(); paintMeal();
    attachCal(dateBtn, () => st.date, d => { st.date = d; paintDate(); });
    $('.seg', md).addEventListener('click', e => { const b = e.target.closest('[data-meal]'); if (b) { st.meal = b.dataset.meal; paintMeal(); } });

    const ingBox = $('.ings', md);
    const hasLine = row => {
      const name = $('.iname', row).value.trim(), unit = $('.iunit', row).value, q = num($('.iqty', row).value);
      const h = $('.has', row);
      if (!name) { h.textContent = ''; h.className = 'has'; return; }
      const bu = D.toBase(1, unit)[1];
      const fs = fridgeMatch(name, bu).filter(f => f.qty > 0);
      const have = fs.reduce((s, f) => s + D.toBase(f.qty, f.unit)[0], 0);
      if (!have) {
        const other = D.alive(S.fridge).filter(f => f.qty > 0 && M.canon(f.name) === M.canon(name));
        h.textContent = other.length ? `냉장고엔 ${other.map(f => D.fmtQ(f.qty) + f.unit).join(', ')} (단위를 맞춰 주세요)` : '냉장고에 없음';
        h.className = 'has short';
      } else {
        const need = isFinite(q) ? D.toBase(q, unit)[0] : 0;
        h.textContent = '냉장고 ' + D.fmtAmt(have, bu) + (need > have ? ` · ${D.fmtAmt(need - have, bu)} 부족` : '');
        h.className = 'has' + (need > have ? ' short' : '');
      }
    };
    const wireRow = row => {
      const inp = $('.iname', row);
      attachAC(inp, {
        kind: 'ing', onPick: (name, item) => {
          if (item && item.unit) {
            const sel = $('.iunit', row);
            const f = D.alive(S.fridge).find(x => x.name === name);
            const u = f ? f.unit : item.unit;
            if (![...sel.options].some(o => o.value === u)) sel.insertAdjacentHTML('afterbegin', `<option>${esc(u)}</option>`);
            sel.value = u;
          }
          hasLine(row); $('.iqty', row).focus();
        }
      });
      ['input', 'change'].forEach(ev => row.addEventListener(ev, () => hasLine(row)));
      $('.rm', row).addEventListener('click', () => { row.remove(); if (!$('.irw', ingBox)) addRow(); });
      hasLine(row);
    };
    const addRow = (g) => { ingBox.insertAdjacentHTML('beforeend', ingRowHtml(g)); const row = ingBox.lastElementChild; wireRow(row); return row; };
    $$('.irw', ingBox).forEach(wireRow);
    $('.addrow', md).addEventListener('click', () => $('.iname', addRow()).focus());

    // 메뉴 이름 자동완성 → 예전 재료 불러오기
    const nameInp = $('#mname', md);
    attachAC(nameInp, {
      kind: 'menu', onPick: (name, item) => {
        if (!item || !item.ings || !item.ings.length) return;
        const filled = $$('.iname', ingBox).some(i => i.value.trim());
        if (filled && !confirm('전에 쓴 재료로 바꿀까요?')) return;
        ingBox.innerHTML = '';
        item.ings.forEach(g => addRow(g));
      }
    });

    md.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeModal(); });
    $('form', md).addEventListener('submit', e => {
      e.preventDefault();
      const name = nameInp.value.trim();
      if (!name) { nameInp.focus(); toast('메뉴 이름을 적어 주세요'); return; }
      if (nameInp.needsConfirm()) { toast('비슷한 메뉴가 있어요. 확인해 주세요'); return; }
      const rows = $$('.irw', ingBox);
      const out = [];
      for (const row of rows) {
        const inp = $('.iname', row), n = inp.value.trim();
        if (!n) continue;
        if (inp.needsConfirm()) { toast('비슷한 재료가 있어요. 같은 재료인지 골라 주세요'); return; }
        const q = num($('.iqty', row).value);
        if (!(q > 0)) { $('.iqty', row).focus(); toast(`'${n}' 수량을 적어 주세요`); return; }
        out.push({ name: n, qty: q, unit: $('.iunit', row).value });
      }
      if (m) Object.assign(m, { name, date: st.date, meal: st.meal, ings: out, updatedAt: D.now() });
      else S.menus.push({ id: D.uid(), name, date: st.date, meal: st.meal, ings: out, done: false, createdAt: D.now(), updatedAt: D.now() });
      closeModal(); commit();
      toast(m ? '수정했어요' : `${D.md(st.date)} ${st.meal}에 추가했어요`);
    });
  }

  // ---------------- 냉장고 ----------------
  function wireFridge() {
    const nameI = $('#fname'), qtyI = $('#fqty'), unitS = $('#funit');
    unitS.innerHTML = D.UNITS.map(u => `<option>${u}</option>`).join('');
    attachAC(nameI, {
      kind: 'ing', onPick: (name, item) => {
        const f = D.alive(S.fridge).find(x => x.name === name);
        const u = f ? f.unit : item && item.unit;
        if (u) { if (![...unitS.options].some(o => o.value === u)) unitS.insertAdjacentHTML('afterbegin', `<option>${esc(u)}</option>`); unitS.value = u; }
        qtyI.focus();
      }
    });
    $('#fadd').addEventListener('submit', e => {
      e.preventDefault();
      const n = nameI.value.trim();
      if (!n) { nameI.focus(); return; }
      if (nameI.needsConfirm()) { toast('비슷한 재료가 있어요. 같은 재료인지 골라 주세요'); return; }
      const q = num(qtyI.value);
      if (!(q > 0)) { qtyI.focus(); toast('수량을 적어 주세요'); return; }
      addToFridge(n, q, unitS.value);
      nameI.value = ''; qtyI.value = ''; nameI.dataset.ok = '';
      commit(); nameI.focus();
      toast(`${n} ${D.fmtQ(q)}${unitS.value} 담았어요`);
    });
    const stepOf = u => ({ g: 10, ml: 10, kg: 0.1, L: 0.1 }[u] || 0.5);
    $('#fridgeList').addEventListener('click', e => {
      const row = e.target.closest('[data-fid]'); if (!row) return;
      const f = S.fridge.find(x => x.id === row.dataset.fid); if (!f) return;
      const st = e.target.closest('[data-step]');
      if (st) {
        const prev = f.qty;
        f.qty = Math.max(0, Math.round((f.qty + (+st.dataset.step) * stepOf(f.unit)) * 1000) / 1000);
        f.updatedAt = D.now(); commit();
        if (f.qty <= 0) toast(`${f.name} 다 썼어요`, () => { f.qty = prev; f.updatedAt = D.now(); commit(); });
        return;
      }
      if (e.target.closest('[data-qedit]')) {
        const qv = e.target.closest('[data-qedit]');
        qv.outerHTML = `<input class="qin" inputmode="decimal" value="${D.fmtQ(f.qty)}" aria-label="${esc(f.name)} 수량">`;
        const inp = $('.qin', row); inp.focus(); inp.select();
        const done = () => { const q = num(inp.value); if (isFinite(q) && q >= 0 && q !== f.qty) { f.qty = q; f.updatedAt = D.now(); commit(); } else render(); };
        inp.addEventListener('blur', done, { once: true });
        inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') inp.blur(); if (ev.key === 'Escape') { inp.value = f.qty; inp.blur(); } });
      }
    });
    $('#shopList').addEventListener('click', e => {
      const b = e.target.closest('[data-buy]'); if (!b) return;
      const it = $('#shopList')._items[+b.dataset.buy]; if (!it) return;
      openBuy(it);
    });
    $('#shopCopy').addEventListener('click', async () => {
      const sh = D.shopping(S, thisMon(), EV);
      if (!sh.length) return toast('부족한 재료가 없어요');
      const txt = sh.map(it => `${it.name} ${D.fmtAmt(it.qty, it.unit)}`).join('\n');
      try { await navigator.clipboard.writeText(txt); toast('장보기 목록을 복사했어요'); }
      catch (err) { prompt('복사해서 쓰세요', txt.replace(/\n/g, ', ')); }
    });
  }

  function openBuy(it) {
    const md = openModal(`
      <div class="mh"><h3>${esc(it.name)} 냉장고에 담기</h3><button class="x" data-close aria-label="닫기">×</button></div>
      <p class="desc">산 양을 적어 주세요. 부족한 양은 ${D.fmtAmt(it.qty, it.unit)}이에요.</p>
      <form class="buyf"><input class="in" inputmode="decimal" value="${D.fmtQ(it.qty)}" aria-label="수량" autofocus><select class="in" aria-label="단위">${D.UNITS.map(u => `<option${u === it.unit ? ' selected' : ''}>${u}</option>`).join('')}</select>
      <button class="btn pri">담기</button></form>`, 'small');
    md.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeModal(); });
    $('form', md).addEventListener('submit', e => {
      e.preventDefault();
      const q = num($('input', md).value); if (!(q > 0)) return;
      addToFridge(it.name, q, $('select', md).value);
      closeModal(); commit(); toast(`${it.name} 담았어요`);
    });
  }

  // ---------------- 주 복사 ----------------
  function copyWeek(toMon) {
    const fromMon = D.addDays(toMon, -7);
    const src = D.alive(S.menus).filter(m => m.date >= fromMon && m.date < toMon);
    const adds = src.filter(m => !menusAt(D.addDays(m.date, 7), m.meal).length);
    if (!adds.length) return toast(src.length ? '빈 칸이 없어서 복사할 게 없어요' : '복사할 식단이 없어요');
    const md = openModal(`
      <div class="mh"><h3>${esc(weekTitle(fromMon))} 식단 복사</h3><button class="x" data-close aria-label="닫기">×</button></div>
      <p class="desc">${esc(weekTitle(toMon))} 빈 칸에 ${adds.length}끼를 같은 요일·끼니로 넣을게요. 이미 채운 칸은 그대로 둬요.</p>
      <div class="mf"><button class="btn pri" data-act="go">${adds.length}끼 복사</button><button class="btn ghost" data-close>취소</button></div>`, 'small');
    md.addEventListener('click', e => {
      if (e.target.closest('[data-close]')) return closeModal();
      if (!e.target.closest('[data-act=go]')) return;
      const t = D.now();
      const created = adds.map(m => ({ id: D.uid(), name: m.name, date: D.addDays(m.date, 7), meal: m.meal, ings: (m.ings || []).map(g => ({ ...g })), done: false, createdAt: t, updatedAt: t }));
      S.menus.push(...created);
      closeModal(); commit();
      toast(`${created.length}끼 복사했어요`, () => { created.forEach(c => Object.assign(c, { deleted: true, updatedAt: D.now() })); commit(); });
    });
  }

  // ---------------- 설정 (저장소 연결) ----------------
  function openSettings() {
    const has = !!Y.token();
    const md = openModal(`
      <div class="mh"><h3>함께 쓰기 연결</h3><button class="x" data-close aria-label="닫기">×</button></div>
      <p class="desc">두 사람이 같은 식단을 보려면 기기마다 한 번 깃허브 토큰을 넣어 주세요. 식단은 저장소의 <code>data/plan.json</code>에 저장돼요.</p>
      <div class="cstate ${has ? 'ok' : ''}">${has ? '이 기기는 연결돼 있어요.' : '아직 이 기기에만 저장되고 있어요.'}</div>
      <form class="tokf"><input class="in" type="password" placeholder="github_pat_… 토큰 붙여넣기" aria-label="깃허브 토큰" ${has ? '' : 'autofocus'}><button class="btn pri">연결</button></form>
      <div class="mf wrap">
        ${has ? '<button class="btn" data-act="link">다른 기기 연결 링크 복사</button>' : ''}
        <button class="btn" data-act="backup">백업 내려받기</button>
        ${has ? '<button class="btn ghost" data-act="off">이 기기 연결 끊기</button>' : ''}
      </div>
      <details class="how"><summary>토큰 만드는 법</summary>
        <ol><li>github.com → 프로필 → Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token</li>
        <li>Repository access: <b>Only select repositories</b> → <b>${esc(Y.CFG.repo)}</b></li>
        <li>Permissions → Repository permissions → <b>Contents: Read and write</b></li>
        <li>만들어진 토큰을 복사해 위 칸에 붙여넣기</li></ol></details>`, 'settings');
    md.addEventListener('click', async e => {
      if (e.target.closest('[data-close]')) return closeModal();
      const a = e.target.closest('[data-act]'); if (!a) return;
      if (a.dataset.act === 'off') { Y.setToken(null); closeModal(); setSync('local'); toast('이 기기 연결을 끊었어요'); }
      if (a.dataset.act === 'link') {
        const url = location.origin + location.pathname + '#key=' + encodeURIComponent(Y.token());
        try { await navigator.clipboard.writeText(url); toast('링크를 복사했어요. 다른 기기에서 한 번 열면 연결돼요'); }
        catch (err) { prompt('이 링크를 다른 기기에서 열어 주세요', url); }
      }
      if (a.dataset.act === 'backup') {
        const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
        const u = URL.createObjectURL(blob), l = document.createElement('a');
        l.href = u; l.download = `이유식식단_${D.todayIso()}.json`; l.click(); setTimeout(() => URL.revokeObjectURL(u), 1000);
      }
    });
    $('.tokf', md).addEventListener('submit', async e => {
      e.preventDefault();
      const v = $('input', e.target).value.trim(); if (!v) return;
      Y.setToken(v);
      const cs = $('.cstate', md); cs.textContent = '확인 중…'; cs.className = 'cstate';
      try {
        const r = await fetch(`https://api.github.com/repos/${Y.CFG.owner}/${Y.CFG.repo}`, { headers: { Authorization: 'Bearer ' + v, Accept: 'application/vnd.github+json' } });
        const j = await r.json();
        if (!r.ok || !(j.permissions && j.permissions.push)) throw new Error(r.ok ? '쓰기 권한이 없는 토큰이에요' : '토큰이 맞지 않아요');
        cs.textContent = '연결됐어요. 식단을 맞추는 중…'; cs.className = 'cstate ok';
        await doPull(); schedulePush();
        setTimeout(closeModal, 700);
      } catch (err) { Y.setToken(null); cs.textContent = err.message; cs.className = 'cstate err'; }
    });
  }

  // ---------------- 이벤트 ----------------
  function wire() {
    $('#plan').addEventListener('click', e => {
      const o = e.target.closest('[data-open]'); if (o) return openDetail(o.dataset.open);
      const a = e.target.closest('[data-add]'); if (a) { const [date, meal] = a.dataset.add.split('|'); return openEdit({ date, meal }); }
      const c = e.target.closest('[data-copyweek]'); if (c) return copyWeek(c.dataset.copyweek);
      const d = e.target.closest('[data-day]'); if (d) { U.selDay = d.dataset.day; return renderPlan(); }
      const w = e.target.closest('[data-mweek]'); if (w) { U.selDay = D.addDays(U.selDay, +w.dataset.mweek); return renderPlan(); }
    });
    $('#prevW').onclick = () => { U.weekStart = D.addDays(U.weekStart, -7); renderPlan(); };
    $('#nextW').onclick = () => { U.weekStart = D.addDays(U.weekStart, 7); renderPlan(); };
    $('#todayW').onclick = () => { U.weekStart = thisMon(); U.selDay = D.todayIso(); renderPlan(); };
    $('#addBtn').onclick = () => openEdit({ date: U.mtab === 'plan' && window.innerWidth <= 760 ? U.selDay : D.todayIso() });
    $('#setBtn').onclick = openSettings;
    $('#sync').onclick = () => { if (syncState === 'local' || syncState === 'error') openSettings(); };
    $$('.mtabs [data-mtab]').forEach(b => b.onclick = () => { U.mtab = b.dataset.mtab; $$('.mtabs [data-mtab]').forEach(x => x.classList.toggle('on', x === b)); render(); });
    wireFridge();
    window.addEventListener('focus', () => { if (Date.now() - lastSync > 10000) doPull(); });
    setInterval(() => { if (document.visibilityState === 'visible' && Y.token() && !stack.length) doPull(); }, 30000);
  }

  // 다른 기기 연결 링크(#key=…) 처리
  (function takeKey() {
    const m = location.hash.match(/key=([^&]+)/);
    if (m) { Y.setToken(decodeURIComponent(m[1])); history.replaceState(null, '', location.pathname + location.search); }
  })();

  wire();
  render();
  doPull();
})();
