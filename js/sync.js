// 깃허브 저장소의 data/plan.json 을 공용 저장소로 쓴다 (기기마다 토큰 한 번 입력)
(function (root) {
  const CFG = { owner: 'yoonjintar2-ctrl', repo: 'babyfood', path: 'data/plan.json', branch: 'main' };
  const API = `https://api.github.com/repos/${CFG.owner}/${CFG.repo}/contents/${CFG.path}`;
  const LS_TOKEN = 'bf_token', LS_SHA = 'bf_sha';

  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };

  const enc = s => { const b = new TextEncoder().encode(s); let bin = ''; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(bin); };
  const dec = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0)));

  const token = () => get(LS_TOKEN);
  const headers = () => {
    const h = { Accept: 'application/vnd.github+json' };
    const t = token(); if (t) h.Authorization = 'Bearer ' + t;
    return h;
  };

  async function pull() {
    const r = await fetch(API + '?ref=' + CFG.branch + '&t=' + Date.now(), { headers: headers(), cache: 'no-store' });
    if (r.status === 404) { set(LS_SHA, null); return { data: null, sha: null }; }
    if (!r.ok) throw new Error('불러오기 실패 (' + r.status + ')');
    const j = await r.json();
    set(LS_SHA, j.sha);
    let data = null;
    if (j.content) data = JSON.parse(dec(j.content));
    else if (j.download_url) data = await (await fetch(j.download_url, { cache: 'no-store' })).json();
    return { data, sha: j.sha };
  }

  async function push(data) {
    if (!token()) throw new Error('NO_TOKEN');
    const body = { message: '식단 업데이트', content: enc(JSON.stringify(data, null, 1)), branch: CFG.branch };
    const sha = get(LS_SHA); if (sha) body.sha = sha;
    const r = await fetch(API, { method: 'PUT', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 409 || r.status === 422) { const e = new Error('CONFLICT'); e.conflict = true; throw e; }
    if (r.status === 401 || r.status === 403) throw new Error('토큰이 맞지 않거나 권한이 없어요 (' + r.status + ')');
    if (!r.ok) throw new Error('저장 실패 (' + r.status + ')');
    const j = await r.json();
    set(LS_SHA, j.content && j.content.sha);
  }

  root.Sync = { CFG, pull, push, token, setToken: t => set(LS_TOKEN, t || null), get, set };
})(window);
