// 수파베이스 — 아이디/비밀번호 로그인 + 공용 식단 한 벌(plan 테이블 id=1)
(function (root) {
  const CFG = {
    url: 'https://eubwzdonqosisrcovvou.supabase.co',
    anon: 'sb_publishable_cGUYnHmHd5o6b211oQroQw_PsD-LC7h',
    domain: 'babyfood.app', // 아이디를 이메일 형식으로 바꿀 때 쓰는 가짜 도메인 (메일은 보내지 않음)
  };
  const LS_REV = 'bf_rev';
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };

  const sb = root.supabase.createClient(CFG.url, CFG.anon, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'bf_auth' } });
  const idToEmail = id => String(id).trim().toLowerCase() + '@' + CFG.domain;
  const emailToId = e => String(e || '').split('@')[0];

  function niceErr(e) {
    const m = (e && (e.message || e.error_description)) || String(e);
    if (/Invalid login credentials/i.test(m)) return '아이디나 비밀번호가 맞지 않아요';
    if (/already registered|already exists/i.test(m)) return '이미 있는 아이디예요';
    if (/Password should be at least/i.test(m)) return '비밀번호는 6자 이상이어야 해요';
    if (/Email not confirmed/i.test(m)) return '가입 확인이 아직 안 됐어요 (관리 설정 확인 필요)';
    if (/Failed to fetch|NetworkError/i.test(m)) return '인터넷 연결을 확인해 주세요';
    return m;
  }

  async function signUp(id, pw) {
    const { data, error } = await sb.auth.signUp({ email: idToEmail(id), password: pw, options: { data: { login_id: id } } });
    if (error) throw new Error(niceErr(error));
    if (!data.session) {
      // 메일 확인이 꺼져 있으면 바로 세션이 생긴다. 혹시 없으면 로그인 시도
      const r = await sb.auth.signInWithPassword({ email: idToEmail(id), password: pw });
      if (r.error) throw new Error(niceErr(r.error));
    }
  }
  async function signIn(id, pw) {
    const { error } = await sb.auth.signInWithPassword({ email: idToEmail(id), password: pw });
    if (error) throw new Error(niceErr(error));
  }
  async function signOut() { await sb.auth.signOut(); set(LS_REV, null); }
  async function user() { const { data } = await sb.auth.getSession(); return data.session ? data.session.user : null; }
  const userId = u => (u && (u.user_metadata && u.user_metadata.login_id)) || emailToId(u && u.email);

  async function pull() {
    const { data, error } = await sb.from('plan').select('data, rev').eq('id', 1).maybeSingle();
    if (error) throw new Error(niceErr(error));
    if (!data) return { data: null, rev: 0 };
    set(LS_REV, String(data.rev));
    const d = data.data && data.data.v ? data.data : null;
    return { data: d, rev: data.rev };
  }

  async function push(doc) {
    const rev = Number(get(LS_REV) || 0);
    const { data, error } = await sb.from('plan').update({ data: doc, rev: rev + 1, updated_at: new Date().toISOString() }).eq('id', 1).eq('rev', rev).select('rev');
    if (error) throw new Error(niceErr(error));
    if (!data || !data.length) { const e = new Error('CONFLICT'); e.conflict = true; throw e; }
    set(LS_REV, String(data[0].rev));
  }

  // 다른 사람이 고치면 바로 알림
  function subscribe(onChange) {
    return sb.channel('plan-1')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'plan', filter: 'id=eq.1' }, p => {
        if (p.new && String(p.new.rev) !== get(LS_REV)) onChange();
      })
      .subscribe();
  }

  // 레시피 사진 (Storage 버킷 recipes)
  const BUCKET = 'recipes';
  async function uploadPhoto(blob) {
    const path = `${new Date().toISOString().slice(0, 7)}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}.jpg`;
    const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' });
    if (error) throw new Error(/bucket not found|not found/i.test(error.message) ? '사진 저장 공간이 아직 준비되지 않았어요' : niceErr(error));
    return path;
  }
  const photoUrl = path => sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  async function removePhoto(path) { try { await sb.storage.from(BUCKET).remove([path]); } catch (e) {} }

  root.Sync = { CFG, sb, uploadPhoto, photoUrl, removePhoto, signUp, signIn, signOut, user, userId, pull, push, subscribe, onAuth: cb => sb.auth.onAuthStateChange((ev, s) => cb(ev, s)) };
})(window);
