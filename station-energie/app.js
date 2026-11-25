/* Station Energie – Gruppen-Ansicht und Leitung.
 * Backend: Supabase (Tabellen rounds/groups, Funktionen siehe supabase/setup.sql).
 */
(() => {
  'use strict';
  const { FACTS, FIELDS, MEASURES, STEPS, BERUFE, KURZ, BERUF_ALLG, SPOTS, LOEST, SCENE_SVG } = window.STATION;
  const CFG = window.STATION_CONFIG || {};
  const POLL_MS = CFG.pollMs || 15000;        // fallback if a live update is missed
  const HEARTBEAT_MS = 5000;
  const STALE_MS = 20000;                     // a tab silent this long is treated as closed
  const GROUP_NOS = [1, 2, 3, 4, 5, 6];

  const app = document.getElementById('app');
  const netEl = document.getElementById('net');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isLeitung = () => location.hash.replace('#', '').toLowerCase() === 'leitung' || /\/leitung\/?$/i.test(location.pathname);
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
  const store = {
    get(s, k) { try { return JSON.parse(s.getItem(k) || 'null'); } catch (e) { return null; } },
    set(s, k, v) { try { if (v == null) s.removeItem(k); else s.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  };

  // ======================================================================
  // Backend (Supabase)
  // ======================================================================
  const configured = CFG.url && CFG.anonKey && !/DEIN-/.test(CFG.url + CFG.anonKey) && window.supabase;
  const sb = configured ? window.supabase.createClient(CFG.url, CFG.anonKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

  const api = {
    async activeRound() {
      const { data, error } = await sb.from('rounds').select('id, profession').eq('active', true).maybeSingle();
      if (error) throw error;
      return data;
    },
    async groups(roundId) {
      const { data, error } = await sb.from('groups').select('group_no, state, updated_at').eq('round_id', roundId).order('group_no');
      if (error) throw error;
      return data || [];
    },
    async rpc(fn, args) {
      const { data, error } = await sb.rpc(fn, args);
      if (error) { const e = new Error(error.message || 'rpc'); e.pg = error; throw e; }
      return data;
    },
    subscribe(onChange) {
      // Live updates. If they fail, the regular poll keeps everything up to date.
      const ch = sb.channel('station-energie')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rounds' }, (p) => onChange('rounds', p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, (p) => onChange('groups', p))
        .subscribe();
      return () => sb.removeChannel(ch);
    }
  };
  const isPinError = (e) => e && e.pg && (e.pg.code === '28000' || /PIN/.test(e.pg.message || ''));

  // ======================================================================
  // Connection note
  // ======================================================================
  let offline = false;
  function setOffline(v) { offline = v; netEl.hidden = !(offline || navigator.onLine === false); }
  window.addEventListener('offline', () => setOffline(true));

  function header(extra) {
    return `<header class="top">
      <div><div class="eyebrow">Station 1 · Energie</div><h1>Die Halle schläft, der Zähler läuft</h1></div>
      ${extra || ''}
    </header>`;
  }
  const footer = () => `<footer><span>myclimate · Skills for Future</span></footer>`;

  // Re-render without losing the cursor in a text field.
  function paint(html) {
    const a = document.activeElement;
    const id = a && a.id && app.contains(a) ? a.id : null;
    const sel = id && 'selectionStart' in a ? [a.selectionStart, a.selectionEnd] : null;
    app.innerHTML = html;
    if (id) {
      const n = document.getElementById(id);
      if (n) { n.focus({ preventScroll: true }); if (sel && n.setSelectionRange) try { n.setSelectionRange(sel[0], sel[1]); } catch (e) { /* number input */ } }
    }
  }

  if (!configured) {
    paint(header() + `<div class="panel"><h2>Noch nicht eingerichtet</h2><p>In der Datei <b>config.js</b> fehlen die Angaben zu Supabase. Siehe Anleitung, Schritt 2.</p></div>` + footer());
    return;
  }

  // ======================================================================
  // GROUP VIEW
  // ======================================================================
  const CLAIMS = 'se-claims';     // localStorage: { token: { roundId, group, seen, S } }
  const MINE = 'se-claim';        // sessionStorage: token of this tab

  const blank = () => ({ step: 0, found: {}, aufgeloest: false, picks: {}, e3: { leck: '', hoer: '' }, locked: {}, extras: false, sort: {}, geprueft: false, experte: '', experteGesendet: false, ueberrascht: null, ueberText: '', notiz: '', notizGesendet: false });

  const G = {
    claim: null,          // { token, roundId, group }
    S: blank(),
    round: null,          // { id, profession }
    taken: new Set(),
    startMsg: '', startMsgInfo: false,
    busy: null,           // group number being claimed
    loadError: false,
    selected: null, lastMiss: null,
    dirty: false, saving: false, retryMs: 2000, retryTimer: null, saveTimer: null
  };

  function claimsAll() { return store.get(localStorage, CLAIMS) || {}; }
  function persistLocal() {
    if (!G.claim) return;
    const all = claimsAll();
    all[G.claim.token] = { roundId: G.claim.roundId, group: G.claim.group, seen: Date.now(), S: G.S };
    // forget very old entries
    for (const [k, v] of Object.entries(all)) if (Date.now() - (v.seen || 0) > 86400000 && k !== G.claim.token) delete all[k];
    store.set(localStorage, CLAIMS, all);
    store.set(sessionStorage, MINE, G.claim.token);
  }
  function forgetClaim() {
    if (G.claim) { const all = claimsAll(); delete all[G.claim.token]; store.set(localStorage, CLAIMS, all); }
    store.set(sessionStorage, MINE, null);
    G.claim = null; G.S = blank(); G.selected = null; G.lastMiss = null; G.dirty = false;
    clearTimeout(G.saveTimer); clearTimeout(G.retryTimer); setOffline(false);
  }
  function restoreClaim() {
    const all = claimsAll();
    let token = store.get(sessionStorage, MINE);
    if (!token || !all[token]) {
      // A tab that was closed (phone browser killed it): take over its claim,
      // but never one that another open tab is still using.
      token = null;
      let best = 0;
      for (const [k, v] of Object.entries(all)) if (Date.now() - (v.seen || 0) > STALE_MS && v.seen > best) { best = v.seen; token = k; }
    }
    if (!token) return;
    const e = all[token];
    G.claim = { token, roundId: e.roundId, group: e.group };
    G.S = Object.assign(blank(), e.S || {});
    persistLocal();
  }
  setInterval(() => { if (G.claim && !isLeitung()) persistLocal(); }, HEARTBEAT_MS);

  // ---------- saving ----------
  function score(S = G.S) { return S.geprueft ? MEASURES.filter(m => S.sort[m.id] === m.f).length : null; }
  function payload() {
    const S = G.S;
    return {
      step: S.step, done: !!S.notizGesendet, found: Object.keys(S.found), aufgeloest: S.aufgeloest,
      picks: Object.fromEntries(Object.keys(S.locked).filter(k => S.picks[k]).map(k => [k, S.picks[k]])),
      locked: S.locked, e3: S.locked.E3 ? S.e3 : null, extras: S.extras,
      sort: S.sort, geprueft: S.geprueft, score: score(),
      experte: S.experteGesendet ? S.experte : '', experteGesendet: S.experteGesendet,
      ueberrascht: S.ueberrascht || null, ueberText: S.ueberrascht === 'anders' ? S.ueberText : '',
      notiz: S.notizGesendet ? S.notiz : '', notizGesendet: S.notizGesendet
    };
  }
  function save(now) {
    persistLocal();
    G.dirty = true;
    clearTimeout(G.saveTimer);
    G.saveTimer = setTimeout(flush, now ? 0 : 500);
  }
  async function flush() {
    if (!G.claim || !G.dirty || G.saving) return;
    G.saving = true; G.dirty = false;
    const c = G.claim;
    try {
      const res = await api.rpc('save_state', { p_round: c.roundId, p_group: c.group, p_token: c.token, p_state: payload() });
      G.saving = false;
      if (G.claim !== c) return;
      if (res === 'gone') { lostClaim(); return; }
      setOffline(false); G.retryMs = 2000;
      if (G.dirty) flush();
    } catch (e) {
      G.saving = false; G.dirty = true;
      setOffline(true);
      clearTimeout(G.retryTimer);
      G.retryTimer = setTimeout(flush, G.retryMs);
      G.retryMs = Math.min(G.retryMs * 2, 20000);
    }
  }
  window.addEventListener('online', () => { setOffline(offline); G.retryMs = 2000; if (G.claim) flush(); refreshGroupView(); });

  // The round is over or the leader released this group.
  async function lostClaim() {
    const oldRound = G.claim && G.claim.roundId;
    forgetClaim();
    let r = null;
    try { r = await api.activeRound(); } catch (e) { /* ignore */ }
    if (r) G.round = r;
    G.startMsgInfo = true;
    G.startMsg = r && r.id !== oldRound ? 'Die Leitung hat eine neue Runde gestartet. Wählt eure Gruppe.' : 'Die Leitung hat eure Gruppe freigegeben. Wählt eure Gruppe.';
    await loadTaken();
    window.scrollTo(0, 0);
    renderGroup();
  }

  async function loadTaken() {
    if (!G.round) return;
    try { const rows = await api.groups(G.round.id); G.taken = new Set(rows.map(r => r.group_no)); G.loadError = false; }
    catch (e) { G.loadError = true; }
  }

  // Called on every live change and by the poll.
  let refreshing = false;
  async function refreshGroupView(evt) {
    if (isLeitung() || refreshing) return;
    refreshing = true;
    try {
      const r = await api.activeRound();
      G.loadError = false;
      const profChanged = !G.round || !r || G.round.profession !== r.profession;
      G.round = r;
      if (G.claim) {
        if (!r || r.id !== G.claim.roundId) { refreshing = false; lostClaim(); return; }
        const del = evt && evt.table === 'groups' && evt.payload && evt.payload.eventType === 'DELETE';
        if (del || !evt) {
          const ok = await api.rpc('check_claim', { p_round: G.claim.roundId, p_group: G.claim.group, p_token: G.claim.token });
          if (!ok) { refreshing = false; lostClaim(); return; }
        }
        setOffline(false);
        if (profChanged) renderGroup();
      } else {
        await loadTaken();
        renderGroup();
      }
    } catch (e) {
      if (!G.claim) { G.loadError = true; renderGroup(); }
      else setOffline(true);
    }
    refreshing = false;
  }

  async function claimGroup(n) {
    if (G.busy) return;
    G.busy = n; G.startMsg = ''; renderGroup();
    const token = uuid();
    try {
      const res = await api.rpc('claim_group', { p_group: n, p_token: token });
      G.busy = null;
      if (res && res.ok) {
        G.claim = { token, roundId: res.round_id, group: n };
        G.S = blank(); G.startMsg = '';
        persistLocal(); save(true);
        window.scrollTo(0, 0);
        renderGroup();
        return;
      }
      G.startMsgInfo = false;
      if (res && res.reason === 'taken') { G.startMsg = 'Diese Gruppe ist schon vergeben. Wählt eine andere.'; G.taken.add(n); }
      else if (res && res.reason === 'no_round') G.startMsg = 'Die Leitung hat noch keine Runde gestartet. Wartet kurz.';
      else G.startMsg = 'Das hat nicht geklappt. Versucht es nochmals.';
      await refreshGroupView();
      renderGroup();
    } catch (e) {
      G.busy = null; G.startMsgInfo = false;
      G.startMsg = 'Keine Verbindung. Prüft das Internet und versucht es nochmals.';
      renderGroup();
    }
  }

  // ---------- group rendering ----------
  function stepBar() {
    const S = G.S;
    return `<div class="steps" aria-label="Fortschritt">${STEPS.map((s, i) =>
      `<div class="step ${(i < S.step || (S.step === STEPS.length - 1 && S.notizGesendet)) ? 'done' : i === S.step ? 'now' : ''}"${i === S.step ? ' aria-current="step"' : ''}>${i + 1} · ${s}</div>`).join('')}</div>`;
  }

  function renderGroup() {
    if (isLeitung()) return;
    if (!G.claim) { renderStart(); return; }
    const S = G.S;
    const parts = [header(`<span class="chip">Gruppe ${G.claim.group}</span>`), stepBar()];
    if (S.step === 0) parts.push(viewSearch());
    if (S.step === 1) parts.push(viewFacts());
    if (S.step === 2) parts.push(viewSort());
    if (S.step === 3) parts.push(viewExpert());
    if (S.step === 4) parts.push(viewNote());
    parts.push(footer());
    paint(parts.join(''));
  }

  function renderStart() {
    const btns = GROUP_NOS.map(n => {
      const taken = G.taken.has(n);
      const busy = G.busy === n;
      return taken
        ? `<button class="btn" aria-disabled="true" data-act="taken" data-g="${n}" aria-label="Gruppe ${n}, vergeben">Gruppe ${n}<span class="taken">vergeben</span></button>`
        : `<button class="btn" data-act="group" data-g="${n}" ${G.busy || !G.round ? 'disabled' : ''}>${busy ? 'Moment …' : 'Gruppe ' + n}</button>`;
    }).join('');
    paint(header() + `
      <div class="panel">
        ${G.startMsg ? `<p class="msg ${G.startMsgInfo ? 'info' : ''}" role="alert">${esc(G.startMsg)}</p>` : ''}
        ${G.loadError ? `<p class="msg" role="alert">Keine Verbindung. Prüft das Internet. Die Seite versucht es automatisch wieder.</p>` : ''}
        <h2>Welche Gruppe seid ihr?</h2>
        <p class="muted">Ihr bearbeitet diese Station als Gruppe gemeinsam auf einem Handy oder Laptop. Wählt eure Gruppe nur auf einem Gerät.</p>
        <div class="groups six">${btns}</div>
      </div>
      <div class="panel" style="background:var(--tint)">
        <h3>Warum geht euch das etwas an?</h3>
        <p>Die Industrie macht ca. 22 % der Treibhausgase der Schweiz. Bis 2050 muss sie ihre Emissionen um 90 % senken, verglichen mit 1990. So steht es im Klimagesetz. 2050 seid ihr mitten im Berufsleben. Die Anlagen, die ihr heute plant, baut, programmiert und wartet, laufen dann noch.</p>
        <p><b>Viel Wärme in der Industrie kommt noch aus Öl und Gas – das macht CO₂. Wer Energie spart und Abwärme nutzt, braucht weniger davon.</b></p>
        <p class="small muted">Quellen: BAFU Treibhausgasinventar; Klima- und Innovationsgesetz (KlG), Art. 4</p>
      </div>
      <div class="panel">
        <h3>So funktioniert die Station</h3>
        <p>1 Im Bild Energieverluste suchen · 2 Schätzen, dann Karte umdrehen · 3 Lösungen sortieren · 4 Expertenfrage beantworten · 5 Notiz schreiben.</p>
      </div>` + footer());
  }

  function sceneMarks() {
    const S = G.S;
    let out = '';
    if (S.aufgeloest) {
      SPOTS.forEach(sp => {
        if (S.found[sp.id]) return;
        sp.shapes.forEach(sh => {
          out += sh[0] === 'poly' ? `<polygon class="missed-area" points="${sh[1]}"></polygon>` : `<rect class="missed-area" x="${sh[1]}" y="${sh[2]}" width="${sh[3]}" height="${sh[4]}" rx="12"></rect>`;
        });
        out += `<circle class="missed-badge" cx="${sp.m[0]}" cy="${sp.m[1]}" r="34"></circle><text class="found-txt" x="${sp.m[0]}" y="${sp.m[1] + 14}" text-anchor="middle">?</text>`;
      });
    }
    Object.values(S.found).forEach(p => {
      out += `<circle class="found-dot" cx="${p[0]}" cy="${p[1]}" r="34"></circle><path d="M${p[0] - 16} ${p[1]} l11 12 l22 -24" fill="none" stroke="#ffffff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"></path>`;
    });
    if (G.lastMiss && !S.aufgeloest) out += `<circle class="miss-dot" cx="${G.lastMiss[0]}" cy="${G.lastMiss[1]}" r="38"></circle>`;
    return out;
  }

  function viewSearch() {
    const S = G.S;
    const n = Object.keys(S.found).length;
    const list = S.aufgeloest ? `<ul class="found-list">${SPOTS.map(sp => S.found[sp.id]
      ? `<li class="ok"><span class="k">Gefunden</span><span>${esc(sp.label)}</span></li>`
      : `<li class="miss"><span class="k">Übersehen</span><span>${esc(sp.label)}</span></li>`).join('')}</ul>` : '';
    return `<section class="panel">
      <div class="eyebrow">Schritt 1 · Suchen</div>
      <h2>Wo geht Energie verloren?</h2>
      <p>Es ist Samstag. Niemand arbeitet. Trotzdem läuft der Stromzähler. Tippt im Bild auf alle Stellen, wo Energie verloren geht. <b>2 Minuten.</b></p>
      <div class="scene-box"><svg id="scene" data-act="scene" viewBox="0 0 2000 865" role="img" aria-label="Werkhalle am Samstag ohne Menschen. Tippt auf Stellen, wo Energie verloren geht." style="display:block;width:100%;height:auto;font-family:Arial,Helvetica,sans-serif;">${SCENE_SVG}${sceneMarks()}</svg></div>
      <div class="row" style="justify-content:space-between">
        <span class="foundcount" aria-live="polite">${S.aufgeloest ? n + ' von ' + SPOTS.length + ' gefunden' : 'Gefunden: ' + n}</span>
        <span class="small muted">${S.aufgeloest ? 'Blau = übersehen.' : (G.lastMiss ? 'Hier geht keine Energie verloren. Sucht weiter.' : 'Tippt auf eine Stelle im Bild.')}</span>
      </div>
      ${list}
      <div class="row end">
        ${S.aufgeloest ? `<button class="btn primary" data-act="next">Weiter zu den Karten</button>` : `<button class="btn primary" data-act="reveal">Fertig: Auflösung zeigen</button>`}
      </div>
    </section>`;
  }

  function factCard(f) {
    const S = G.S;
    const locked = !!S.locked[f.id];
    const pick = S.picks[f.id];
    let front;
    if (f.numbers) {
      front = `<div class="nums">
        <label for="e3-leck">Verlust durch Lecks (%)<input id="e3-leck" type="number" inputmode="numeric" min="0" max="100" value="${esc(S.e3.leck)}" data-in="leck" ${locked ? 'disabled' : ''}></label>
        <label for="e3-hoer">Lecks, die man hört (%)<input id="e3-hoer" type="number" inputmode="numeric" min="0" max="100" value="${esc(S.e3.hoer)}" data-in="hoer" ${locked ? 'disabled' : ''}></label>
      </div>`;
    } else {
      front = `<div class="opts" role="group" aria-label="Antworten">${Object.entries(f.opts).map(([k, v]) =>
        `<button class="opt" data-act="pick" data-f="${f.id}" data-o="${k}" aria-pressed="${pick === k}" ${locked ? 'disabled' : ''}><b>${k}</b><span>${esc(v)}</span></button>`).join('')}</div>`;
    }
    const canLock = f.numbers ? (S.e3.leck !== '' && S.e3.hoer !== '') : !!pick;
    let verdict = '';
    if (locked) {
      if (f.numbers) verdict = `<span class="verdict ok">Eure Schätzung: ${esc(S.e3.leck)} % Verlust · ${esc(S.e3.hoer)} % hörbar</span>`;
      else verdict = pick === f.right ? `<span class="verdict ok">Richtig geschätzt</span>` : `<span class="verdict off">Ihr habt ${esc(pick)} gewählt</span>`;
    }
    return `<article class="card ${locked ? 'flipped' : ''}" aria-label="Karte ${f.id}">
      <div class="card-inner">
        <div class="face front" ${locked ? 'aria-hidden="true"' : ''}>
          <span class="badge ${f.extra ? 'extra' : ''}">${f.id}${f.extra ? ' · Zusatzkarte' : ''}</span>
          <h2>${esc(f.q)}</h2>
          ${front}
          <div class="row end"><button class="btn primary" data-act="lock" data-f="${f.id}" ${canLock && !locked ? '' : 'disabled'}>Antwort festlegen</button></div>
        </div>
        <div class="face back" ${locked ? '' : 'aria-hidden="true"'}>
          <span class="badge ${f.extra ? 'extra' : ''}">${f.id} · Antwort</span>
          ${verdict}
          <div class="answer">${esc(f.answer)}</div>
          ${f.text.map(t => `<p>${t}</p>`).join('')}
          <p class="src">${esc(f.src)}</p>
        </div>
      </div>
    </article>`;
  }

  function viewFacts() {
    const S = G.S;
    const main = FACTS.filter(f => !f.extra);
    const extra = FACTS.filter(f => f.extra);
    const mainDone = main.every(f => S.locked[f.id]);
    return `<section style="display:flex;flex-direction:column;gap:16px">
      <div><div class="eyebrow">Schritt 2 · Schätzen und Entdecken</div>
      <p>Zuerst gemeinsam schätzen und die Antwort festlegen. Erst dann dreht sich die Karte um.</p></div>
      ${main.map(factCard).join('')}
      ${mainDone && !S.extras ? `<div class="panel"><h3>Schnell fertig?</h3><p>Zwei Zusatzkarten warten auf euch.</p><div class="row"><button class="btn" data-act="extras">Zusatzkarten zeigen</button></div></div>` : ''}
      ${S.extras ? extra.map(factCard).join('') : ''}
      <div class="row end"><button class="btn" data-act="back">Zurück</button><button class="btn primary" data-act="next" ${mainDone ? '' : 'disabled'}>Weiter zum Sortieren</button></div>
    </section>`;
  }

  function loestText(m) { return (LOEST[m.id] || []).map(id => (SPOTS.find(sp => sp.id === id) || {}).label).filter(Boolean).join(' · '); }
  function mcard(m) {
    const S = G.S;
    const placed = S.sort[m.id];
    let cls = '', extra = '';
    if (S.geprueft && placed) {
      const ok = placed === m.f;
      cls = ok ? 'ok' : 'off';
      const fname = FIELDS.find(x => x.id === m.f).name;
      extra = `<span class="tag">${ok ? 'Richtig' : 'Besser: ' + esc(fname)}</span><span class="why">${esc(m.why)}</span>${loestText(m) ? `<span class="why"><b>Löst im Bild:</b> ${esc(loestText(m))}</span>` : ''}`;
    }
    return `<button class="mcard ${cls}" data-act="card" data-m="${m.id}" aria-pressed="${G.selected === m.id}" ${S.geprueft ? 'disabled' : ''}>${esc(m.t)}${extra}</button>`;
  }

  function viewSort() {
    const S = G.S;
    const unplaced = MEASURES.filter(m => !S.sort[m.id]);
    const sc = score();
    const sel = G.selected;
    return `<section style="display:flex;flex-direction:column;gap:16px">
      <div><div class="eyebrow">Schritt 3 · Lösungen sortieren</div><h2>4 Wege zu weniger CO₂</h2>
      <p>${S.geprueft ? 'Hier seht ihr die Auflösung.' : 'Tippt unten eine Lösung an, dann oben ein Feld. Zum Zurücklegen die Karte im Feld nochmals antippen.'}</p></div>
      <div class="fields">${FIELDS.map(f => `
        <div class="field ${sel ? 'target' : ''}" ${sel ? `role="button" tabindex="0" data-act="field" data-field="${f.id}" aria-label="In ${esc(f.name)} legen"` : ''}>
          <h3>${esc(f.name)}</h3><span class="hint">${esc(f.hint)}</span>
          ${MEASURES.filter(m => S.sort[m.id] === f.id).map(m => mcard(m)).join('')}
        </div>`).join('')}</div>
      ${unplaced.length ? `<div class="pile">${unplaced.map(m => mcard(m)).join('')}</div>` : ''}
      ${S.geprueft ? `<div class="panel"><h3>${sc} von 8 im gleichen Feld wie die Auflösung</h3><p class="small muted">Anders sortiert, aber gut begründet? Das zählt auch. Sagt es im Debriefing.</p></div>` : ''}
      <div class="row end">
        <button class="btn" data-act="back">Zurück</button>
        ${S.geprueft ? `<button class="btn primary" data-act="next">Weiter</button>` : `<button class="btn primary" data-act="check" ${unplaced.length ? 'disabled' : ''}>Auflösung zeigen</button>`}
      </div>
    </section>`;
  }

  function textBox(key, sentKey, label, hint) {
    const S = G.S;
    const sent = S[sentKey];
    return `<label for="${key}" class="lbl">${esc(label)}</label>
      ${hint ? `<p class="small muted" id="${key}-hint">${esc(hint)}</p>` : ''}
      <textarea id="${key}" data-in="${key}" maxlength="500" ${hint ? `aria-describedby="${key}-hint"` : ''} ${sent ? 'readonly' : ''}>${esc(S[key])}</textarea>
      <div class="row end">${sent
        ? `<span class="sent" role="status">Gesendet ✓</span><button class="btn small" data-act="edit" data-k="${sentKey}">Ändern</button>`
        : `<button class="btn ${key === 'notiz' ? 'accent' : 'primary'}" data-act="send" data-k="${sentKey}" data-t="${key}" ${S[key].trim() ? '' : 'disabled'}>Senden</button>`}</div>`;
  }

  function viewExpert() {
    const p = G.round && G.round.profession;
    const b = BERUFE[p] || BERUF_ALLG;
    return `<section style="display:flex;flex-direction:column;gap:16px">
      <div class="panel">
        <div class="eyebrow">Schritt 4 · Expertenkarte${BERUFE[p] ? ' · ' + esc(b.name) : ''}</div>
        <h2>${esc(b.intro)}</h2>
        <p>${esc(b.q)}</p>
        ${textBox('experte', 'experteGesendet', 'Eure Antwort', '2–3 Stichworte, z. B. ' + b.bsp)}
      </div>
      <div class="row end"><button class="btn" data-act="back">Zurück</button><button class="btn primary" data-act="next">Weiter</button></div>
    </section>`;
  }

  function viewNote() {
    const S = G.S;
    return `<section style="display:flex;flex-direction:column;gap:16px">
      <div class="panel">
        <h2>Was hat euch am meisten überrascht?</h2>
        <p class="small muted">Tippt eine Karte an – oder schreibt etwas anderes.</p>
        <div class="opts" role="group" aria-label="Überraschung">${FACTS.filter(f => !f.extra && S.locked[f.id]).map(f => `<button class="opt" data-act="surp" data-f="${f.id}" aria-pressed="${S.ueberrascht === f.id}"><b>${esc(f.id)}</b><span>${esc(KURZ[f.id] || f.q)}</span></button>`).join('')}<button class="opt" data-act="surp" data-f="anders" aria-pressed="${S.ueberrascht === 'anders'}"><b>?</b><span>Etwas anderes</span></button></div>
        ${S.ueberrascht === 'anders' ? `<label for="ueberText" class="small muted">Was hat euch überrascht? Ein Satz.</label><textarea id="ueberText" data-in="ueberText" maxlength="200" style="min-height:70px">${esc(S.ueberText)}</textarea>` : ''}
      </div>
      <div class="note-box">
        <div class="eyebrow" style="color:var(--magenta)">Schritt 5 · Eure Notiz</div>
        <h2>Das schauen wir uns in unseren Lehrbetrieben an:</h2>
        ${textBox('notiz', 'notizGesendet', 'Eure Notiz', 'Schreibt eine konkrete Sache: Was? Wo? Wann?')}
        ${S.notizGesendet ? '<div class="status">Super! Hier ist eure Wow-Karte:</div>' : ''}
      </div>
      ${S.notizGesendet ? `<div class="wow reveal">
        <div class="eyebrow" style="color:inherit">Wow-Karte</div>
        <h2>Viele dieser Massnahmen kosten am Ende nichts – sie sparen Geld.</h2>
        <p>Project Drawdown rechnet für jede Klimalösung die Kosten pro Tonne CO₂. Bei LED und Wärmepumpen ist die Zahl negativ: <b>Man spart Geld und CO₂ gleichzeitig.</b></p>
        <p class="small">Quelle: Project Drawdown Explorer</p>
      </div>` : `<div class="locked"><div class="eyebrow">Wow-Karte</div><p>Sendet zuerst eure Notiz. Dann bekommt ihr die Wow-Karte.</p></div>`}
      ${S.notizGesendet ? endPanel() : ''}
      <div class="row"><button class="btn" data-act="back">Zurück</button></div>
    </section>`;
  }

  function endPanel() {
    const S = G.S;
    const found = Object.keys(S.found).length;
    const sc = score();
    return `<div class="end-panel">
        <div class="end-check" aria-hidden="true"><svg viewBox="0 0 48 48" width="48" height="48"><circle cx="24" cy="24" r="22" fill="currentColor"></circle><path d="M14 25 l7 7 l13 -15" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"></path></svg></div>
        <div class="eyebrow">Station Energie</div>
        <h2>Geschafft!</h2>
        <ul class="end-list">
          <li><b>${found} von ${SPOTS.length}</b> Energieverluste im Bild gefunden</li>
          ${sc == null ? '' : `<li><b>${sc} von ${MEASURES.length}</b> Lösungen im richtigen Feld</li>`}
        </ul>
        <div class="end-next"><b>Eure Antworten sind bei der Leitung.</b> Wartet auf das Zeichen der Leitung.</div>
      </div>`;
  }

  // ---------- group events ----------
  function groupClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const act = el.dataset.act;
    const S = G.S;
    if (act === 'group') { claimGroup(Number(el.dataset.g)); return; }
    if (act === 'taken') { G.startMsgInfo = false; G.startMsg = 'Diese Gruppe ist schon vergeben. Wählt eine andere.'; renderGroup(); return; }
    if (!G.claim) return;
    if (act === 'spot' || act === 'scene') {
      if (S.aufgeloest) return;
      const svg = el.closest('svg');
      const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      const p = pt.matrixTransform(svg.getScreenCTM().inverse());
      const xy = [Math.round(p.x), Math.round(p.y)];
      if (act === 'spot') { const id = el.dataset.spot; if (!S.found[id]) { S.found[id] = xy; save(); } G.lastMiss = null; }
      else G.lastMiss = xy;
      const y = window.scrollY; renderGroup(); window.scrollTo(0, y); return;
    }
    if (act === 'reveal') { S.aufgeloest = true; G.lastMiss = null; save(true); renderGroup(); return; }
    if (act === 'next') { S.step = Math.min(STEPS.length - 1, S.step + 1); G.selected = null; G.lastMiss = null; save(true); renderGroup(); window.scrollTo(0, 0); return; }
    if (act === 'back') { S.step = Math.max(0, S.step - 1); G.selected = null; save(true); renderGroup(); window.scrollTo(0, 0); return; }
    if (act === 'pick') { S.picks[el.dataset.f] = el.dataset.o; persistLocal(); renderGroup(); return; }
    if (act === 'lock') { S.locked[el.dataset.f] = true; save(true); renderGroup(); return; }
    if (act === 'extras') { S.extras = true; save(); renderGroup(); return; }
    if (act === 'card') {
      const id = el.dataset.m;
      // A card is selected and they tap a card that already lies in a field:
      // put the selected card into that field (they meant the field).
      if (S.sort[id] && G.selected && G.selected !== id) { S.sort[G.selected] = S.sort[id]; G.selected = null; save(); }
      else if (S.sort[id]) { delete S.sort[id]; G.selected = null; save(); }
      else G.selected = G.selected === id ? null : id;
      renderGroup(); return;
    }
    if (act === 'field') { if (G.selected) { S.sort[G.selected] = el.dataset.field; G.selected = null; save(); renderGroup(); } return; }
    if (act === 'check') { S.geprueft = true; save(true); renderGroup(); return; }
    if (act === 'send') { if (S[el.dataset.t].trim()) { S[el.dataset.k] = true; save(true); renderGroup(); } return; }
    if (act === 'edit') { S[el.dataset.k] = false; save(true); renderGroup(); const t = document.getElementById(el.dataset.k === 'notizGesendet' ? 'notiz' : 'experte'); if (t) t.focus(); return; }
    if (act === 'surp') { S.ueberrascht = el.dataset.f; save(true); renderGroup(); return; }
  }
  function groupInput(e) {
    const k = e.target.dataset.in;
    if (!k || !G.claim) return;
    const S = G.S;
    if (k === 'notiz' || k === 'experte') {
      S[k] = e.target.value; persistLocal();
      const b = app.querySelector(`[data-act="send"][data-t="${k}"]`); if (b) b.disabled = !S[k].trim();
      return;
    }
    if (k === 'ueberText') { S.ueberText = e.target.value; save(); return; }
    S.e3[k] = e.target.value.replace(/[^0-9]/g, '').slice(0, 3);
    persistLocal();
    const b = app.querySelector('[data-act="lock"][data-f="E3"]');
    if (b) b.disabled = !(S.e3.leck !== '' && S.e3.hoer !== '');
  }

  // ======================================================================
  // LEITUNG VIEW
  // ======================================================================
  const PINKEY = 'se-pin';
  const L = { pin: store.get(sessionStorage, PINKEY), round: null, docs: {}, rows: [], status: '', pinMsg: '', confirmReset: false, confirmRelease: null, present: false, loaded: false, error: false, checking: false };

  async function loadLeitung() {
    try {
      const r = await api.activeRound();
      const rows = r ? await api.groups(r.id) : [];
      L.round = r; L.rows = rows; L.docs = {};
      rows.forEach(x => { L.docs[x.group_no] = Object.assign({ gruppe: x.group_no, updatedAt: x.updated_at }, x.state || {}); });
      L.loaded = true; L.error = false; setOffline(false);
    } catch (e) { L.error = true; setOffline(true); }
    renderLeitung();
  }

  function ago(ts) {
    if (!ts) return '';
    const s = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
    if (s < 60) return 'gerade aktiv';
    const m = Math.round(s / 60);
    return m < 60 ? `vor ${m} Min.` : `vor ${Math.round(m / 60)} Std.`;
  }

  function renderPin() {
    paint(header(`<span class="chip">Leitung</span>`) + `
      <form class="panel pin" id="pinform" autocomplete="off">
        <h2>PIN eingeben</h2>
        <label for="pin" class="lbl">PIN der Leitung</label>
        <input id="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="12" required>
        ${L.pinMsg ? `<p class="msg" role="alert">${esc(L.pinMsg)}</p>` : ''}
        <button class="btn primary" type="submit" ${L.checking ? 'disabled' : ''}>${L.checking ? 'Moment …' : 'Öffnen'}</button>
      </form>` + footer());
    const i = document.getElementById('pin'); if (i) i.focus();
  }

  function renderLeitung() {
    if (!isLeitung()) return;
    if (!L.pin) { renderPin(); return; }
    document.body.classList.toggle('present', L.present);
    const docs = GROUP_NOS.map(g => L.docs[g]).filter(Boolean);
    const prof = L.round && L.round.profession;

    const top = `<div class="lead-top">
      <span class="chip">Leitung${prof && BERUFE[prof] ? ' · ' + esc(BERUFE[prof].name) : ''}</span>
      <button class="btn small" data-act="present" aria-pressed="${L.present}">${L.present ? 'Steuerung zeigen' : 'Präsentieren'}</button>
    </div>`;

    const berufPicker = `<div class="panel ctrl"><h2>Beruf dieser Runde</h2><p class="small muted">${BERUFE[prof] ? 'Die Gruppen sehen die Expertenkarte für ' + esc(BERUFE[prof].name) + '.' : 'Noch kein Beruf gewählt. Die Gruppen sehen eine allgemeine Expertenkarte.'}</p><div class="groups">${Object.entries(BERUFE).map(([k, v]) => `<button class="btn ${k === prof ? 'primary' : ''}" data-act="beruf" data-b="${k}" aria-pressed="${k === prof}">${esc(v.name)}</button>`).join('')}</div></div>`;

    const statusCards = GROUP_NOS.map(g => {
      const d = L.docs[g];
      if (!d) return `<div class="gstat"><h3>Gruppe ${g}</h3><span class="st muted">frei</span></div>`;
      const st = d.done ? 'Fertig ✓' : `Schritt ${(d.step || 0) + 1} · ${STEPS[d.step || 0]}`;
      const rel = L.confirmRelease === g
        ? `<span class="small">Antworten dieser Gruppe löschen?</span><div class="row"><button class="btn small" data-act="rel-no">Nein</button><button class="btn small danger fill" data-act="rel-yes" data-g="${g}">Ja, freigeben</button></div>`
        : `<button class="btn small danger" data-act="release" data-g="${g}">Gruppe freigeben</button>`;
      return `<div class="gstat ${d.done ? 'done' : 'on'}"><h3>Gruppe ${g}</h3><span class="st"><b>${esc(st)}</b></span><span class="ago">${esc(ago(d.updatedAt))}</span><div class="ctrl">${rel}</div></div>`;
    }).join('');
    const statusPanel = `<div class="panel"><h2>Gruppen</h2><div class="status-grid">${statusCards}</div></div>`;

    let body;
    if (!docs.length) {
      body = `<div class="panel"><h2>Noch keine Gruppe</h2><p>Sobald eine Gruppe ihre Nummer wählt, erscheint sie hier. Die Ansicht aktualisiert sich von selbst.</p></div>`;
    } else {
      const has = (d, k) => Array.isArray(d.found) && d.found.includes(k);
      const choice = FACTS.filter(f => !f.numbers).map(f => {
        const rows = Object.entries(f.opts).map(([k, v]) => {
          const who = docs.filter(d => d.locked && d.locked[f.id] && d.picks && d.picks[f.id] === k).map(d => 'G' + d.gruppe);
          const pct = docs.length ? Math.round(who.length / docs.length * 100) : 0;
          return `<div class="bar-row ${k === f.right ? 'right' : ''}"><span class="letter">${k}</span><div class="bar" title="${esc(v)}"><span style="width:${pct}%"></span></div><span class="who">${esc(v)}${k === f.right ? ' ✓' : ''} · ${who.length ? who.join(', ') : '–'}</span></div>`;
        }).join('');
        return `<div class="q"><h3>${f.id}${f.extra ? ' (Zusatz)' : ''} · ${esc(f.q)}</h3>${rows}</div>`;
      }).join('');
      const tableRows = GROUP_NOS.filter(g => L.docs[g]).map(g => {
        const d = L.docs[g];
        const e3 = d.locked && d.locked.E3 && d.e3 ? d.e3 : null;
        return `<tr><td>Gruppe ${g}</td><td class="num">${Array.isArray(d.found) ? d.found.length : 0} / 8</td><td class="num">${e3 ? esc(e3.leck) + ' %' : '–'}</td><td class="num">${e3 ? esc(e3.hoer) + ' %' : '–'}</td><td class="num">${d.score == null ? '–' : esc(d.score) + ' / 8'}</td></tr>`;
      }).join('');
      const exps = docs.filter(d => d.experteGesendet && d.experte).map(d => `<div class="note"><span class="who">Gruppe ${esc(d.gruppe)}</span><span>${esc(d.experte)}</span></div>`).join('');
      const notes = docs.filter(d => d.notizGesendet && d.notiz).map(d => `<div class="note"><span class="who">Gruppe ${esc(d.gruppe)}</span><span>${esc(d.notiz)}</span></div>`).join('');
      const surprise = (() => {
        const rows = FACTS.map(f => ({ f, who: docs.filter(d => d.ueberrascht === f.id).map(d => 'G' + d.gruppe) })).filter(r => r.who.length).sort((a, b) => b.who.length - a.who.length);
        const own = docs.filter(d => d.ueberrascht === 'anders');
        const cards = rows.map(r => `<div class="q"><h3>${esc(r.f.id)} · ${r.who.length}× · ${esc(r.who.join(', '))}</h3><p class="small">${esc(KURZ[r.f.id] || r.f.q)}</p></div>`).join('');
        const texts = own.length ? `<div class="q"><h3>Etwas anderes · ${own.length}×</h3><div class="notes">${own.map(d => `<div class="note"><span class="who">Gruppe ${esc(d.gruppe)}</span><span>${esc(d.ueberText || '…')}</span></div>`).join('')}</div></div>` : '';
        return (cards + texts) || '<p class="muted">Noch keine Auswahl.</p>';
      })();
      body = `
        <div class="panel"><h2>Suchbild</h2><p class="small muted">Welche Stellen haben die Gruppen gefunden? Kurze Balken = oft übersehen.</p>${SPOTS.map(sp => {
          const who = docs.filter(d => has(d, sp.id)).map(d => 'G' + d.gruppe);
          const pct = docs.length ? Math.round(who.length / docs.length * 100) : 0;
          return `<div class="bar-row right"><span class="letter">${who.length}</span><div class="bar" title="${esc(sp.label)}"><span style="width:${pct}%"></span></div><span class="who">${esc(sp.label)} · ${who.length ? who.join(', ') : '–'}</span></div>`;
        }).join('')}</div>
        <div class="panel"><h2>Schätzungen</h2><p class="small muted">Grün = richtige Antwort. Gute Einstiegsfrage: «Warum habt ihr so geschätzt?»</p>${choice}</div>
        <div class="panel"><h2>Überblick pro Gruppe</h2>
          <div class="scroll"><table><thead><tr><th>Gruppe</th><th class="num">Gefunden</th><th class="num">E3 Verlust</th><th class="num">E3 hörbar</th><th class="num">Sortiert</th></tr></thead><tbody>${tableRows}</tbody></table></div>
          <p class="small muted">Gefunden = Stellen im Suchbild (von 8). Richtig bei E3: 5–20 % Verlust (am Wochenende oft 100 %), nur ca. 20–30 % hörbar.</p>
        </div>
        <div class="panel"><h2>Expertenkarte: Lösungen der Gruppen</h2><p class="small muted">Lasst zwei Gruppen ihre Lösungen vergleichen: «Welche Idee ist besser – und warum?»</p>${exps ? `<div class="notes">${exps}</div>` : '<p class="muted">Noch keine Antworten.</p>'}</div>
        <div class="panel"><h2>Das hat uns am meisten überrascht</h2><p class="small muted">Gute Einstiegsfrage: «Warum hat euch das überrascht?»</p>${surprise}</div>
        <div class="panel"><h2>Notizen: Das schauen wir uns in unseren Lehrbetrieben an</h2>${notes ? `<div class="notes">${notes}</div>` : '<p class="muted">Noch keine Notizen.</p>'}</div>`;
    }

    const reset = L.confirmReset
      ? `<div class="panel ctrl" style="border:3px solid var(--off)"><p><b>Alle Antworten löschen?</b> Das kann man nicht rückgängig machen.</p><div class="row"><button class="btn" data-act="reset-no">Abbrechen</button><button class="btn danger fill" data-act="reset-yes">Ja, neue Runde starten</button></div></div>`
      : `<div class="row end ctrl"><button class="btn" data-act="reset">Neue Runde starten</button></div>`;
    const err = L.error ? `<p class="msg ctrl" role="alert">Keine Verbindung zur Datenbank. Die Seite versucht es automatisch wieder.</p>` : '';
    const stat = L.status ? `<p class="msg info ctrl" role="status">${esc(L.status)}</p>` : '';

    paint(header(top) + err + stat + berufPicker + `<div class="dash" style="display:flex;flex-direction:column;gap:20px">${statusPanel}${body}</div>` + reset + footer());
  }

  async function leitungAction(fn, args, okMsg) {
    try {
      await api.rpc(fn, Object.assign({ p_pin: L.pin }, args));
      L.status = okMsg;
    } catch (e) {
      if (isPinError(e)) { L.pin = null; store.set(sessionStorage, PINKEY, null); L.pinMsg = 'Der PIN ist nicht mehr gültig. Bitte neu eingeben.'; }
      else L.status = 'Das hat nicht geklappt. Prüft das Internet und versucht es nochmals.';
    }
    await loadLeitung();
  }

  function leitungClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const act = el.dataset.act;
    if (act === 'present') { L.present = !L.present; L.confirmReset = false; L.confirmRelease = null; renderLeitung(); window.scrollTo(0, 0); return; }
    if (act === 'beruf') { const b = el.dataset.b; leitungAction('leitung_set_profession', { p_profession: b }, 'Beruf gespeichert: ' + BERUFE[b].name + '.'); return; }
    if (act === 'release') { L.confirmRelease = Number(el.dataset.g); renderLeitung(); return; }
    if (act === 'rel-no') { L.confirmRelease = null; renderLeitung(); return; }
    if (act === 'rel-yes') { const g = Number(el.dataset.g); L.confirmRelease = null; leitungAction('leitung_release', { p_group: g }, `Gruppe ${g} ist wieder frei. Sie kann auf einem anderen Gerät neu starten.`); return; }
    if (act === 'reset') { L.confirmReset = true; renderLeitung(); return; }
    if (act === 'reset-no') { L.confirmReset = false; renderLeitung(); return; }
    if (act === 'reset-yes') { L.confirmReset = false; leitungAction('leitung_new_round', {}, 'Neue Runde gestartet. Alle Antworten sind gelöscht. Die Geräte der Gruppen gehen zum Start zurück.'); return; }
  }

  async function pinSubmit(e) {
    e.preventDefault();
    const v = (document.getElementById('pin') || {}).value || '';
    L.checking = true; L.pinMsg = ''; renderPin();
    try {
      const ok = await api.rpc('leitung_check', { p_pin: v });
      L.checking = false;
      if (ok) { L.pin = v; store.set(sessionStorage, PINKEY, v); await loadLeitung(); return; }
      L.pinMsg = 'Falscher PIN.';
    } catch (err) { L.checking = false; L.pinMsg = 'Keine Verbindung. Versucht es nochmals.'; }
    renderPin();
  }

  // ======================================================================
  // Wiring
  // ======================================================================
  app.addEventListener('click', (e) => (isLeitung() ? leitungClick(e) : groupClick(e)));
  app.addEventListener('input', (e) => { if (!isLeitung()) groupInput(e); });
  app.addEventListener('submit', (e) => { if (isLeitung()) pinSubmit(e); });
  app.addEventListener('keydown', (e) => {
    const el = e.target.closest('[data-act="field"]');
    if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); el.click(); }
  });

  let liveTimer = null;
  function onLive(table, payload) {
    clearTimeout(liveTimer);
    if (isLeitung()) { if (L.pin) liveTimer = setTimeout(loadLeitung, 250); return; }
    // groups: only react to deletes (release/new round) or while on the start screen
    if (table === 'groups' && G.claim && payload.eventType !== 'DELETE') return;
    liveTimer = setTimeout(() => refreshGroupView({ table, payload }), 250);
  }

  function boot() {
    document.body.classList.remove('present');
    if (isLeitung()) { if (L.pin) loadLeitung(); else renderPin(); return; }
    restoreClaim();
    renderGroup();
    refreshGroupView().then(() => { if (G.claim) save(true); });
  }

  window.addEventListener('hashchange', () => { L.confirmReset = false; boot(); });
  api.subscribe(onLive);
  setInterval(() => { if (isLeitung()) { if (L.pin) loadLeitung(); } else refreshGroupView(); }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { if (isLeitung()) { if (L.pin) loadLeitung(); } else { refreshGroupView(); if (G.claim) flush(); } } });
  boot();
})();
