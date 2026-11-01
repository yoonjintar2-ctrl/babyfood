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
  const U = { hideShort: (() => { try { const v = localStorage.getItem('bf_hideShort'); return v == null ? true : v === '1'; } catch (e) { return true; } })(), weekStart: D.mondayOf(D.todayIso()), selDay: D.todayIso(), mtab: 'plan' };
  let EV = new Map();

  function saveLocal() { try { localStorage.setItem(LS_STATE, JSON.stringify(S)); } catch (e) {} }
  function commit() { saveLocal(); render(); schedulePush(); }

  // ---------------- 동기화 ----------------
  let pushTimer = null, syncState = 'idle', syncMsg = '', lastSync = 0;
  function setSync(st, msg) { syncState = st; syncMsg = msg || ''; paintSync(); }
  let ME = null; // 로그인한 사용자
  function schedulePush() {
    if (!ME) { setSync('local'); return; }
    setSync('saving');
    clearTimeout(pushTimer);
    pushTimer = setTimeout(doPush, 700);
  }
  async function doPush(retry = 2) {
    try { await Y.push(S); lastSync = Date.now(); setSync('saved'); }
    catch (e) {
      if (e.conflict && retry > 0) {
        try { const r = await Y.pull(); if (r.data) { S = D.merge(S, r.data); saveLocal(); render(); } return doPush(retry - 1); }
        catch (e2) { setSync('error', e2.message); }
      } else setSync('error', e.message);
    }
  }
  async function doPull() {
    if (!ME || syncState === 'saving') return;
    try {
      const r = await Y.pull();
      if (r.data) {
        const before = JSON.stringify(S);
        S = D.merge(S, r.data);
        if (JSON.stringify(S) !== before) { saveLocal(); render(); }
        // 이 기기에만 있던 변경이 있으면 올린다
        if (canonJSON(S) !== canonJSON(D.merge(r.data, r.data))) schedulePush();
        else setSync('saved');
      } else if (S.menus.length || S.fridge.length) schedulePush();
      else setSync('saved');
      lastSync = Date.now();
    } catch (e) { setSync('error', e.message); }
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
      local: ['로그인 필요', 'warn'], error: ['<span class="lg">저장 오류 · </span>다시 시도', 'warn'],
    };
    const [t, c] = map[syncState] || map.idle;
    el.innerHTML = t; el.className = 'sync ' + c; el.title = syncMsg;
  }

  // ---------------- 계산 ----------------
  const thisMon = () => D.mondayOf(D.todayIso());
  const menusAt = (date, meal) => D.sortMenus(D.alive(S.menus).filter(m => m.date === date && m.meal === meal));
  const fridgeAlive = () => D.alive(S.fridge).filter(f => f.qty > 1e-9).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const findMenu = id => S.menus.find(m => m.id === id);

  // 상태 배지: 재료 필요(파랑) · 요리 필요(검정) · 완성(회색)
  const PILL = { short: '재료 필요', ready: '요리 필요', done: '완성' };
  const pill = st => `<span class="pill p-${st}">${PILL[st]}</span>`;
  // ---------------- 레시피 사진 ----------------
  const CAM = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/></svg>';
  const rKey = name => M.norm(name);
  const recipeOf = name => { const r = (S.recipes || {})[rKey(name)]; return r && r.photos && r.photos.length ? r : null; };
  const notesOf = name => { const r = (S.recipes || {})[rKey(name)]; return r ? D.alive(r.notes || []).sort((a, b) => (a.at || 0) - (b.at || 0)) : []; };
  const NOTE = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/></svg>';
  function rcpIcon(m) {
    const r = recipeOf(m.name), nn = notesOf(m.name).length;
    if (!r && !nn) return '';
    const tip = [r ? `레시피 사진 ${r.photos.length}장` : '', nn ? `피드백 ${nn}개` : ''].filter(Boolean).join(' · ');
    return `<span class="rcp" data-recipe="${esc(m.name)}" role="button" tabindex="0" title="${tip} 보기">${r ? CAM : NOTE}${r && r.photos.length > 1 ? `<small>${r.photos.length}</small>` : ''}${nn ? `<i class="ndot"></i>` : ''}</span>`;
  }
  // 요리 피드백 (같은 이름 요리 모든 회차에 표시)
  function notesHtml(name) {
    const ns = notesOf(name);
    return `<div class="nsec"><div class="lnh"><span>만들 때 참고${ns.length ? ` ${ns.length}` : ''}</span><span>다음 회차부터 계속 보여요</span></div>
      ${ns.map(n => `<div class="note-it" data-nid="${n.id}"><span class="nt-tx">${esc(n.text)}</span><span class="nt-meta">${n.by ? esc(n.by) + ' · ' : ''}${D.md(D.iso(new Date(n.at)))}<button type="button" class="tbtn" data-nedit>수정</button><button type="button" class="tbtn" data-ndel>삭제</button></span></div>`).join('')}
      <form class="nadd"><input class="in" placeholder="예: 레시피대로 했는데 당근이 딱딱해서 30초 더 데웠음" aria-label="피드백"><button class="btn sm">추가</button></form></div>`;
  }
  function addNote(name, text) {
    S.recipes = S.recipes || {};
    const k = rKey(name), cur = S.recipes[k] || { name, photos: [] };
    const n = { id: D.uid(), text, at: D.now(), updatedAt: D.now(), by: ME ? Y.userId(ME) : '' };
    S.recipes[k] = { ...cur, name: cur.name || name, notes: [...(cur.notes || []), n], updatedAt: D.now() };
    commit();
  }
  function wireNotes(host, name, repaint) {
    host.addEventListener('submit', e => {
      if (!e.target.matches('.nadd')) return;
      e.preventDefault();
      const inp = $('input', e.target), t = inp.value.trim(); if (!t) return inp.focus();
      addNote(name, t); repaint(); toast('피드백을 남겼어요 · 이 요리 모든 날짜에 보여요');
      setTimeout(() => { const i2 = $('.nadd input', host); if (i2) i2.focus(); }, 0);
    });
    host.addEventListener('click', e => {
      const it = e.target.closest('[data-nid]'); if (!it) return;
      const r = S.recipes[rKey(name)], n = (r.notes || []).find(x => x.id === it.dataset.nid); if (!n) return;
      if (e.target.closest('[data-ndel]')) {
        Object.assign(n, { deleted: true, updatedAt: D.now() }); r.updatedAt = D.now(); commit(); repaint();
        toast('피드백을 지웠어요', () => { Object.assign(n, { deleted: false, updatedAt: D.now() }); r.updatedAt = D.now(); commit(); repaint(); });
      }
      if (e.target.closest('[data-nedit]')) {
        const tx = $('.nt-tx', it);
        tx.outerHTML = `<input class="in nt-in" value="${esc(n.text)}" aria-label="피드백 수정">`;
        const inp = $('.nt-in', it); inp.focus(); inp.select();
        const done = () => { const v = inp.value.trim(); if (v && v !== n.text) { Object.assign(n, { text: v, updatedAt: D.now() }); r.updatedAt = D.now(); commit(); } repaint(); };
        inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); } if (ev.key === 'Escape') { inp.value = n.text; inp.blur(); } });
        inp.addEventListener('blur', done, { once: true });
      }
    });
  }
  // 사진 열기: createImageBitmap 이 안 되는 브라우저(구형 사파리 등)는 <img> 로
  async function decodeImage(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) {}
      try { return await createImageBitmap(file); } catch (e) {}
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image(); img.decoding = 'async'; img.src = url;
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('이 사진 형식은 열 수 없어요 (HEIC면 JPG로 바꿔 올려 주세요)')); });
      return img;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  async function shrink(file) {
    const bmp = await decodeImage(file);
    const W = bmp.width || bmp.naturalWidth, H = bmp.height || bmp.naturalHeight;
    const MAX = 1600, k = Math.min(1, MAX / Math.max(W, H));
    const w = Math.round(W * k), h = Math.round(H * k);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.82));
    if (!blob) throw new Error('사진을 줄이지 못했어요. 다른 사진으로 해 주세요');
    return { blob, w, h };
  }
  // 같은 사진 찾기: 원본 파일 내용(SHA-256) · 파일명+크기
  async function fileHash(file) {
    try { const buf = await file.arrayBuffer(); const d = await crypto.subtle.digest('SHA-256', buf); return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join(''); }
    catch (e) { return ''; }
  }
  function allPhotos() {
    const out = [];
    for (const [k, r] of Object.entries(S.recipes || {})) for (const p of (r.photos || [])) out.push({ k, r, p });
    return out;
  }
  function findSamePhoto(hash, fname, fsize) {
    return allPhotos().find(({ p }) => (hash && p.hash === hash) || (fname && p.fname === fname && p.fsize === fsize));
  }
  const recipesUsing = path => allPhotos().filter(x => x.p.path === path).map(x => x.r.name);
  let UPL = null; // 올리는 중 상태 { name, done, total }
  function pickPhotos(name, done) {
    if (UPL) return toast('사진을 올리는 중이에요. 끝나면 다시 해 주세요');
    if (!ME) return toast('로그인해야 사진을 올릴 수 있어요');
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
    inp.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(inp); // iOS 사파리는 문서에 붙어 있어야 change 가 확실히 온다
    const cleanup = () => setTimeout(() => inp.remove(), 0);
    inp.addEventListener('cancel', cleanup);
    inp.onchange = async () => {
      const files = [...inp.files]; cleanup();
      if (!files.length) return;
      const k = rKey(name);
      S.recipes = S.recipes || {};
      UPL = { name, done: 0, total: files.length }; done && done();
      let added = 0, reused = 0, dup = 0, failed = 0;
      for (const f of files) {
        try {
          const hash = await fileHash(f);
          const cur = S.recipes[k] || { name, photos: [] };
          if ((cur.photos || []).some(p => (hash && p.hash === hash) || (p.fname === f.name && p.fsize === f.size))) { dup++; continue; }
          const same = findSamePhoto(hash, f.name, f.size);
          let ph;
          if (same) { ph = { ...same.p, at: D.now() }; reused++; }
          else {
            const { blob, w, h } = await shrink(f);
            const path = await Y.uploadPhoto(blob);
            ph = { path, w, h, at: D.now(), hash, fname: f.name, fsize: f.size };
            added++;
          }
          const c2 = S.recipes[k] || { name, photos: [] };
          S.recipes[k] = { name: c2.name || name, photos: [...(c2.photos || []), ph], updatedAt: D.now() };
          commit();
        } catch (e) { failed++; toast(e.message); }
        finally { UPL.done++; done && done(); }
      }
      UPL = null; done && done();
      const n = D.alive(S.menus).filter(x => rKey(x.name) === k).length;
      const parts = [];
      if (added) parts.push(`새 사진 ${added}장`);
      if (reused) parts.push(`이미 올린 사진 ${reused}장 연결`);
      if (dup) parts.push(`이미 있는 사진 ${dup}장 건너뜀`);
      if (failed) parts.push(`${failed}장 실패`);
      if (parts.length) setTimeout(() => toast(parts.join(' · ') + (added || reused ? ` · 같은 요리 ${n}곳에 보여요` : '')), failed ? 2500 : 0);
    };
    inp.click();
  }
  function recipeStrip(name) {
    const r = recipeOf(name);
    const thumbs = r ? r.photos.map((p, i) => `<button type="button" class="rth" data-rview="${i}" aria-label="레시피 사진 ${i + 1} 크게 보기"><img src="${esc(Y.photoUrl(p.path))}" alt="" loading="lazy"></button>`).join('') : '';
    return `<div class="rsec"><div class="lnh"><span>레시피 사진${r ? ` ${r.photos.length}장` : ''}</span><span>같은 이름 요리 모두에 함께 보여요</span></div>
      <div class="rstrip">${thumbs}${UPL && UPL.name === name ? `<div class="rup"><i class="spin"></i><span>${UPL.done}/${UPL.total} 올리는 중</span></div>` : `<button type="button" class="radd" data-radd>${CAM}<span>${r ? '추가' : '사진 등록'}</span></button>`}</div></div>`;
  }
  // 레시피 사진 전체 화면 보기 — 두 손가락 확대/축소, 두 번 탭 확대, 끌어서 이동, 좌우 넘기기
  function openRecipe(name, start = 0) {
    const r = recipeOf(name);
    if (!r) { const mm = D.alive(S.menus).find(x => rKey(x.name) === rKey(name)); if (mm) openDetail(mm.id); return; }
    let i = Math.min(start, r.photos.length - 1);
    const fv = document.createElement('div');
    fv.className = 'fv'; fv.setAttribute('role', 'dialog'); fv.setAttribute('aria-label', name + ' 레시피 사진');
    fv.innerHTML = `
      <div class="fvbar"><button class="fvx" data-fclose aria-label="닫기">‹ 돌아가기</button><b class="fvt">${esc(name)}</b><span class="fvc"></span></div>
      <div class="fvwrap">
        <div class="fvstage"><img class="fvimg" alt="레시피 사진" draggable="false"></div>
        <button class="fvn prev" data-step="-1" aria-label="이전 사진">‹</button><button class="fvn next" data-step="1" aria-label="다음 사진">›</button>
        <div class="fvzoom"><button data-zoom="-1" aria-label="축소">−</button><button data-zoom="0" aria-label="화면에 맞추기">맞춤</button><button data-zoom="1" aria-label="확대">+</button></div>
      </div>
      <div class="fvsheet">
        <button class="fvh" data-sheet><span class="grab"></span><span class="fvhl">만들 때 참고 <small class="ncnt"></small></span></button>
        <div class="fvbody">
          <div class="fvacts"><span class="fvo"></span><span><button class="btn sm" data-radd>사진 추가</button> <button class="btn sm ghost" data-rdel>이 요리에서 빼기</button></span></div>
          <div class="nhost"></div>
        </div>
      </div>`;
    document.body.appendChild(fv);
    document.body.classList.add('fv-open');
    const img = $('.fvimg', fv), stage = $('.fvstage', fv), nhost = $('.nhost', fv);
    let sc = 1, tx = 0, ty = 0;
    const apply = (anim) => { img.style.transition = anim ? 'transform .18s ease' : 'none'; img.style.transform = `translate(${tx}px,${ty}px) scale(${sc})`; fv.classList.toggle('zoomed', sc > 1.01); };
    const clamp = () => {
      const W = stage.clientWidth, H = stage.clientHeight, iw = img.clientWidth * sc, ih = img.clientHeight * sc;
      const mx = Math.max(0, (iw - W) / 2), my = Math.max(0, (ih - H) / 2);
      tx = Math.min(mx, Math.max(-mx, tx)); ty = Math.min(my, Math.max(-my, ty));
    };
    const zoomAt = (ns, cx, cy, anim) => {
      ns = Math.min(5, Math.max(1, ns));
      const rc = stage.getBoundingClientRect(), ox = cx - rc.left - rc.width / 2, oy = cy - rc.top - rc.height / 2;
      tx = ox - (ox - tx) * ns / sc; ty = oy - (oy - ty) * ns / sc; sc = ns;
      if (sc <= 1.01) { sc = 1; tx = 0; ty = 0; }
      clamp(); apply(anim);
    };
    const reset = () => { sc = 1; tx = 0; ty = 0; apply(true); };
    const paintNotes = () => { nhost.innerHTML = notesHtml(name); const n = notesOf(name).length; $('.ncnt', fv).textContent = n ? n + '개' : ''; };
    wireNotes(nhost, name, paintNotes);
    const paint = () => {
      const rr = recipeOf(name); if (!rr) return close();
      i = (i + rr.photos.length) % rr.photos.length;
      img.src = Y.photoUrl(rr.photos[i].path); reset();
      $('.fvc', fv).textContent = rr.photos.length > 1 ? `${i + 1} / ${rr.photos.length}` : '';
      const others = recipesUsing(rr.photos[i].path).filter(n => rKey(n) !== rKey(name));
      $('.fvo', fv).textContent = others.length ? `같은 사진을 쓰는 요리: ${others.join(', ')}` : '';
      $$('.fvn', fv).forEach(b => { b.hidden = rr.photos.length < 2; });
      paintNotes();
    };
    const close = () => { fv.remove(); document.body.classList.remove('fv-open'); document.removeEventListener('keydown', onKey, true); };
    const onKey = e => {
      if (e.target.matches && e.target.matches('input')) { if (e.key === 'Escape') e.target.blur(); return; }
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      if (e.key === 'ArrowLeft') { i--; paint(); } if (e.key === 'ArrowRight') { i++; paint(); }
      if (e.key === '+' || e.key === '=') zoomAt(sc * 1.5, innerWidth / 2, innerHeight / 2, true);
      if (e.key === '-') zoomAt(sc / 1.5, innerWidth / 2, innerHeight / 2, true);
    };
    document.addEventListener('keydown', onKey, true);
    // 손가락 · 마우스 제스처
    const pts = new Map(); let start0 = null, lastTap = 0, moved = false;
    stage.addEventListener('pointerdown', e => {
      stage.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = false;
      const ps = [...pts.values()];
      if (ps.length === 2) { const d = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y); start0 = { d, sc, tx, ty, cx: (ps[0].x + ps[1].x) / 2, cy: (ps[0].y + ps[1].y) / 2 }; }
      else start0 = { x: e.clientX, y: e.clientY, tx, ty };
    });
    stage.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const ps = [...pts.values()];
      if (ps.length === 2 && start0 && start0.d) {
        const d = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
        sc = start0.sc; tx = start0.tx; ty = start0.ty;
        zoomAt(start0.sc * d / start0.d, start0.cx, start0.cy, false); moved = true;
      } else if (ps.length === 1 && start0 && start0.x != null) {
        const dx = e.clientX - start0.x, dy = e.clientY - start0.y;
        if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
        if (sc > 1) { tx = start0.tx + dx; ty = start0.ty + dy; clamp(); apply(false); }
        else { img.style.transition = 'none'; img.style.transform = `translate(${dx}px,0)`; }
      }
    });
    const up = e => {
      if (!pts.has(e.pointerId)) return;
      const wasOne = pts.size === 1; pts.delete(e.pointerId);
      if (wasOne && start0 && start0.x != null) {
        const dx = e.clientX - start0.x;
        if (sc <= 1 && Math.abs(dx) > 60 && (recipeOf(name) || {}).photos.length > 1) { i += dx < 0 ? 1 : -1; paint(); start0 = null; return; }
        if (sc <= 1) apply(true);
        if (!moved) { const now = Date.now(); if (now - lastTap < 300) { zoomAt(sc > 1.01 ? 1 : 2.5, e.clientX, e.clientY, true); lastTap = 0; } else lastTap = now; }
      }
      if (pts.size === 1) { const p0 = [...pts.values()][0]; start0 = { x: p0.x, y: p0.y, tx, ty }; } else if (!pts.size) start0 = null;
    };
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
    stage.addEventListener('wheel', e => { e.preventDefault(); zoomAt(sc * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX, e.clientY, false); }, { passive: false });
    img.addEventListener('load', () => { clamp(); apply(false); });
    fv.addEventListener('click', e => {
      if (e.target.closest('[data-fclose]')) return close();
      const st = e.target.closest('[data-step]'); if (st) { i += +st.dataset.step; return paint(); }
      const z = e.target.closest('[data-zoom]'); if (z) { const v = +z.dataset.zoom; return v === 0 ? reset() : zoomAt(v > 0 ? sc * 1.6 : sc / 1.6, innerWidth / 2, stage.getBoundingClientRect().top + stage.clientHeight / 2, true); }
      if (e.target.closest('[data-sheet]')) return fv.classList.toggle('sheet-open');
      if (e.target.closest('[data-radd]')) return pickPhotos(name, () => { if (!UPL) paint(); });
      if (e.target.closest('[data-rdel]')) {
        if (!confirm(`이 사진을 '${name}' 레시피에서 뺄까요? 같은 요리 모든 날짜에서 사라져요.`)) return;
        const k = rKey(name), rr = S.recipes[k], [gone] = rr.photos.splice(i, 1);
        rr.updatedAt = D.now(); commit();
        if (!recipesUsing(gone.path).length) Y.removePhoto(gone.path);
        toast('사진을 뺐어요');
        if (!rr.photos.length) return close();
        paint();
      }
    });
    if (notesOf(name).length) fv.classList.add('sheet-open');
    paint();
  }

  function shortLine(m) {
    const r = EV.get(m.id);
    if (!r || r.state !== 'short') return '';
    return `<span class="s-short sl">${r.short.map(l => esc(l.name) + ' ' + D.fmtAmt(l.short, l.unit)).join(' · ')}</span>`;
  }
  function statusHtml(m) {
    const r = EV.get(m.id) || { state: 'ready', short: [] };
    if (r.state !== 'short') return `<span class="stl">${pill(r.state)}</span>`;
    return `<span class="stl">${pill('short')}<span class="s-short sl">${r.short.map(l => esc(l.name) + ' ' + D.fmtAmt(l.short, l.unit)).join(' · ')}</span></span>`;
  }
  // 이름 앞 상태 점: 파랑=부족, 검정=재료 준비 완료, 연회색=완성
  function dotHtml(m) {
    const st = (EV.get(m.id) || {}).state || 'ready';
    return `<i class="sd sd-${st}" title="${PILL[st]}"></i>`;
  }

  // ---------------- 화면 ----------------
  function render() {
    D.buildTemplates(S.menus);
    EV = D.evaluate(S, thisMon());
    renderPlan();
    renderSide();
    paintSync();
    document.body.dataset.mtab = U.mtab;
    document.body.classList.toggle('hide-short', !!U.hideShort);
    const shopN = D.shopping(S, thisMon(), EV).length;
    $$('.shop-count').forEach(e => e.textContent = shopN ? shopN : '');
  }

  function weekTitle(mon) {
    const t = thisMon();
    if (mon === t) return '이번 주';
    if (mon === D.addDays(t, 7)) return '다음 주';
    if (mon === D.addDays(t, 14)) return '다다음 주';
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
        if (!ms.length) { emptyN++; cells += `<button class="c emp" data-slot="${d}|${meal}" data-add="${d}|${meal}" aria-label="${D.md(d)} ${meal} 추가">+</button>`; continue; }
        cells += `<div class="c${ms.length > 1 ? ' multi' : ''}" data-slot="${d}|${meal}">` + ms.map(m => {
          cnt++; const st = (EV.get(m.id) || {}).state;
          if (st === 'done') done++; else if (st === 'ready') ready++; else short++;
          return `<button class="mi${st === 'done' ? ' done' : ''}" data-open="${m.id}" draggable="true" data-drag="${m.id}" title="${esc(m.name)} · 끌어서 옮기기 (Alt 누르고 끌면 복사)"><span class="row1">${dotHtml(m)}<span class="n">${esc(m.name)}</span>${rcpIcon(m)}${pill((EV.get(m.id) || {}).state || 'ready')}</span>${shortLine(m)}</button>`;
        }).join('') + `<button class="add-sm" data-add="${d}|${meal}" aria-label="${D.md(d)} ${meal} 요리 하나 더 추가">+ 하나 더</button></div>`;
      }
    }
    cells += `<div class="rh nh">영양<small>하루</small></div>` + days.map(d => nutCell(d)).join('');
    const stats = cnt ? `메뉴 ${cnt}개 · 재료 필요 ${short} · 요리 필요 ${ready} · 완성 ${done}${emptyN ? ' · 빈 칸 ' + emptyN : ''}` : '아직 등록한 식단이 없어요';
    const copyBtn = '';
    return `<section class="wk">
      <div class="st"><h2>${weekTitle(mon)}</h2><span>${D.md(mon)} – ${D.md(D.addDays(mon, 6))}</span><span class="stats">${stats}</span>${copyBtn}</div>
      <div class="tb"><div class="gr">${cells}</div></div>
      <div class="nutref">영양은 등록한 재료로 계산한 대략값이에요(몇 끼 분량이면 나눠서 계산). %는 6~11개월 하루 권장량(단백질 15g · 철분 6mg) 대비예요.</div></section>`;
  }

  // 일자별 영양 요약 (대략값)
  function nutOfDay(d) { return window.Nutri.day(D.alive(S.menus).filter(m => m.date === d)); }
  function nutCell(d) {
    const n = nutOfDay(d), R = window.Nutri.REF;
    if (!n.counted) return `<div class="c nut empty">${n.missing.length ? '영양정보 없는 재료뿐' : '–'}</div>`;
    const pct = (v, r) => Math.round(v / r * 100);
    const tip = `탄수화물 ${Math.round(n.carb)}g · 지방 ${Math.round(n.fat)}g` + (n.missing.length ? ` · 계산 제외: ${n.missing.join(', ')}` : '');
    return `<div class="c nut" title="${esc(tip)}">
      <b>${Math.round(n.kcal)}<small>kcal</small></b>
      <span>단백질 ${n.protein.toFixed(1)}g <em>${pct(n.protein, R.protein)}%</em></span>
      <span>철분 ${n.iron.toFixed(1)}mg <em>${pct(n.iron, R.iron)}%</em></span>
      ${n.missing.length ? `<span class="miss" tabindex="0" data-tip="영양정보 없어 제외: ${esc(n.missing.join(', '))}">제외 ${n.missing.length}개</span>` : ''}</div>`;
  }
  function nutCard(d) {
    const n = nutOfDay(d), R = window.Nutri.REF;
    if (!n.counted) return '';
    const pct = (v, r) => Math.round(v / r * 100);
    return `<div class="ncard"><div class="nt">오늘 영양 요약 <small>대략 · 6~11개월 권장량 대비</small></div>
      <div class="ng"><div><b>${Math.round(n.kcal)}</b><small>kcal · ${pct(n.kcal, R.kcal)}%</small></div>
      <div><b>${n.protein.toFixed(1)}g</b><small>단백질 · ${pct(n.protein, R.protein)}%</small></div>
      <div><b>${n.iron.toFixed(1)}mg</b><small>철분 · ${pct(n.iron, R.iron)}%</small></div></div>
      <div class="nsub">탄수화물 ${Math.round(n.carb)}g · 지방 ${Math.round(n.fat)}g${n.missing.length ? ` · 계산 제외: ${esc(n.missing.join(', '))}` : ''}</div></div>`;
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
      body += `<div class="mslot" data-slot="${U.selDay}|${meal}"><div class="ml"><span>${meal}</span>${ms.length ? `<button class="tbtn" data-add="${U.selDay}|${meal}">+ 하나 더</button>` : ''}</div>`;
      body += ms.map(m => `<button class="card${m.done ? ' done' : ''}" data-open="${m.id}"><span class="row1">${dotHtml(m)}<span class="n">${esc(m.name)}</span>${rcpIcon(m)}${pill((EV.get(m.id) || {}).state || 'ready')}</span>${shortLine(m)}</button>`).join('');
      if (!ms.length) body += `<button class="card add" data-add="${U.selDay}|${meal}">+ 추가</button>`;
      body += '</div>';
    }
    return `<div class="mob">
      <div class="mweek"><button class="wkbtn" data-mweek="-7" aria-label="이전 주">‹ 이전 주</button><span class="wkt"><b>${weekTitle(mon)}</b><small>${D.md(mon)} – ${D.md(D.addDays(mon, 6))}</small></span><button class="wkbtn" data-mweek="7" aria-label="다음 주">다음 주 ›</button></div>
      <div class="days">${chips}</div>
      <div class="mday"><div class="mdt"><b>${dd.getMonth() + 1}월 ${dd.getDate()}일 ${D.dow(U.selDay)}요일</b><span>${all.length ? '완성 ' + doneN + ' / ' + all.length : ''}</span></div>
      ${legendHtml()}${body}${nutCard(U.selDay)}</div></div>`;
  }
  const legendHtml = () => `<div class="legend"><span class="lgt">표시 안내</span>${pill('short')}${pill('ready')}${pill('done')}
    <label class="tg"><input type="checkbox" data-toggle-short ${U.hideShort ? '' : 'checked'}>부족한 재료 보기</label></div>`;

  // ---------------- 냉장고 ↔ 메뉴 단위 불일치 ----------------
  // 같은 재료인데 냉장고 단위와 메뉴 단위가 달라 재고로 못 잡는 것
  function unitMismatches() {
    const fr = new Map();
    for (const f of D.alive(S.fridge)) { if (!(f.qty > 0)) continue; const k = M.canon(f.name); (fr.get(k) || fr.set(k, []).get(k)).push(f); }
    const out = [];
    for (const [k, fs] of fr) {
      const fUnits = new Set(fs.map(f => D.toBase(1, f.unit)[1]));
      const rows = [];
      for (const m of D.alive(S.menus)) {
        if (m.done) continue;
        (m.ings || []).forEach((g, i) => { if (M.canon(g.name) === k && !fUnits.has(D.toBase(1, g.unit)[1])) rows.push({ m, i, qty: num(g.qty) || 0, unit: g.unit }); });
      }
      if (rows.length) out.push({ key: k, name: fs[0].name, fridge: fs, rows });
    }
    return out;
  }
  function mismatchBanner() {
    const mm = unitMismatches();
    if (!mm.length) return '';
    return `<div class="umb" role="alert"><span><b>단위가 달라 냉장고 재료로 못 잡는 재료</b> · ${mm.map(x => `${esc(x.name)} <small>(냉장고 ${esc(x.fridge.map(f => f.unit).join('/'))} · 메뉴 ${esc([...new Set(x.rows.map(r => r.unit))].join('/'))})</small>`).join(', ')}</span><button class="btn sm" data-fixunit>단위 맞추기</button></div>`;
  }
  // 수량 qty(from 단위)를 to 단위로 환산 (모르면 '')
  function convQty(name, qty, from, to) {
    const a = D.toBase(qty, from), b = D.toBase(1, to);
    if (a[1] === b[1]) return Math.round(a[0] / b[0] * 100) / 100;
    const g = window.Nutri.gramsOf(name, qty, from), per = window.Nutri.gramsOf(name, 1, to);
    return g != null && per ? Math.round(g / per * 100) / 100 : '';
  }
  function openUnitFix(list, after) {
    list = list || unitMismatches();
    if (!list.length) { after && after(); return; }
    const x = list[0], rest = list.slice(1);
    const fUnit = x.fridge[0].unit, mUnits = [...new Set(x.rows.map(r => r.unit))];
    const mUnit = mUnits[0];
    const byVal = new Map();
    for (const r of x.rows) { const k = r.qty + '|' + r.unit; (byVal.get(k) || byVal.set(k, { qty: r.qty, unit: r.unit, rows: [] }).get(k)).rows.push(r); }
    const vals = [...byVal.values()];
    const menuN = new Set(x.rows.map(r => r.m.id)).size;
    let mode = 'menu';
    const md = openModal(`
      <div class="mh"><div><div class="sub">단위 맞추기${list.length > 1 ? ` · ${list.length}개 중 1` : ''}</div><h3>${esc(x.name)} 단위가 서로 달라요</h3></div><button class="x" data-close aria-label="닫기">×</button></div>
      <p class="desc">냉장고에는 <b>${x.fridge.map(f => D.fmtQ(f.qty) + esc(f.unit)).join(', ')}</b>, 메뉴 ${menuN}곳에는 <b>${esc(mUnits.join('/'))}</b>로 들어가 있어서 있는 재료를 못 찾고 있어요. 어느 쪽에 맞출까요?</p>
      <div class="seg uf"><button type="button" data-mode="menu" class="on">메뉴를 '${esc(fUnit)}'로</button><button type="button" data-mode="fridge">냉장고를 '${esc(mUnit)}'로</button></div>
      <div class="ufb" data-for="menu">
        ${vals.map((v, i) => `<div class="usr"><span class="old">${D.fmtQ(v.qty)}${esc(v.unit)} <small>${v.rows.length}곳</small></span><span class="arr">→</span><input class="in" inputmode="decimal" data-v="${i}" value="${convQty(x.name, v.qty, v.unit, fUnit)}" placeholder="?"><span class="nu">${esc(fUnit)}</span></div>`).join('')}
      </div>
      <div class="ufb" data-for="fridge" hidden>
        ${x.fridge.map((f, i) => `<div class="usr"><span class="old">냉장고 ${D.fmtQ(f.qty)}${esc(f.unit)}</span><span class="arr">→</span><input class="in" inputmode="decimal" data-f="${i}" value="${convQty(x.name, f.qty, f.unit, mUnit)}" placeholder="?"><span class="nu">${esc(mUnit)}</span></div>`).join('')}
        ${mUnits.length > 1 ? `<div class="note">메뉴에는 ${esc(mUnits.join(', '))}가 섞여 있어요. 냉장고를 '${esc(mUnit)}'로 바꾸면 나머지는 다음에 다시 물어봐요.</div>` : ''}
      </div>
      <div class="note">값은 대략적인 무게로 미리 계산해 뒀어요(예: 사과 1개 ≈ 250g). 맞지 않으면 고쳐 주세요.</div>
      <div class="mf"><button class="btn pri" data-act="apply">맞추기</button><button class="btn ghost" data-close>나중에</button></div>`, 'small unitsync');
    const paint = () => { $$('.uf button', md).forEach(b => b.classList.toggle('on', b.dataset.mode === mode)); $$('.ufb', md).forEach(b => { b.hidden = b.dataset.for !== mode; }); };
    md.addEventListener('click', e => {
      const sb = e.target.closest('[data-mode]'); if (sb) { mode = sb.dataset.mode; paint(); return; }
      if (e.target.closest('[data-close]')) { closeModal(); after && after(); return; }
      if (!e.target.closest('[data-act=apply]')) return;
      const inputs = $$(`.ufb[data-for=${mode}] input`, md);
      const empty = inputs.find(i => !(num(i.value) > 0));
      if (empty) { empty.focus(); toast('바꿀 양을 적어 주세요'); return; }
      const t = D.now(), undo = [];
      if (mode === 'menu') {
        inputs.forEach(inp => {
          const v = vals[+inp.dataset.v], q = num(inp.value);
          v.rows.forEach(r => { undo.push([r.m, 'ings', r.m.ings.map(g => ({ ...g }))]); r.m.ings[r.i] = { ...r.m.ings[r.i], qty: q, unit: fUnit }; r.m.updatedAt = t; });
        });
      } else {
        inputs.forEach(inp => { const f = x.fridge[+inp.dataset.f]; undo.push([f, 'qu', { qty: f.qty, unit: f.unit }]); Object.assign(f, { qty: num(inp.value), unit: mUnit, updatedAt: t }); });
      }
      closeModal(); commit();
      toast(mode === 'menu' ? `메뉴 ${menuN}곳의 ${x.name} 단위를 '${fUnit}'로 맞췄어요` : `냉장고 ${x.name}을(를) '${mUnit}'로 바꿨어요`, () => {
        const u = D.now();
        undo.reverse().forEach(([o, kind, v]) => { if (kind === 'ings') o.ings = v; else Object.assign(o, v); o.updatedAt = u; });
        commit();
      });
      const left = unitMismatches().filter(y => rest.some(r => r.key === y.key));
      if (left.length) openUnitFix(left, after); else after && after();
    });
  }
  // 저장 직후 새로 생긴 불일치면 바로 알림
  function checkUnitFor(names, after) {
    const ks = new Set(names.map(n => M.canon(n)));
    const mm = unitMismatches().filter(x => ks.has(x.key));
    if (mm.length) { openUnitFix(mm, after); return true; }
    return false;
  }

  function renderPlan() {
    $('#plan').innerHTML = `${mismatchBanner()}<div class="desk">${legendHtml()}${[0, 7, 14].map(n => sectionHtml(D.addDays(U.weekStart, n), n > 0)).join('')}</div>${mobileHtml()}`;
  }

  // 만들 요리: 이번 주 월요일 이후 안 만든 메뉴를 이름별로 묶어 가장 이른 날짜 순
  function cookItems() {
    const from = thisMon(), today = D.todayIso();
    const g = new Map();
    for (const m of D.sortMenus(D.alive(S.menus))) {
      if (m.done || m.date < from) continue;
      const k = M.norm(m.name);
      const it = g.get(k) || { name: m.name, list: [] };
      it.list.push(m); g.set(k, it);
    }
    return [...g.values()].map(it => {
      const first = it.list[0];
      const shorts = it.list.map(m => EV.get(m.id)).filter(r => r && r.state === 'short');
      const shortNames = [...new Set(shorts.flatMap(r => r.short.map(l => l.name)))];
      const diff = Math.round((D.parse(first.date) - D.parse(today)) / 864e5);
      const when = diff < 0 ? '지남' : diff === 0 ? '오늘' : diff === 1 ? '내일' : `${D.md(first.date)}(${D.dow(first.date)})`;
      return { ...it, first, shortNames, when, diff };
    });
  }

  function renderSide() {
    const ck = cookItems();
    $('#ccount').textContent = ck.length || '';
    $('#cookList').innerHTML = ck.length ? ck.map(it => `
      <button class="cook" data-open="${it.first.id}">
        <span class="cw${it.diff <= 0 ? ' soon' : ''}">${it.when}</span>
        <span class="cn"><b><i class="sd sd-${it.shortNames.length ? 'short' : 'ready'}"></i>${esc(it.name)}</b><small>${esc(it.first.meal)}${it.list.length > 1 ? ` 외 ${it.list.length - 1}끼` : ''}</small><span class="stl">${pill(it.shortNames.length ? 'short' : 'ready')}${it.shortNames.length ? `<span class="s-short sl">${esc(it.shortNames.join(', '))}</span>` : ''}</span></span>
      </button>`).join('') : '<div class="emptytxt">만들 요리가 없어요.</div>';
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
      if (e.isComposing || e.keyCode === 229) return;
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
    for (const mm of D.sortMenus(D.alive(S.menus))) m.set(mm.name, { name: mm.name, ings: mm.ings, serves: mm.serves, hint: (mm.ings || []).length ? '재료 ' + mm.ings.map(g => g.name).slice(0, 4).join(', ') + (mm.ings.length > 4 ? ' 외' : '') : '' });
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
      <div class="rhost">${recipeStrip(m.name)}</div>
      <div class="nhost">${notesHtml(m.name)}</div>
      <div class="mf">
        ${m.done ? `<button class="btn" data-act="undo">완성 취소</button>` : `<button class="btn pri" data-act="done">완성으로 표시</button>`}
        <button class="btn" data-act="clone">복제하기</button>
        <button class="btn" data-act="move">옮기기</button>
        ${(() => { const sib = menusAt(m.date, m.meal); const i = sib.indexOf(m); return sib.length > 1 ? `<span class="ordbtns"><button class="btn" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="같은 끼니에서 위로">↑</button><button class="btn" data-act="down" ${i === sib.length - 1 ? 'disabled' : ''} aria-label="같은 끼니에서 아래로">↓</button></span>` : ''; })()}
        <button class="btn" data-act="edit">수정</button>
        <button class="btn ghost" data-act="del">삭제</button>
      </div>`, 'detail');
    const repaintR = () => { const h = $('.rhost', md); if (h) h.innerHTML = recipeStrip(m.name); };
    const nh = $('.nhost', md); wireNotes(nh, m.name, () => { nh.innerHTML = notesHtml(m.name); });
    md.addEventListener('click', e => {
      if (e.target.closest('[data-radd]')) return pickPhotos(m.name, repaintR);
      const rv = e.target.closest('[data-rview]'); if (rv) return openRecipe(m.name, +rv.dataset.rview);
      const a = e.target.closest('[data-act],[data-close]'); if (!a) return;
      if (a.hasAttribute('data-close')) return closeModal();
      const act = a.dataset.act;
      if (act === 'done') { closeModal(); openComplete(id); }
      else if (act === 'undo') { closeModal(); openUndo(id); }
      else if (act === 'edit') { closeModal(); openEdit({ id }); }
      else if (act === 'clone') { closeModal(); startPaste(id); }
      else if (act === 'move') { closeModal(); startPaste(id, 'move'); }
      else if (act === 'up' || act === 'down') {
        const i = menusAt(m.date, m.meal).indexOf(m);
        closeModal(); placeMenu(m, m.date, m.meal, i + (act === 'up' ? -1 : 1));
      }
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
    // 앞으로 예정된 같은 요리 (한 번에 여러 개 만들 때 같이 완성)
    const later = D.sortMenus(D.alive(S.menus).filter(x => x.id !== m.id && !x.done && M.norm(x.name) === M.norm(m.name) && x.date >= m.date));
    const md = openModal(`
      <div class="mh"><div><div class="sub">${D.md(m.date)} (${D.dow(m.date)}) ${esc(m.meal)}</div><h3>${esc(m.name)} 완성할까요?</h3></div><button class="x" data-close aria-label="닫기">×</button></div>
      ${later.length ? `<div class="batch">
        <div class="bt"><b>앞으로 예정된 '${esc(m.name)}' ${later.length}끼도 같이 완성할까요?</b><small>한 번에 여러 개 만들었다면 체크해 두세요</small></div>
        <label class="ball"><input type="checkbox" data-ball checked> 모두 선택</label>
        <div class="blist">${later.map(x => `<label class="bit"><input type="checkbox" data-later="${x.id}" checked><span>${D.md(x.date)} (${D.dow(x.date)}) ${esc(x.meal)}</span></label>`).join('')}</div>
      </div>` : ''}
      <p class="desc">만들 때 쓴 재료를 냉장고에서 차감할까요? 차감하지 않을 재료는 체크를 빼 주세요.</p>
      <div class="crows"></div>
      <div class="mf col">
        <button class="btn pri big" data-act="deduct"></button>
        <button class="btn" data-act="plain">차감 없이 완성만 표시</button>
        <button class="btn ghost" data-close>취소</button>
      </div>`, 'complete');
    const off = new Set(); // 차감 안 할 재료 키
    const chosen = () => [m, ...later.filter(x => { const c = $(`[data-later="${x.id}"]`, md); return c && c.checked; })];
    // 고른 메뉴들의 재료를 재료·단위별로 합친다
    const totals = () => {
      const t = new Map();
      for (const mm of chosen()) for (const g of mm.ings || []) {
        if (!g.name) continue;
        const [q, bu] = D.toBase(num(g.qty) || 0, g.unit);
        const k = M.canon(g.name) + '|' + bu;
        const it = t.get(k) || { k, name: g.name, bu, need: 0 }; it.need += q; t.set(k, it);
      }
      return [...t.values()];
    };
    const paint = () => {
      const list = totals(), n = chosen().length;
      $('.crows', md).innerHTML = list.length ? `<div class="lnh"><span>재료${n > 1 ? ` (${n}끼 분량 합계)` : ''}</span><span>냉장고 → 차감 후</span></div>` + list.map(it => {
        const have = fridgeMatch(it.name, it.bu).filter(f => f.qty > 0).reduce((s2, f) => s2 + D.toBase(f.qty, f.unit)[0], 0);
        const can = have > 0;
        return `<label class="cr${can ? '' : ' off'}"><input type="checkbox" data-k="${esc(it.k)}" ${can && !off.has(it.k) ? 'checked' : ''} ${can ? '' : 'disabled'}><span>${esc(it.name)} <small>${D.fmtAmt(it.need, it.bu)}</small></span><span class="q">${can ? `${D.fmtAmt(have, it.bu)} → <b>${D.fmtAmt(Math.max(0, have - it.need), it.bu)}</b>${have + 1e-9 < it.need ? ' <small>(부족)</small>' : ''}` : '냉장고에 없음'}</span></label>`;
      }).join('') : '';
      const k = $$('.crows input:checked', md).length;
      $('[data-act=deduct]', md).textContent = (k ? `재료 ${k}개 차감하고 ` : '') + (n > 1 ? `${n}끼 완성` : '완성');
      $('[data-act=plain]', md).textContent = `차감 없이 완성만 표시${n > 1 ? ` (${n}끼)` : ''}`;
      const all = $('[data-ball]', md); if (all) { const cs = $$('[data-later]', md); all.checked = cs.every(c => c.checked); all.indeterminate = !all.checked && cs.some(c => c.checked); }
    };
    paint();
    md.addEventListener('change', e => {
      if (e.target.matches('[data-ball]')) $$('[data-later]', md).forEach(c => { c.checked = e.target.checked; });
      if (e.target.matches('[data-k]')) { if (e.target.checked) off.delete(e.target.dataset.k); else off.add(e.target.dataset.k); }
      paint();
    });
    md.addEventListener('click', e => {
      const a = e.target.closest('[data-act],[data-close]'); if (!a) return;
      if (a.hasAttribute('data-close')) return closeModal();
      const group = chosen(), deducted = [];
      if (a.dataset.act === 'deduct') {
        for (const it of totals()) {
          if (off.has(it.k)) continue;
          let need = it.need;
          for (const f of fridgeMatch(it.name, it.bu)) {
            if (need <= 1e-9) break;
            const [fq] = D.toBase(f.qty, f.unit); if (!(fq > 0)) continue;
            const factor = fq / (f.qty || 1), take = Math.min(fq, need);
            f.qty = Math.max(0, Math.round((f.qty - take / (factor || 1)) * 1000) / 1000);
            f.updatedAt = D.now();
            need -= take;
            deducted.push({ name: f.name, qty: take, unit: it.bu });
          }
        }
      }
      const t = D.now(), batch = group.length > 1 ? D.uid() : null;
      group.forEach((x, i) => Object.assign(x, { done: true, doneAt: t, deducted: i === 0 ? deducted : [], batch, updatedAt: t }));
      closeModal(); commit();
      const what = group.length > 1 ? `${group.length}끼 완성` : '완성';
      toast(deducted.length ? `${what} · 재료 ${deducted.length}개 차감했어요` : `${what}으로 표시했어요`);
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
    const mates = m.batch ? D.sortMenus(D.alive(S.menus).filter(x => x.id !== m.id && x.done && x.batch === m.batch)) : [];
    const dedOf = list => list.flatMap(x => x.deducted || []);
    const md = openModal(`
      <div class="mh"><h3>완성을 취소할까요?</h3><button class="x" data-close aria-label="닫기">×</button></div>
      ${mates.length ? `<label class="ball"><input type="checkbox" data-mates checked> 같이 완성했던 ${mates.length}끼도 취소 <small>(${mates.map(x => `${D.md(x.date)} ${esc(x.meal)}`).join(', ')})</small></label>` : ''}
      <div class="dedbox"></div>
      <div class="mf col">
        <button class="btn pri" data-act="restore">재료 되돌리고 취소</button>
        <button class="btn" data-act="only">완성만 취소</button>
        <button class="btn ghost" data-close>닫기</button>
      </div>`, 'small');
    const group = () => { const c = $('[data-mates]', md); return c && c.checked ? [m, ...mates] : [m]; };
    const paint = () => {
      const ded = dedOf(group());
      $('.dedbox', md).innerHTML = ded.length ? `<p class="desc">완성할 때 차감했던 재료를 냉장고에 되돌릴까요?</p><div class="chips">${ded.map(d => `<span>${esc(d.name)} ${D.fmtAmt(d.qty, d.unit)}</span>`).join('')}</div>` : '';
      $('[data-act=restore]', md).hidden = !ded.length;
      $('[data-act=only]', md).classList.toggle('pri', !ded.length);
    };
    paint();
    md.addEventListener('change', paint);
    md.addEventListener('click', e => {
      const a = e.target.closest('[data-act],[data-close]'); if (!a) return;
      if (a.hasAttribute('data-close')) return closeModal();
      const g = group(), t = D.now();
      if (a.dataset.act === 'restore') for (const d of dedOf(g)) addToFridge(d.name, d.qty, d.unit);
      // 묶음 일부만 취소하면 남은 쪽에 차감 기록을 넘겨 준다
      if (g.length === 1 && mates.length && (m.deducted || []).length && a.dataset.act !== 'restore') mates[0].deducted = [...(mates[0].deducted || []), ...m.deducted];
      g.forEach(x => Object.assign(x, { done: false, doneAt: null, deducted: null, batch: null, updatedAt: t }));
      closeModal(); commit(); toast(g.length > 1 ? `${g.length}끼 완성을 취소했어요` : '완성을 취소했어요');
    });
  }


  // ---------------- 식단 추가 · 수정 ----------------
  function ingRowHtml(g = {}) {
    const unit = g.unit || '개';
    const units = D.UNITS.includes(unit) ? D.UNITS : [unit, ...D.UNITS];
    return `<div class="irw"><div class="ir">
      <div class="acw"><input class="iname" aria-label="재료 이름" placeholder="재료 이름" value="${esc(g.name || '')}" ${g.name ? 'data-ok="1"' : ''}></div>
      <input class="iqty" aria-label="수량" inputmode="decimal" autocomplete="off" placeholder="0" value="${g.qty != null && g.qty !== '' ? esc(D.fmtQ(num(g.qty))) : ''}">
      <select class="iunit" aria-label="단위">${units.map(u => `<option${u === unit ? ' selected' : ''}>${esc(u)}</option>`).join('')}</select>
      <button type="button" class="ib rm" tabindex="-1" aria-label="재료 줄 삭제">×</button></div><div class="has"></div></div>`;
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
        <div class="srv"><label for="mserves">이 재료로 몇 번 먹나요?</label><input id="mserves" class="in" inputmode="numeric" value="${m && m.serves ? m.serves : 1}"><span>끼 분량</span><small>냉동해서 나눠 먹으면 그 횟수 · 영양 계산에 써요</small></div>
        <div class="recall" hidden></div>
        <div class="lbr"><span class="lb">필요한 재료</span><small>수량은 0.5, 0.3처럼 소수점 가능</small></div>
        <div class="ings">${(ings.length ? ings : [{}, {}]).map(ingRowHtml).join('')}</div>
        <button type="button" class="addrow">+ 재료 한 줄 더</button>
        <div class="mf"><button type="submit" class="btn pri">저장</button>${m ? '' : '<button type="submit" class="btn" data-more="1">저장하고 같은 끼니에 하나 더</button>'}<button type="button" class="btn ghost" data-close>취소</button></div>
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
    const setUnitFor = (row, name, item) => {
      const sel = $('.iunit', row);
      if (sel.dataset.manual) return;
      const f = D.alive(S.fridge).find(x => x.name === name);
      const u = f ? f.unit : item && item.unit;
      if (!u) return;
      if (![...sel.options].some(o => o.value === u)) sel.insertAdjacentHTML('afterbegin', `<option>${esc(u)}</option>`);
      sel.value = u;
    };
    const wireRow = row => {
      const inp = $('.iname', row);
      attachAC(inp, {
        kind: 'ing', onPick: (name, item) => { setUnitFor(row, name, item); hasLine(row); $('.iqty', row).focus(); }
      });
      // Tab 으로 빠져나갈 때도 이미 있는 재료면 단위를 맞춰 둔다
      inp.addEventListener('change', () => {
        const n = inp.value.trim(); if (!n) return;
        const it = D.catalog(S).find(c => c.name === n);
        if (it) setUnitFor(row, n, it);
        hasLine(row);
      });
      $('.iunit', row).addEventListener('change', e => { e.target.dataset.manual = '1'; });
      // 수량 칸에는 숫자만 (한글 입력기에서 넘어온 글자 제거)
      const q = $('.iqty', row);
      q.addEventListener('input', () => { const v = q.value.replace(/[^0-9.,]/g, '').replace(',', '.'); if (v !== q.value) q.value = v; });
      ['input', 'change'].forEach(ev => row.addEventListener(ev, () => hasLine(row)));
      $('.rm', row).addEventListener('click', () => { row.remove(); if (!$('.irw', ingBox)) addRow(); });
      hasLine(row);
    };
    const addRow = (g) => { ingBox.insertAdjacentHTML('beforeend', ingRowHtml(g)); const row = ingBox.lastElementChild; wireRow(row); return row; };
    $$('.irw', ingBox).forEach(wireRow);
    $('.addrow', md).addEventListener('click', () => $('.iname', addRow()).focus());
    // Tab 순서: 재료 이름 → 수량 → 단위 → 다음 재료 이름 (마지막이면 새 줄)
    ingBox.addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;
      const t = e.target, row = t.closest('.irw'); if (!row) return;
      const rows = $$('.irw', ingBox), ri = rows.indexOf(row);
      let next = null;
      if (!e.shiftKey) {
        if (t.matches('.iname')) next = () => $('.iqty', row);
        else if (t.matches('.iqty')) next = () => $('.iunit', row);
        else if (t.matches('.iunit')) next = () => $('.iname', rows[ri + 1] || addRow());
      } else {
        if (t.matches('.iunit')) next = () => $('.iqty', row);
        else if (t.matches('.iqty')) next = () => $('.iname', row);
        else if (t.matches('.iname') && ri > 0) next = () => $('.iunit', rows[ri - 1]);
      }
      if (!next) return;
      e.preventDefault();
      // 맥 한글 입력 중이면 먼저 지금 칸에 글자를 확정시키고 옮긴다
      if (e.isComposing || e.keyCode === 229) { t.blur(); setTimeout(() => { const n = next(); n && n.focus(); }, 0); }
      else { const n = next(); n && n.focus(); }
    });

    // 메뉴 이름 자동완성 → 예전 재료 불러오기
    const nameInp = $('#mname', md);
    const recall = $('.recall', md);
    attachAC(nameInp, {
      kind: 'menu', onPick: (name, item) => {
        if (!item || !item.ings || !item.ings.length) { recall.hidden = true; return; }
        const filled = $$('.iname', ingBox).some(i => i.value.trim());
        recall.innerHTML = `<div class="rt">전에 '${esc(name)}' 만들 때 쓴 재료를 불러올까요?</div>
          <div class="chips">${item.ings.map(g => `<span>${esc(g.name)} ${D.fmtQ(num(g.qty) || 0)}${esc(g.unit)}</span>`).join('')}</div>
          <div class="rb"><button type="button" class="btn sm dark" data-recall="yes">${filled ? '지금 재료 대신 불러오기' : '불러오기'}</button><button type="button" class="btn sm ghost" data-recall="no">괜찮아요</button></div>`;
        recall.hidden = false;
        recall._ings = item.ings; recall._serves = item.serves;
      }
    });
    nameInp.addEventListener('input', () => { recall.hidden = true; });
    recall.addEventListener('click', e => {
      const b = e.target.closest('[data-recall]'); if (!b) return;
      if (b.dataset.recall === 'yes') { ingBox.innerHTML = ''; recall._ings.forEach(g => addRow(g)); if (recall._serves) $('#mserves', md).value = recall._serves; toast('재료를 불러왔어요. 양은 필요하면 고쳐 주세요'); }
      recall.hidden = true;
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
      const serves = Math.max(1, Math.round(num($('#mserves', md).value)) || 1);
      const prevIngs = m ? (m.ings || []).map(g => ({ ...g })) : [];
      let saved = m;
      if (m) Object.assign(m, { name, date: st.date, meal: st.meal, ings: out, serves, updatedAt: D.now() });
      else { saved = { id: D.uid(), name, date: st.date, meal: st.meal, ings: out, serves, done: false, createdAt: D.now(), updatedAt: D.now() }; S.menus.push(saved); }
      closeModal(); commit();
      toast(m ? '수정했어요' : `${D.md(st.date)} ${st.meal}에 추가했어요`);
      const more = !m && e.submitter && e.submitter.dataset.more;
      const next = () => { if (more) openEdit({ date: st.date, meal: st.meal }); };
      const afterSync = () => { if (!checkUnitFor(out.map(g => g.name), next)) next(); };
      const asked = askUnitSync(saved, prevIngs, afterSync);
      if (!asked) afterSync();
    });
  }

  // ---------------- 같은 메뉴 단위 맞추기 ----------------
  // 저장한 메뉴의 재료 단위가 같은 이름의 다른 메뉴들과 다르면 맞출지 묻는다
  function askUnitSync(saved, prevIngs, after) {
    const others = D.alive(S.menus).filter(x => x.id !== saved.id && M.norm(x.name) === M.norm(saved.name));
    if (!others.length) return false;
    const groups = [];
    for (const g of saved.ings || []) {
      const c = M.canon(g.name);
      const rows = [];
      for (const o of D.sortMenus(others)) (o.ings || []).forEach((og, i) => { if (M.canon(og.name) === c && og.unit !== g.unit) rows.push({ o, i, qty: num(og.qty) || 0, unit: og.unit }); });
      if (!rows.length) continue;
      // 같은 기존 값끼리 묶어서 한 번만 입력
      const byVal = new Map();
      for (const r of rows) { const k = r.qty + '|' + r.unit; (byVal.get(k) || byVal.set(k, { qty: r.qty, unit: r.unit, rows: [] }).get(k)).rows.push(r); }
      // 이번 메뉴에서 단위를 바꾼 거라면 비율을 알 수 있다 (예: 60g → 1개)
      const prev = prevIngs.find(p => M.canon(p.name) === c && p.unit !== g.unit);
      const ratio = prev && num(prev.qty) > 0 ? { unit: prev.unit, r: (num(g.qty) || 0) / num(prev.qty) } : null;
      groups.push({ g, vals: [...byVal.values()], ratio });
    }
    if (!groups.length) return false;
    const r2 = v => Math.round(v * 100) / 100;
    const md = openModal(`
      <div class="mh"><div><div class="sub">${esc(saved.name)}</div><h3>같은 메뉴들도 단위를 바꿀까요?</h3></div><button class="x" data-close aria-label="닫기">×</button></div>
      <p class="desc">이 메뉴의 다른 날짜 ${others.length}곳에는 단위가 다르게 들어가 있어요. 바꾸면 기존 양을 새 단위로 어떻게 적을지만 정해 주세요.</p>
      ${groups.map((gr, gi) => `<div class="us">
        <div class="ush"><b>${esc(gr.g.name)}</b> → 이번에 <b>${D.fmtQ(num(gr.g.qty) || 0)}${esc(gr.g.unit)}</b>(으)로 입력</div>
        ${gr.vals.map((v, vi) => {
          const guess = gr.ratio && gr.ratio.unit === v.unit ? r2(v.qty * gr.ratio.r) : '';
          return `<div class="usr"><span class="old">${D.fmtQ(v.qty)}${esc(v.unit)}${v.rows.length > 1 ? ` <small>${v.rows.length}곳</small>` : ` <small>${D.md(v.rows[0].o.date)} ${esc(v.rows[0].o.meal)}</small>`}</span><span class="arr">→</span>
            <input class="in" inputmode="decimal" data-g="${gi}" data-v="${vi}" value="${guess}" placeholder="?" aria-label="${esc(gr.g.name)} ${D.fmtQ(v.qty)}${esc(v.unit)}를 ${esc(gr.g.unit)}로"><span class="nu">${esc(gr.g.unit)}</span></div>`;
        }).join('')}</div>`).join('')}
      <div class="note">한 칸을 채우면 단위가 같은 다른 칸도 같은 비율로 채워져요.</div>
      <div class="mf"><button class="btn pri" data-act="apply">바꾸기</button><button class="btn ghost" data-close>이번 메뉴만</button></div>`, 'small unitsync');
    const inputs = $$('input[data-g]', md);
    inputs.forEach(inp => inp.addEventListener('input', () => {
      inp.dataset.touched = '1';
      const gr = groups[+inp.dataset.g], v = gr.vals[+inp.dataset.v], val = num(inp.value);
      if (!(val > 0) || !(v.qty > 0)) return;
      const r = val / v.qty;
      inputs.filter(o => o !== inp && o.dataset.g === inp.dataset.g && !o.dataset.touched).forEach(o => {
        const ov = gr.vals[+o.dataset.v]; if (ov.unit === v.unit) o.value = r2(ov.qty * r);
      });
    }));
    const done = () => { closeModal(); after && after(); };
    md.addEventListener('click', e => {
      if (e.target.closest('[data-close]')) return done();
      if (!e.target.closest('[data-act=apply]')) return;
      const empty = inputs.find(i => !(num(i.value) > 0));
      if (empty) { empty.focus(); toast('새 단위로 얼마인지 적어 주세요'); return; }
      const t = D.now(), snap = [];
      inputs.forEach(inp => {
        const gr = groups[+inp.dataset.g], v = gr.vals[+inp.dataset.v], q = num(inp.value);
        v.rows.forEach(r => {
          snap.push([r.o, r.o.ings.map(x => ({ ...x }))]);
          r.o.ings[r.i] = { ...r.o.ings[r.i], qty: q, unit: gr.g.unit };
          r.o.updatedAt = t;
        });
      });
      const n = new Set(snap.map(x => x[0])).size;
      commit();
      toast(`같은 메뉴 ${n}곳의 단위를 맞췄어요`, () => { const u = D.now(); snap.reverse().forEach(([o, ings]) => { o.ings = ings; o.updatedAt = u; }); commit(); });
      done();
    });
    return true;
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
      checkUnitFor([n]);
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
    $('#cookList').addEventListener('click', e => { const b = e.target.closest('[data-open]'); if (b) openDetail(b.dataset.open); });
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
      const created = adds.map(m => ({ id: D.uid(), name: m.name, date: D.addDays(m.date, 7), meal: m.meal, ings: (m.ings || []).map(g => ({ ...g })), serves: m.serves || 1, done: false, createdAt: t, updatedAt: t }));
      S.menus.push(...created);
      closeModal(); commit();
      toast(`${created.length}끼 복사했어요`, () => { created.forEach(c => Object.assign(c, { deleted: true, updatedAt: D.now() })); commit(); });
    });
  }

  // ---------------- 복제 ----------------
  function openClone(id) {
    const m = findMenu(id); if (!m) return;
    const st = { date: D.addDays(m.date, 7) < D.todayIso() ? D.todayIso() : D.addDays(m.date, 7), meal: m.meal };
    const md = openModal(`
      <div class="mh"><div><div class="sub">복제하기</div><h3>${esc(m.name)}</h3></div><button class="x" data-close aria-label="닫기">×</button></div>
      <p class="desc">같은 메뉴와 재료(${(m.ings || []).length}개)를 원하는 날짜·끼니에 하나 더 만들어요. 복제한 메뉴는 '안 만든 상태'로 들어가요.</p>
      <div class="ef">
        <div class="row2">
          <div class="fld"><span class="lb">날짜</span><div class="calw"><button type="button" class="in datebtn"><span></span>${ICON.cal}</button></div></div>
          <div class="fld"><span class="lb">끼니</span><div class="seg">${D.MEALS.map(x => `<button type="button" data-meal="${x}">${x}</button>`).join('')}</div></div>
        </div>
      </div>
      <div class="mf"><button class="btn pri" data-act="go">복제</button><button class="btn ghost" data-close>취소</button></div>`, 'edit clone');
    const dateBtn = $('.datebtn', md);
    const paintDate = () => { $('span', dateBtn).textContent = dateLabel(st.date); };
    const paintMeal = () => $$('.seg button', md).forEach(b => b.classList.toggle('on', b.dataset.meal === st.meal));
    paintDate(); paintMeal();
    attachCal(dateBtn, () => st.date, d => { st.date = d; paintDate(); });
    md.addEventListener('click', e => {
      const mb = e.target.closest('[data-meal]'); if (mb) { st.meal = mb.dataset.meal; paintMeal(); return; }
      if (e.target.closest('[data-close]')) return closeModal();
      if (!e.target.closest('[data-act=go]')) return;
      const t = D.now();
      const c = { id: D.uid(), name: m.name, date: st.date, meal: st.meal, ings: (m.ings || []).map(g => ({ ...g })), done: false, createdAt: t, updatedAt: t };
      S.menus.push(c);
      closeModal(); commit();
      toast(`${D.md(st.date)} ${st.meal}에 복제했어요`, () => { Object.assign(c, { deleted: true, updatedAt: D.now() }); commit(); });
    });
  }

  // ---------------- 복제: 칸을 골라 붙여넣기 ----------------
  function startPaste(id, mode = 'copy') {
    const m = findMenu(id); if (!m) return;
    U.paste = { id, n: 0, mode };
    document.body.classList.add('pasting');
    const bar = $('#pasteBar');
    bar.innerHTML = mode === 'move'
      ? `<span><b>${esc(m.name)}</b> 옮길 칸을 누르세요<small class="pc"> · 지금 ${D.md(m.date)} ${esc(m.meal)}</small></span><button class="btn sm dark" data-pdone>취소</button>`
      : `<span><b>${esc(m.name)}</b> 붙여넣을 칸을 누르세요<small class="pc"></small></span><button class="btn sm dark" data-pdone>완료</button>`;
    bar.hidden = false;
    $('[data-pdone]', bar).onclick = endPaste;
  }
  function endPaste() {
    if (!U.paste) return;
    const n = U.paste.n;
    U.paste = null;
    document.body.classList.remove('pasting');
    $('#pasteBar').hidden = true;
    if (n) toast(`${n}칸에 붙여넣었어요`);
  }
  // 메뉴를 (date, meal) 칸의 idx 번째에 놓기 — 옮기기 · 복사 · 순서 바꾸기 공용
  function placeMenu(m, date, meal, idx, copy) {
    const others = menusAt(date, meal).filter(x => x.id !== m.id);
    const at = Math.max(0, Math.min(idx == null ? others.length : idx, others.length));
    const sameSlot = m.date === date && m.meal === meal;
    if (sameSlot && !copy && menusAt(date, meal).indexOf(m) === at) return;
    const touched = [...new Set([...others, ...menusAt(m.date, m.meal), m])];
    const snap = touched.map(x => [x, { date: x.date, meal: x.meal, ord: x.ord, ordAt: x.ordAt }]);
    let target = m, made = null;
    if (copy) {
      const t = D.now();
      made = target = { id: D.uid(), name: m.name, date, meal, ings: (m.ings || []).map(g => ({ ...g })), serves: m.serves || 1, done: false, createdAt: t, updatedAt: t };
      S.menus.push(made);
    }
    const list = others.slice(); list.splice(at, 0, target);
    const t = D.now();
    if (!copy) Object.assign(m, { date, meal });
    list.forEach((x, i) => { x.ord = i; x.ordAt = t; x.updatedAt = t; });
    commit();
    const msg = copy ? `${D.md(date)} ${meal}에 복사했어요` : sameSlot ? '순서를 바꿨어요' : `${D.md(date)} (${D.dow(date)}) ${meal}로 옮겼어요`;
    toast(msg, () => {
      const u = D.now();
      snap.forEach(([x, v]) => { Object.assign(x, v, { updatedAt: u }); if (v.ord == null) delete x.ord; if (v.ordAt == null) delete x.ordAt; });
      if (made) Object.assign(made, { deleted: true, updatedAt: u });
      commit();
    });
  }
  function moveMenu(m, date, meal, copy) { placeMenu(m, date, meal, null, copy); }
  function pasteTo(slot) {
    const m = findMenu(U.paste.id); if (!m) return endPaste();
    const [date, meal] = slot.split('|');
    if (U.paste.mode === 'move') { U.paste.n = 0; endPaste(); return moveMenu(m, date, meal, false); }
    const t = D.now();
    const c = { id: D.uid(), name: m.name, date, meal, ings: (m.ings || []).map(g => ({ ...g })), serves: m.serves || 1, done: false, createdAt: t, updatedAt: t };
    S.menus.push(c);
    U.paste.n++;
    commit();
    const pc = $('#pasteBar .pc'); if (pc) pc.textContent = ` · ${U.paste.n}칸 붙여넣음 · 계속 누르면 더 붙여넣어요`;
    toast(`${D.md(date)} ${meal}에 붙여넣었어요`, () => { Object.assign(c, { deleted: true, updatedAt: D.now() }); if (U.paste) U.paste.n = Math.max(0, U.paste.n - 1); commit(); });
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && U.paste && !stack.length) endPaste(); });

  // ---------------- 자동 정렬 ----------------
  function autoSort() {
    const ch = D.autoSortPlan(S.menus);
    if (!ch.length) return toast('맞출 끼니가 없어요. 같은 구성의 끼니에서 한 번 순서를 정해 두면 그 순서로 맞춰요');
    const snap = ch.flatMap(c => c.list).map(x => [x, { ord: x.ord, ordAt: x.ordAt }]);
    const t = D.now();
    // 기준 끼니보다 새 기준이 되지 않도록 ordAt 은 기준과 같게
    ch.forEach(c => c.list.forEach((x, i) => { x.ord = i; x.ordAt = c.at; x.updatedAt = t; }));
    commit();
    toast(`${ch.length}끼 순서를 맞췄어요`, () => {
      const u = D.now();
      snap.forEach(([x, v]) => { if (v.ord == null) delete x.ord; else x.ord = v.ord; if (v.ordAt == null) delete x.ordAt; else x.ordAt = v.ordAt; x.updatedAt = u; });
      commit();
    });
  }

  // ---------------- 계정 ----------------
  function openAccount() {
    const md = openModal(`
      <div class="mh"><h3>계정</h3><button class="x" data-close aria-label="닫기">×</button></div>
      <p class="desc"><b>${esc(Y.userId(ME))}</b>로 로그인돼 있어요. 가입한 사람은 모두 같은 식단표를 함께 봐요.</p>
      <div class="mf wrap">
        <button class="btn" data-act="backup">백업 내려받기</button>
        <button class="btn ghost" data-act="out">로그아웃</button>
      </div>`, 'small');
    md.addEventListener('click', async e => {
      if (e.target.closest('[data-close]')) return closeModal();
      const a = e.target.closest('[data-act]'); if (!a) return;
      if (a.dataset.act === 'out') { closeAll(); await Y.signOut(); }
      if (a.dataset.act === 'backup') {
        const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
        const u = URL.createObjectURL(blob), l = document.createElement('a');
        l.href = u; l.download = `이유식식단_${D.todayIso()}.json`; l.click(); setTimeout(() => URL.revokeObjectURL(u), 1000);
      }
    });
  }

  // ---------------- 로그인 · 가입 ----------------
  function showAuth(on) {
    const el = $('#auth');
    el.hidden = !on;
    document.body.classList.toggle('locked', on);
    if (on) setTimeout(() => $('#aid').focus(), 50);
  }
  function wireAuth() {
    let mode = 'in';
    const f = $('#authf'), msg = $('#amsg');
    const paint = () => {
      $$('#auth [data-amode]').forEach(b => b.classList.toggle('on', b.dataset.amode === mode));
      $('#apw2w').hidden = mode !== 'up';
      $('#asub').textContent = mode === 'up' ? '가입하기' : '로그인';
      $('#apw').autocomplete = mode === 'up' ? 'new-password' : 'current-password';
      msg.textContent = '';
    };
    $$('#auth [data-amode]').forEach(b => b.onclick = () => { mode = b.dataset.amode; paint(); });
    paint();
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const id = $('#aid').value.trim(), pw = $('#apw').value, pw2 = $('#apw2').value;
      if (!/^[a-zA-Z0-9_.-]{3,20}$/.test(id)) { msg.textContent = '아이디는 영문·숫자 3~20자로 적어 주세요'; return; }
      if (pw.length < 6) { msg.textContent = '비밀번호는 6자 이상이어야 해요'; return; }
      if (mode === 'up' && pw !== pw2) { msg.textContent = '비밀번호가 서로 달라요'; return; }
      const btn = $('#asub'); btn.disabled = true; msg.textContent = mode === 'up' ? '가입 중…' : '로그인 중…';
      try { mode === 'up' ? await Y.signUp(id, pw) : await Y.signIn(id, pw); f.reset(); }
      catch (err) { msg.textContent = err.message; }
      finally { btn.disabled = false; }
    });
  }

  // ---------------- 이벤트 ----------------
  function wire() {
    $('#plan').addEventListener('click', e => {
      const rc = e.target.closest('[data-recipe]');
      if (rc && !U.paste) { e.preventDefault(); e.stopPropagation(); return openRecipe(rc.dataset.recipe); }
      if (e.target.closest('[data-fixunit]')) return openUnitFix();
      if (U.paste) {
        const sl = e.target.closest('[data-slot]');
        if (sl) { e.preventDefault(); return pasteTo(sl.dataset.slot); }
        const d0 = e.target.closest('[data-day]'); if (d0) { U.selDay = d0.dataset.day; return renderPlan(); }
        const w0 = e.target.closest('[data-mweek]'); if (w0) { U.selDay = D.addDays(U.selDay, +w0.dataset.mweek); return renderPlan(); }
        return;
      }
      const o = e.target.closest('[data-open]'); if (o) return openDetail(o.dataset.open);
      const a = e.target.closest('[data-add]'); if (a) { const [date, meal] = a.dataset.add.split('|'); return openEdit({ date, meal }); }
      const c = e.target.closest('[data-copyweek]'); if (c) return copyWeek(c.dataset.copyweek);
      const d = e.target.closest('[data-day]'); if (d) { U.selDay = d.dataset.day; return renderPlan(); }
      const w = e.target.closest('[data-mweek]'); if (w) { U.selDay = D.addDays(U.selDay, +w.dataset.mweek); return renderPlan(); }
    });
    // 끌어서 옮기기 (PC)
    const plan = $('#plan');
    let dragId = null;
    plan.addEventListener('dragstart', e => {
      const el = e.target.closest('[data-drag]'); if (!el || U.paste) return;
      dragId = el.dataset.drag;
      e.dataTransfer.effectAllowed = 'copyMove';
      try { e.dataTransfer.setData('text/plain', dragId); } catch (err) {}
      setTimeout(() => { document.body.classList.add('dragging'); el.classList.add('drag-src'); }, 0);
    });
    plan.addEventListener('dragend', () => {
      dragId = null; document.body.classList.remove('dragging');
      $$('.drag-src, .dropok, .ins-before, .ins-after', plan).forEach(x => x.classList.remove('drag-src', 'dropok', 'ins-before', 'ins-after'));
    });
    const clearIns = () => $$('.ins-before, .ins-after', plan).forEach(x => x.classList.remove('ins-before', 'ins-after'));
    let dropIdx = null;
    plan.addEventListener('dragover', e => {
      if (!dragId) return;
      const sl = e.target.closest('[data-slot]'); if (!sl) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = (e.altKey || e.ctrlKey || e.metaKey) ? 'copy' : 'move';
      if (!sl.classList.contains('dropok')) { $$('.dropok', plan).forEach(x => x.classList.remove('dropok')); sl.classList.add('dropok'); }
      // 놓일 위치: 마우스 높이보다 위에 있는 메뉴 수
      const items = $$('.mi', sl).filter(x => x.dataset.drag !== dragId);
      let idx = 0;
      for (const it of items) { const r = it.getBoundingClientRect(); if (e.clientY > r.top + r.height / 2) idx++; }
      dropIdx = idx;
      clearIns();
      if (items.length) { if (idx < items.length) items[idx].classList.add('ins-before'); else items[items.length - 1].classList.add('ins-after'); }
    });
    plan.addEventListener('dragleave', e => {
      const sl = e.target.closest('[data-slot]');
      if (sl && !sl.contains(e.relatedTarget)) { sl.classList.remove('dropok'); clearIns(); }
    });
    plan.addEventListener('drop', e => {
      const sl = e.target.closest('[data-slot]'); if (!sl || !dragId) return;
      e.preventDefault();
      const m = findMenu(dragId); const copy = e.altKey || e.ctrlKey || e.metaKey;
      dragId = null; document.body.classList.remove('dragging'); clearIns();
      if (!m) return;
      const [date, meal] = sl.dataset.slot.split('|');
      placeMenu(m, date, meal, dropIdx, copy);
    });
    $('#prevW').onclick = () => { U.weekStart = D.addDays(U.weekStart, -7); renderPlan(); };
    $('#nextW').onclick = () => { U.weekStart = D.addDays(U.weekStart, 7); renderPlan(); };
    $('#todayW').onclick = () => { U.weekStart = thisMon(); U.selDay = D.todayIso(); renderPlan(); };
    $('#addBtn').onclick = () => openEdit({ date: U.mtab === 'plan' && window.innerWidth <= 760 ? U.selDay : D.todayIso() });
    $('#sortBtn').onclick = autoSort;
    const openSide = on => { document.body.classList.toggle('side-open', on); if (on) setTimeout(() => $('#side .x').focus(), 30); };
    $('#fridgeBtn').onclick = () => openSide(!document.body.classList.contains('side-open'));
    $('#sideClose').onclick = () => openSide(false);
    $('#sideBg').onclick = () => openSide(false);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('side-open') && !stack.length && !document.querySelector('.ac.open')) openSide(false); });
    $('#setBtn').onclick = () => ME ? openAccount() : showAuth(true);
    $('#sync').onclick = () => { if (syncState === 'error') doPush(); else if (!ME) showAuth(true); };
    $$('.mtabs [data-mtab]').forEach(b => b.onclick = () => { U.mtab = b.dataset.mtab; $$('.mtabs [data-mtab]').forEach(x => x.classList.toggle('on', x === b)); render(); });
    wireFridge();
    window.addEventListener('focus', () => { if (Date.now() - lastSync > 10000) doPull(); });
    setInterval(() => { if (document.visibilityState === 'visible' && ME && !stack.length) doPull(); }, 30000);
  }

  document.addEventListener('change', e => {
    if (!e.target.matches('[data-toggle-short]')) return;
    U.hideShort = !e.target.checked;
    try { localStorage.setItem('bf_hideShort', U.hideShort ? '1' : '0'); } catch (err) {}
    document.body.classList.toggle('hide-short', U.hideShort);
    $$('[data-toggle-short]').forEach(c => { c.checked = !U.hideShort; });
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Tab' || !(e.isComposing || e.keyCode === 229)) return;
    const t = e.target;
    if (!t.matches || !t.matches('input, textarea') || t.closest('.ings')) return;
    e.preventDefault();
    const back = e.shiftKey;
    const scope = t.closest('.modal, form, aside, #auth') || document.body;
    t.blur();
    setTimeout(() => {
      const f = $$('input, select, textarea, button', scope).filter(x => !x.disabled && x.tabIndex !== -1 && x.offsetParent !== null);
      const i = f.indexOf(t), n = f[back ? i - 1 : i + 1];
      if (n) n.focus();
    }, 0);
  }, true);

  // 숫자 칸(수량 등)에는 숫자만
  document.addEventListener('input', e => {
    const t = e.target;
    if (!t.matches || !t.matches('input[inputmode=decimal], input[inputmode=numeric]') || e.isComposing) return;
    const v = t.value.replace(/[^0-9.,]/g, '').replace(',', '.');
    if (v !== t.value) t.value = v;
  });
  document.addEventListener('compositionend', e => { const t = e.target; if (t.matches && t.matches('input[inputmode=decimal], input[inputmode=numeric]')) t.value = t.value.replace(/[^0-9.,]/g, ''); });

  // 화면 확대/축소 막기 (iOS 사파리는 viewport 설정을 무시해서 제스처를 직접 막는다)
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));
  document.addEventListener('touchmove', e => { if (e.touches.length > 1 && !e.target.closest('.fvstage')) e.preventDefault(); }, { passive: false });
  // 두 번 탭 확대는 CSS touch-action: manipulation 으로 막는다 (빠른 연속 탭이 씹히지 않게)

  // ---------------- 시작 ----------------
  let channel = null;
  // 예시 피드백(당근 스틱) 한 번만 넣기 — 고정 id 라 여러 기기에서 돌아도 하나만 남는다
  function seedNotes() {
    const SEED = 'seed-carrot-stick-1';
    S.recipes = S.recipes || {};
    if (Object.values(S.recipes).some(r => (r.notes || []).some(n => n.id === SEED))) return;
    const target = '당근스틱';
    const menu = D.alive(S.menus).find(m => M.norm(m.name) === target) || D.alive(S.menus).find(m => M.norm(m.name).includes(target));
    const name = menu ? menu.name : '당근 스틱';
    const k = rKey(name), cur = S.recipes[k] || { name, photos: [] };
    if (D.alive(cur.notes || []).some(n => /5분\s*더/.test(n.text))) return; // 이미 같은 내용을 적어 뒀으면 넣지 않음
    const t = Date.parse('2026-11-01T13:25:00+09:00');
    S.recipes[k] = { ...cur, name: cur.name || name, notes: [...(cur.notes || []), { id: SEED, text: '너무 딱딱해서 5분 더 쪘음', at: t, updatedAt: t, by: '' }], updatedAt: D.now() };
    commit();
  }
  async function onUser(u) {
    const was = ME && ME.id;
    ME = u;
    const av = $('#setBtn');
    if (u) {
      av.textContent = Y.userId(u).slice(0, 1).toUpperCase(); av.title = Y.userId(u) + ' · 계정';
      showAuth(false);
      if (was !== u.id) { await doPull(); seedNotes(); if (!channel) channel = Y.subscribe(() => doPull()); }
    } else {
      av.textContent = ''; av.title = '로그인';
      if (channel) { Y.sb.removeChannel(channel); channel = null; }
      setSync('local');
      showAuth(true);
    }
  }

  wire();
  wireAuth();
  render();
  Y.user().then(onUser);
  Y.onAuth((ev, session) => { if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT' || ev === 'INITIAL_SESSION') onUser(session ? session.user : null); });
})();
