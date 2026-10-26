// ElitData ellenőrző felület
// Az adatok a Supabase-ben vannak; olvasni csak a munkatárslistán szereplő, bejelentkezett felhasználók tudnak,
// dönteni csak a "donto" / "admin" szerepűek (adatbázis-oldali RLS és ellenőrzött függvények).
'use strict';

const SUPABASE_URL = 'https://rrvdpkxcaptngzkkblxd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJydmRwa3hjYXB0bmd6a2tibHhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0ODM4NzEsImV4cCI6MjA5MTA1OTg3MX0.3zwmyGGRo-wdVu_9GejX_bV3Iv3BoW-mnjB-StbbAec';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const PAGE = 50;
const S = { user: null, szerep: null, donto: false, tab: 'nyitott', kodok: null };
const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');

// ---------- segédfüggvények ----------
function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const dash = v => (v === null || v === undefined || v === '' ? '<span class="muted">—</span>' : esc(v));
// az alapadatbázis éveit rövidítve tárolja: 3 jegy = 1000 + n (pl. 905 = 1905), 2 jegy = 18xx/19xx (a születési év dönt)
function ev(y, szul) {
  if (y === null || y === undefined || y === '') return '';
  const n = Number(y); if (!(n > 0)) return y;
  if (n < 100) { const s = Number(szul) || 0; return s && 1800 + n >= s ? 1800 + n : 1900 + n; }
  return n < 1000 ? n + 1000 : n;
}
function idoszak(a, b, szul) { a = ev(a, szul); b = ev(b, szul); if (!a && !b) return '<span class="muted">—</span>'; if (a && b && a !== b) return `${a}–${b}`; return String(a || b); }
function forrasBadge(nev, fazis) {
  if (!nev) return '';
  const kig = (fazis || nev) === 'KIG-féle kutatás' || nev === 'KIG-féle kutatás';
  const rov = kig ? 'KIG' : 'ElitData2026';
  return `<span class="badge ${kig ? 'b-kig' : 'b-uj'}" title="${esc(nev)}">${rov}</span>`;
}
function allapotBadge(a) {
  const m = { 'rendben': 'b-ok', 'elfogadva': 'b-ok', 'megoldva': 'b-ok', 'döntésre vár': 'b-warn', 'javaslat': 'b-warn', 'nyitott': 'b-warn',
              'ütközés': 'b-bad', 'párosítatlan': 'b-bad', 'elutasítva': 'b-gray', 'elvetve': 'b-gray' };
  return a ? `<span class="badge ${m[a] || 'b-gray'}">${esc(a)}</span>` : '';
}
const MEZONEV = { harmonizalt: 'Harmonizált foglalkozás', hivatas1: 'Hivatás1', hivatas2: 'Hivatás2', specifikacio: 'Specifikáció' };
const SZEMELYMEZO = {
  vezeteknev: 'Vezetéknév', keresztnev: 'Keresztnév', szuletesiev: 'Születési év', szuletesihely: 'Születési hely',
  szuletesiorszagkod: 'Születési ország (kód)', nemzetisegkod: 'Nemzetiség (kód)', doktoricim: 'Doktori cím', vegzettsegid: 'Végzettség (kód)',
  szerzetese: 'Szerzetes', halalev: 'Halálozás éve', halalho: 'Halálozás hónapja', halalnap: 'Halálozás napja', halalhely: 'Halálozás helye',
  halalhelymegyekod: 'Halálozás helye (megyekód)', halalmodja: 'Halál módja (kód)', halalpontose: 'Halálozás pontos (kód)',
  testverekszama: 'Testvérek száma', gyerekekszama: 'Gyerekek száma', hazassagokszama: 'Házasságok száma', elsohazassagev: 'Első házasság éve',
  hazaskor: 'Házasságkötéskori kor', csaladiallapot1928: 'Családi állapot 1928', csaladiallapot1938: 'Családi állapot 1938',
  csaladiallapot1942: 'Családi állapot 1942', anyahalalev: 'Anya halála', apahalalev: 'Apa halála', szerzetesrende: 'Szerzetesrend (kód)',
};
const REJTETT_MEZO = new Set(['elittage', 'eredetiazon1', 'eredetiazon2', 'adatforraslap', 'rogzitesdatuma']);
function msg(el, text, kind = 'info') { el.innerHTML = `<div class="msg ${kind}">${esc(text)}</div>`; }
async function q(promise) { const { data, error, count } = await promise; if (error) throw error; return { data, count }; }
function hibaKiir(el, e) { console.error(e); msg(el, 'Hiba: ' + (e.message || e), 'err'); }
function pager(total, page, onGo) {
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const d = document.createElement('div'); d.className = 'pager';
  d.innerHTML = `<span class="muted small">${total} találat · ${page + 1}/${pages}. oldal</span>
    <button class="btn" ${page === 0 ? 'disabled' : ''} data-p="-1">‹ Előző</button>
    <button class="btn" ${page + 1 >= pages ? 'disabled' : ''} data-p="1">Következő ›</button>`;
  d.addEventListener('click', e => { const p = e.target.dataset.p; if (p) onGo(page + Number(p)); });
  return d;
}
const tiszta = t => t.replace(/[,()*%\\]/g, ' ').trim();
function debounce(fn, ms = 300) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
async function kodok() {
  if (S.kodok) return S.kodok;
  const [f, h] = await Promise.all([
    q(sb.from('kod_foglalkozas').select('ertek').eq('ervenyes', true).order('ertek')),
    q(sb.from('kod_hivatas').select('lista,ertek').eq('ervenyes', true).order('ertek')),
  ]);
  S.kodok = {
    harmonizalt: f.data.map(r => r.ertek),
    hivatas1: h.data.filter(r => r.lista === 1).map(r => r.ertek),
    hivatas2: h.data.filter(r => r.lista === 2).map(r => r.ertek),
    specifikacio: [],
  };
  return S.kodok;
}
function datalist(id, vals) { return `<datalist id="${id}">${vals.map(v => `<option value="${esc(v)}">`).join('')}</datalist>`; }

// ---------- belépés ----------
async function init() {
  $('#loginform').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('#email').value.trim().toLowerCase(), password = $('#jelszo').value;
    if (!password) { msg($('#loginmsg'), 'Add meg a jelszót, vagy kérj belépési linket e-mailben.', 'err'); return; }
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) msg($('#loginmsg'), 'Sikertelen belépés: hibás e-mail-cím vagy jelszó.', 'err');
  });
  $('#linkbtn').addEventListener('click', async () => {
    const email = $('#email').value.trim().toLowerCase();
    if (!email) { msg($('#loginmsg'), 'Előbb add meg az e-mail-címedet.', 'err'); return; }
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: false } });
    if (error) msg($('#loginmsg'), 'Nem sikerült linket küldeni (' + error.message + '). Lépj be jelszóval.', 'err');
    else msg($('#loginmsg'), 'Elküldtük a belépési linket. Nyisd meg ugyanebben a böngészőben.', 'ok');
  });
  $('#pwbtn').addEventListener('click', async () => {
    const uj = prompt('Új jelszó (legalább 10 karakter):');
    if (!uj) return;
    if (uj.length < 10) { alert('A jelszó legalább 10 karakter legyen.'); return; }
    const { error } = await sb.auth.updateUser({ password: uj });
    alert(error ? 'Nem sikerült: ' + error.message : 'A jelszó megváltozott.');
  });
  for (const id of ['#logout', '#logout2']) $(id).addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });
  $('#tabs').addEventListener('click', e => { const t = e.target.dataset.tab; if (t) valt(t); });
  sb.auth.onAuthStateChange((_ev, session) => { if (session && !S.user) belepve(session); });
  const { data: { session } } = await sb.auth.getSession();
  if (session) belepve(session); else $('#login').classList.remove('hidden');
}

async function belepve(session) {
  S.user = session.user;
  $('#login').classList.add('hidden');
  if (location.hash.includes('access_token')) history.replaceState(null, '', location.pathname);
  try {
    const { data: munkatars } = await q(sb.rpc('is_munkatars'));
    if (!munkatars) { $('#noaccess-email').textContent = S.user.email; $('#noaccess').classList.remove('hidden'); return; }
    const { data: donto } = await q(sb.rpc('is_donto'));
    S.donto = !!donto;
    const { data: m } = await q(sb.from('tbl_munkatarsak').select('nev,szerep').eq('email', S.user.email.toLowerCase()).maybeSingle());
    S.szerep = m ? m.szerep : null;
    $('#userinfo').textContent = m && m.nev ? m.nev : S.user.email;
    $('#top').classList.remove('hidden'); app.classList.remove('hidden');
    const h = location.hash.replace('#', '');
    if (h.startsWith('szemely=')) { valt('szemelyek', false); szemelyLap(Number(h.split('=')[1])); }
    else valt(S.tab);
  } catch (e) { $('#login').classList.remove('hidden'); hibaKiir($('#loginmsg'), e); }
}

function valt(tab, render = true) {
  S.tab = tab;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  if (!render) return;
  ({ nyitott: nyitottLap, szemelyek: szemelyekLap, harm: harmLap, szabalyok: szabalyokLap, naplo: naploLap })[tab]();
}

// ---------- Nyitott kérdések ----------
const TIPUSOK = ['szabálydöntés', 'ütközés', 'névrokon-keveredés', 'forrásegyeztetés', 'azonosító-eltérés', 'párosítatlan harmonizációs sor', 'feloldatlan évkód'];
async function nyitottLap() {
  app.innerHTML = `<h2>Nyitott kérdések</h2>
    <p class="muted">Minden, ami döntésre vár: szabályok, ütközések, egyedi ellenőrzések. Egy döntés után a tétel eltűnik a listából.</p>
    <div class="chips" id="ny-chips"></div>
    <div class="toolbar"><input type="search" id="ny-q" placeholder="Keresés névre vagy értékre…"></div>
    <div class="grid2"><div><div class="tbl-wrap" id="ny-list"></div><div id="ny-pager"></div></div><div class="sticky" id="ny-detail"></div></div>`;
  const st = { tipus: 'szabálydöntés', page: 0, kereses: '' };
  try {
    const counts = await Promise.all(TIPUSOK.map(t => q(sb.from('v_dontesre_var').select('*', { count: 'exact', head: true }).eq('tipus', t))));
    const chips = $('#ny-chips');
    const rajz = () => { chips.innerHTML = TIPUSOK.map((t, i) => counts[i].count ? `<span class="chip ${st.tipus === t ? 'on' : ''}" data-t="${esc(t)}">${esc(t)}<b>${counts[i].count}</b></span>` : '').join('') || '<span class="muted">Nincs nyitott kérdés.</span>'; };
    rajz();
    chips.addEventListener('click', e => { const c = e.target.closest('.chip'); if (!c) return; st.tipus = c.dataset.t; st.page = 0; rajz(); lista(); });
    if (!counts[0].count) { const i = counts.findIndex(c => c.count); if (i >= 0) { st.tipus = TIPUSOK[i]; rajz(); } }
  } catch (e) { return hibaKiir(app, e); }
  $('#ny-q').addEventListener('input', debounce(e => { st.kereses = tiszta(e.target.value); st.page = 0; lista(); }));
  $('#ny-detail').innerHTML = '<div class="card empty">Válassz egy tételt a listából.</div>';
  async function lista() {
    const box = $('#ny-list');
    box.innerHTML = '<div class="empty">Betöltés…</div>';
    let qq = sb.from('v_dontesre_var').select('*', { count: 'exact' }).eq('tipus', st.tipus);
    if (st.kereses) qq = qq.or(`nev.ilike.%${st.kereses}%,ertek.ilike.%${st.kereses}%`);
    qq = st.tipus === 'szabálydöntés' ? qq.order('erintett_sorok', { ascending: false, nullsFirst: false }) : qq.order('nev', { nullsFirst: false });
    try {
      const { data, count } = await q(qq.range(st.page * PAGE, st.page * PAGE + PAGE - 1));
      if (!data.length) { box.innerHTML = '<div class="empty">Nincs találat.</div>'; $('#ny-pager').innerHTML = ''; return; }
      const szab = st.tipus === 'szabálydöntés';
      box.innerHTML = `<table><thead><tr>${szab ? '<th>Mező</th><th>Beírt érték</th><th>Sorok</th><th>Személyek</th><th>Javaslat</th>' : '<th>Név</th><th>Érték</th><th>Kérdés</th>'}</tr></thead><tbody>${
        data.map((r, i) => szab
          ? `<tr class="click" data-i="${i}"><td>${esc(MEZONEV[r.mezo] || r.mezo)}</td><td><b>${esc(r.ertek)}</b></td><td>${dash(r.erintett_sorok)}</td><td>${dash(r.erintett_szemelyek)}</td><td class="small">${dash(r.javaslat)}</td></tr>`
          : `<tr class="click" data-i="${i}"><td>${dash(r.nev)}</td><td class="small">${dash(r.ertek)}</td><td class="small">${esc(r.kerdes)}</td></tr>`).join('')}</tbody></table>`;
      box.querySelector('tbody').addEventListener('click', e => {
        const tr = e.target.closest('tr'); if (!tr) return;
        box.querySelectorAll('tr').forEach(x => x.classList.remove('sel')); tr.classList.add('sel');
        tetel(data[Number(tr.dataset.i)], () => nyitottLap());
      });
      $('#ny-pager').innerHTML = ''; $('#ny-pager').appendChild(pager(count, st.page, p => { st.page = p; lista(); }));
    } catch (e) { hibaKiir(box, e); }
  }
  lista();
}

async function tetel(r, utana) {
  const d = $('#ny-detail') || $('#detail');
  d.innerHTML = '<div class="card empty">Betöltés…</div>';
  try {
    if (r.tipus === 'szabálydöntés') return await szabalyReszlet(Number(r.rekord_id), d, utana);
    if (r.tipus === 'ütközés' || r.tipus === 'párosítatlan harmonizációs sor') return await harmReszlet(Number(r.rekord_id), d, utana);
    if (r.tipus === 'feloldatlan évkód') {
      d.innerHTML = `<div class="card"><h3>Feloldatlan évkód</h3><div class="kv">
        <div>Személy</div><div><a href="#szemely=${r.szemelyid}" data-szem="${r.szemelyid}">${esc(r.nev)}</a></div>
        <div>Foglalkozás</div><div>${esc(r.ertek)}</div><div>Probléma</div><div>${esc(r.kerdes)}</div>
        <div>Forrás</div><div>${esc(r.forras)}</div></div>
        <p class="muted small">A helyes évek a karrierállomás javításával rögzíthetők; ez a felületen még nem érhető el, jelezd az adatbázis gazdájának.</p></div>`;
      return szemLinkek(d);
    }
    return await ellenorzendoReszlet(Number(r.rekord_id), d, utana);
  } catch (e) { hibaKiir(d, e); }
}
function szemLinkek(root) {
  root.querySelectorAll('[data-szem]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); valt('szemelyek', false); szemelyLap(Number(a.dataset.szem)); }));
}

// szabály részletei + döntés
async function szabalyReszlet(id, d, utana) {
  const { data: s } = await q(sb.from('tbl_ertek_szabalyok').select('*').eq('szabaly_id', id).single());
  const col = s.oszlop + '_beirt';
  const { data: sorok, count } = await q(sb.from('tbl_karrier_harmonizalas')
    .select('harm_id,szemelyid,fajl_nev,fajl_foglalkozas,fajl_elsoev,fajl_utolsoev,harmonizalt_beirt,hivatas1_beirt,hivatas2_beirt,specifikacio_beirt,megjegyzes,forras_id', { count: 'exact' })
    .eq(col, s.beirt_ertek).order('fajl_nev').limit(300));
  const k = await kodok();
  // személyenként összevonva
  const szem = new Map();
  for (const r of sorok) {
    const key = r.szemelyid || r.fajl_nev;
    if (!szem.has(key)) szem.set(key, { ...r, sorok: 0, fogl: new Set() });
    const x = szem.get(key); x.sorok++; if (r.fajl_foglalkozas) x.fogl.add(r.fajl_foglalkozas);
  }
  const lista = s.oszlop;
  d.innerHTML = `<div class="card">
    <h3 style="margin-top:0">${esc(MEZONEV[s.oszlop])}: „${esc(s.beirt_ertek)}”</h3>
    <div class="kv small">
      <div>Állapot</div><div>${allapotBadge(s.allapot)}</div>
      <div>Típus</div><div>${dash(s.tipus)}</div>
      <div>Javaslat</div><div>${s.cel_oszlop ? esc(MEZONEV[s.cel_oszlop]) + ': ' + esc(s.cel_ertek || '') : '<span class="muted">nincs</span>'}</div>
      <div>Érintett</div><div>${count} sor, ${szem.size} személy</div>
      ${s.dontotte ? `<div>Döntött</div><div>${esc(s.dontotte)}, ${new Date(s.dontes_ideje).toLocaleString('hu-HU')}</div>` : ''}
      ${s.megjegyzes ? `<div>Megjegyzés</div><div>${esc(s.megjegyzes)}</div>` : ''}
    </div>
    ${S.donto ? `<form class="form" id="szf">
      <div class="opts">
        <label><input type="radio" name="mod" value="lista" checked> <span>Felvesszük a(z) <b>${esc(MEZONEV[lista])}</b> listára ebben az alakban</span></label>
        <label><input type="radio" name="mod" value="atir"> <span>Átírjuk / áthelyezzük másik értékre vagy mezőbe</span></label>
        <label><input type="radio" name="mod" value="spec"> <span>Specifikációba kerül</span></label>
        <label><input type="radio" name="mod" value="elutasit"> <span>Elutasítjuk (a beírt érték érvénytelen, egyedileg kell javítani)</span></label>
      </div>
      <div id="atir" class="hidden form">
        <label>Célmező<select id="celo">${['harmonizalt', 'hivatas1', 'hivatas2', 'specifikacio'].map(c => `<option value="${c}" ${c === (s.cel_oszlop || s.oszlop) ? 'selected' : ''}>${MEZONEV[c]}</option>`).join('')}</select></label>
        <label>Célérték<input id="cele" list="dl-cel" value="${esc(s.cel_ertek || s.beirt_ertek)}"></label>
        <span id="dl-wrap"></span>
      </div>
      <label>Megjegyzés (indoklás)<textarea id="szm" placeholder="Miért így döntöttünk?"></textarea></label>
      <button class="btn primary" type="submit">Döntés rögzítése</button>
      <div id="szmsg"></div>
    </form>` : ''}
    <h3>Érintett személyek</h3>
    <div class="tbl-wrap"><table><thead><tr><th>Név</th><th>Sorok</th><th>Hivatás1 / Hivatás2</th><th>Eredeti foglalkozások</th></tr></thead><tbody>${
      [...szem.values()].map(r => `<tr><td>${r.szemelyid ? `<a href="#szemely=${r.szemelyid}" data-szem="${r.szemelyid}">${esc(r.fajl_nev)}</a>` : esc(r.fajl_nev)}</td><td>${r.sorok}</td>
        <td class="small">${dash(r.hivatas1_beirt)} / ${dash(r.hivatas2_beirt)}</td><td class="small">${esc([...r.fogl].slice(0, 6).join(', '))}</td></tr>`).join('')
    }</tbody></table></div>
    ${count > 300 ? '<p class="muted small">Az első 300 sor látszik.</p>' : ''}
  </div>`;
  szemLinkek(d);
  if (!S.donto) return;
  const f = $('#szf', d);
  const dl = () => { $('#dl-wrap', d).innerHTML = datalist('dl-cel', k[$('#celo', d).value] || []); };
  dl(); $('#celo', d).addEventListener('change', dl);
  if (s.cel_oszlop === 'specifikacio') f.mod.value = 'spec'; else if (s.cel_oszlop && s.cel_oszlop !== s.oszlop || (s.cel_ertek && s.cel_ertek !== s.beirt_ertek)) f.mod.value = 'atir';
  const mutat = () => $('#atir', d).classList.toggle('hidden', f.mod.value !== 'atir');
  mutat(); f.addEventListener('change', mutat);
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
    const megj = $('#szm', d).value;
    try {
      if (f.mod.value === 'lista') {
        await q(sb.rpc('lista_bovit', { p_lista: s.oszlop, p_ertek: s.beirt_ertek, p_meghatarozas: megj || null }));
        await q(sb.rpc('dont_szabaly', { p_szabaly_id: id, p_allapot: 'elfogadva', p_cel_oszlop: s.oszlop, p_cel_ertek: s.beirt_ertek, p_megjegyzes: megj || 'Felvéve a listára' }));
        S.kodok = null;
      } else if (f.mod.value === 'atir') {
        await q(sb.rpc('dont_szabaly', { p_szabaly_id: id, p_allapot: 'elfogadva', p_cel_oszlop: $('#celo', d).value, p_cel_ertek: $('#cele', d).value, p_megjegyzes: megj || null }));
      } else if (f.mod.value === 'spec') {
        await q(sb.rpc('dont_szabaly', { p_szabaly_id: id, p_allapot: 'elfogadva', p_cel_oszlop: 'specifikacio', p_cel_ertek: s.beirt_ertek, p_megjegyzes: megj || null }));
      } else {
        await q(sb.rpc('dont_szabaly', { p_szabaly_id: id, p_allapot: 'elutasítva', p_cel_oszlop: null, p_cel_ertek: null, p_megjegyzes: megj || null }));
      }
      msg($('#szmsg', d), 'Rögzítve. Az érintett sorok frissültek; az esetleges ütközések az „ütközés” csoportban jelennek meg.', 'ok');
      setTimeout(utana, 1200);
    } catch (e2) { btn.disabled = false; hibaKiir($('#szmsg', d), e2); }
  });
}

// egy harmonizációs sor részletei + egyedi döntés
async function harmReszlet(harmId, d, utana) {
  const [{ data: h }, { data: v }] = await Promise.all([
    q(sb.from('tbl_karrier_harmonizalas').select('*').eq('harm_id', harmId).single()),
    q(sb.from('v_karrier_harmonizalt').select('*').eq('harm_id', harmId).single()),
  ]);
  const { data: f } = await q(sb.from('tbl_forrasok').select('megnevezes,fazis').eq('forras_id', h.forras_id).single());
  const k = await kodok();
  const sor = m => `<tr><td>${MEZONEV[m]}</td><td>${dash(h[m + '_beirt'])}</td><td><b>${dash(v[m])}</b></td><td>${dash(h[m + '_egyedi'])}</td></tr>`;
  d.innerHTML = `<div class="card">
    <h3 style="margin-top:0">${h.szemelyid ? `<a href="#szemely=${h.szemelyid}" data-szem="${h.szemelyid}">${esc(h.fajl_nev)}</a>` : esc(h.fajl_nev)}</h3>
    <div class="kv small">
      <div>Állapot</div><div>${allapotBadge(v.allapot)} ${v.nyitott_ertekek ? `<span class="muted">${esc(v.nyitott_ertekek)}</span>` : ''}</div>
      <div>Karrierállomás</div><div>${esc(h.fajl_foglalkozas || '')} · ${esc(h.fajl_munkahely || '')} · ${esc([h.fajl_elsoev, h.fajl_utolsoev].filter(Boolean).join('–'))}</div>
      <div>Forrás</div><div>${forrasBadge(f.megnevezes, f.fazis)} ${esc(f.megnevezes)} (${esc(h.fajl_munkalap || '')}, ${esc(h.fajl_sor || '')}. sor)</div>
      ${h.megjegyzes ? `<div>Kódolói megjegyzés</div><div>${esc(h.megjegyzes)}</div>` : ''}
      ${h.jeloles ? `<div>Jelölés</div><div>${esc(h.jeloles)}</div>` : ''}
      ${h.egyedi_dontotte ? `<div>Egyedi döntés</div><div>${esc(h.egyedi_dontotte)}, ${new Date(h.egyedi_ideje).toLocaleString('hu-HU')}${h.egyedi_megjegyzes ? ' – ' + esc(h.egyedi_megjegyzes) : ''}</div>` : ''}
    </div>
    <h3>Besorolás</h3>
    <div class="tbl-wrap"><table><thead><tr><th>Mező</th><th>Beírt</th><th>Érvényes</th><th>Egyedi döntés</th></tr></thead><tbody>
      ${['harmonizalt', 'hivatas1', 'hivatas2', 'specifikacio'].map(sor).join('')}</tbody></table></div>
    ${S.donto && h.karrierid ? `<form class="form" id="egf">
      <h3>Egyedi döntés erre a sorra</h3>
      <label>Mező<select id="egm">${['hivatas1', 'hivatas2', 'harmonizalt', 'specifikacio'].map(m => `<option value="${m}">${MEZONEV[m]}</option>`).join('')}</select></label>
      <label>Érték (üresen hagyva: az egyedi döntés törlése)<input id="ege" list="dl-eg"></label><span id="dl-eg-w"></span>
      <label>Megjegyzés<textarea id="egj"></textarea></label>
      <button class="btn primary" type="submit">Rögzítés</button><div id="egmsg"></div></form>` : ''}
    ${!h.karrierid ? '<p class="muted small">Ez a sor nem párosítható karrierállomással; a forrásfájlban kell ellenőrizni.</p>' : ''}
  </div>`;
  szemLinkek(d);
  if (!(S.donto && h.karrierid)) return;
  const dl = () => { $('#dl-eg-w', d).innerHTML = datalist('dl-eg', k[$('#egm', d).value] || []); $('#ege', d).value = h[$('#egm', d).value + '_egyedi'] || ''; };
  dl(); $('#egm', d).addEventListener('change', dl);
  $('#egf', d).addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await q(sb.rpc('dont_egyedi', { p_harm_id: harmId, p_mezo: $('#egm', d).value, p_ertek: $('#ege', d).value, p_megjegyzes: $('#egj', d).value || null }));
      msg($('#egmsg', d), 'Rögzítve.', 'ok'); setTimeout(utana, 1000);
    } catch (e2) { hibaKiir($('#egmsg', d), e2); }
  });
}

async function ellenorzendoReszlet(id, d, utana) {
  const { data: e } = await q(sb.from('tbl_ellenorzendo').select('*').eq('ellenorzes_id', id).single());
  let nev = '';
  if (e.szemelyid) { const { data: s } = await q(sb.from('tbl_szemelyek').select('vezeteknev,keresztnev').eq('szemelyid', e.szemelyid).single()); nev = `${s.vezeteknev} ${s.keresztnev}`; }
  d.innerHTML = `<div class="card"><h3 style="margin-top:0">${esc(e.tipus)}</h3>
    <div class="kv small">
      ${e.szemelyid ? `<div>Személy</div><div><a href="#szemely=${e.szemelyid}" data-szem="${e.szemelyid}">${esc(nev)}</a> <span class="muted">(${e.szemelyid})</span></div>` : ''}
      <div>Kérdés</div><div>${esc(e.kerdes)}</div><div>Állapot</div><div>${allapotBadge(e.allapot)}</div>
      ${e.valasz ? `<div>Válasz</div><div>${esc(e.valasz)}</div>` : ''}
    </div>
    ${S.donto ? `<form class="form" id="elf">
      <label>Válasz / indoklás<textarea id="elv" required>${esc(e.valasz || '')}</textarea></label>
      <div class="toolbar"><button class="btn primary" type="submit" data-a="megoldva">Megoldva</button>
      <button class="btn" type="submit" data-a="elvetve">Elvetve (nem probléma)</button></div><div id="elmsg"></div></form>` : ''}
  </div>`;
  szemLinkek(d);
  if (!S.donto) return;
  let akcio = 'megoldva';
  $('#elf', d).querySelectorAll('button').forEach(b => b.addEventListener('click', () => { akcio = b.dataset.a; }));
  $('#elf', d).addEventListener('submit', async ev2 => {
    ev2.preventDefault();
    try { await q(sb.rpc('lezar_ellenorzendo', { p_id: id, p_allapot: akcio, p_valasz: $('#elv', d).value })); msg($('#elmsg', d), 'Rögzítve.', 'ok'); setTimeout(utana, 1000); }
    catch (e2) { hibaKiir($('#elmsg', d), e2); }
  });
}

// ---------- Személyek ----------
async function szemelyekLap() {
  location.hash = '';
  app.innerHTML = `<h2>Személyek</h2>
    <p class="muted">Az elittagok listája. Kattints egy névre az adatlaphoz.</p>
    <div class="toolbar"><input type="search" id="sz-q" placeholder="Név…">
      <select id="sz-f"><option value="">Mind</option><option value="nyitott">Van nyitott harmonizáció</option><option value="kerdes">Van nyitott kérdés</option><option value="nokarr">Nincs karrieradat</option></select></div>
    <div class="tbl-wrap" id="sz-list"></div><div id="sz-pager"></div>`;
  const st = { page: 0, kereses: '', szuro: '' };
  const lista = async () => {
    const box = $('#sz-list'); box.innerHTML = '<div class="empty">Betöltés…</div>';
    let qq = sb.from('v_szemely_lista').select('*', { count: 'exact' });
    if (st.kereses) { const t = st.kereses.split(/\s+/); qq = t.length > 1 ? qq.ilike('vezeteknev', `%${t[0]}%`).ilike('keresztnev', `%${t.slice(1).join(' ')}%`) : qq.or(`vezeteknev.ilike.%${t[0]}%,keresztnev.ilike.%${t[0]}%`); }
    if (st.szuro === 'nyitott') qq = qq.gt('harm_nyitott', 0);
    if (st.szuro === 'kerdes') qq = qq.gt('nyitott_kerdes', 0);
    if (st.szuro === 'nokarr') qq = qq.eq('karrier_db', 0);
    try {
      const { data, count } = await q(qq.order('vezeteknev').order('keresztnev').range(st.page * PAGE, st.page * PAGE + PAGE - 1));
      box.innerHTML = data.length ? `<table><thead><tr><th>Név</th><th>Született</th><th>Karrierállomás</th><th>Harmonizálva</th><th>Nyitott</th></tr></thead><tbody>${
        data.map(r => `<tr class="click" data-id="${r.szemelyid}"><td><b>${esc(r.vezeteknev)} ${esc(r.keresztnev)}</b></td><td>${dash(r.szuletesiev)} <span class="muted small">${esc(r.szuletesihely || '')}</span></td>
          <td>${r.karrier_db}</td><td>${r.harm_rendben}</td><td>${r.harm_nyitott ? `<span class="badge b-warn">${r.harm_nyitott} sor</span>` : ''} ${r.nyitott_kerdes ? `<span class="badge b-bad">${r.nyitott_kerdes} kérdés</span>` : ''}</td></tr>`).join('')}</tbody></table>`
        : '<div class="empty">Nincs találat.</div>';
      box.querySelector('tbody')?.addEventListener('click', e => { const tr = e.target.closest('tr'); if (tr) szemelyLap(Number(tr.dataset.id)); });
      $('#sz-pager').innerHTML = ''; $('#sz-pager').appendChild(pager(count, st.page, p => { st.page = p; lista(); }));
    } catch (e) { hibaKiir(box, e); }
  };
  $('#sz-q').addEventListener('input', debounce(e => { st.kereses = tiszta(e.target.value); st.page = 0; lista(); }));
  $('#sz-f').addEventListener('change', e => { st.szuro = e.target.value; st.page = 0; lista(); });
  lista();
}

async function szemelyLap(id) {
  location.hash = 'szemely=' + id;
  app.innerHTML = '<div class="empty">Betöltés…</div>';
  try {
    const [{ data: sz }, { data: mezok }, { data: kar }, { data: tan }, { data: nyit }] = await Promise.all([
      q(sb.from('v_szemely_lista').select('*').eq('szemelyid', id).maybeSingle()),
      q(sb.from('v_szemely_mezok_ervenyes').select('*').eq('szemelyid', id)),
      q(sb.from('v_karrier_reszletes').select('*').eq('szemelyid', id).order('elsoev', { nullsFirst: false }).order('sorszam')),
      q(sb.from('tbl_tanulmanyok').select('*').eq('szemelyid', id).order('kezdoev', { nullsFirst: false })),
      q(sb.from('v_dontesre_var').select('*').eq('szemelyid', id)),
    ]);
    const nev = sz ? `${sz.vezeteknev} ${sz.keresztnev}` : (mezok.find(m => m.mezo === 'vezeteknev')?.ertek || '') + ' ' + (mezok.find(m => m.mezo === 'keresztnev')?.ertek || '');
    const alap = mezok.filter(m => !REJTETT_MEZO.has(m.mezo) && m.mezo !== 'vezeteknev' && m.mezo !== 'keresztnev')
      .sort((a, b) => Object.keys(SZEMELYMEZO).indexOf(a.mezo) - Object.keys(SZEMELYMEZO).indexOf(b.mezo));
    const szul = sz ? sz.szuletesiev : ev(mezok.find(m => m.mezo === 'szuletesiev')?.ertek);
    const evMezo = new Set(['szuletesiev', 'halalev', 'elsohazassagev', 'anyahalalev', 'apahalalev']);
    app.innerHTML = `<p><a href="#" id="vissza">‹ Vissza a listához</a></p>
      <h2>${esc(nev)}</h2><p class="muted">SzemélyID: ${id}</p>
      <div class="legend"><span>${forrasBadge('KIG-féle kutatás', 'KIG-féle kutatás')} a KIG-féle kutatásból</span><span>${forrasBadge('x', 'ElitData2026')} az ElitData2026 fázisból</span></div>
      ${nyit.length ? `<div class="msg info">${nyit.length} nyitott kérdés tartozik ehhez a személyhez: ${nyit.map(n => esc(n.tipus)).join(', ')}.</div>` : ''}
      <div class="grid2">
        <div class="card"><h3 style="margin-top:0">Alapadatok</h3><div class="kv">${alap.map(m => `<div>${esc(SZEMELYMEZO[m.mezo] || m.mezo)}</div>
          <div>${esc(evMezo.has(m.mezo) ? ev(m.ertek) : m.ertek)} ${forrasBadge(m.forras, m.fazis)} ${m.allapot === 'kézzel elfogadva' ? '<span class="badge b-ok">elfogadva</span>' : ''}</div>`).join('')}</div></div>
        <div class="card"><h3 style="margin-top:0">Tanulmányok</h3>${tan.length ? `<div class="tbl-wrap"><table><thead><tr><th>Szint</th><th>Évek</th><th>Szak</th><th>Diploma</th></tr></thead><tbody>${
          tan.map(t => `<tr><td>${esc({ altalanos: 'alapfok', kozep: 'középfok', felso: 'felsőfok' }[t.iskolatipus] || t.iskolatipus)}</td><td>${idoszak(t.kezdoev, t.befejezesev, szul)}</td><td>${dash(t.szak)}</td><td>${t.diplomaev ? ev(t.diplomaev, szul) : '<span class="muted">—</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Nincs adat.</p>'}</div>
      </div>
      <h3>Karrier és harmonizáció</h3>
      <div class="tbl-wrap"><table id="kar-tbl"><thead><tr><th>Időszak</th><th>Foglalkozás</th><th>Munkahely</th><th>Forrás</th><th>Harmonizált</th><th>Hivatás1</th><th>Hivatás2</th><th>Specifikáció</th><th>Állapot</th></tr></thead><tbody>${
        kar.map(k => `<tr ${k.harm_id ? `class="click" data-h="${k.harm_id}"` : ''}><td>${idoszak(k.elsoev, k.utolsoev)}${k.leiras && k.leiras.startsWith('? kód') ? ` <span class="badge b-warn">${esc(k.leiras)}</span>` : ''}</td>
          <td>${dash(k.foglalkozas)}</td><td class="small">${dash(k.munkahely)}</td><td>${forrasBadge(k.forras, k.fazis)}</td>
          <td>${dash(k.harmonizalt)}</td><td>${dash(k.hivatas1)}</td><td>${dash(k.hivatas2)}</td><td class="small">${dash(k.specifikacio)}</td>
          <td>${k.harm_id ? allapotBadge(k.harm_allapot) : '<span class="muted small">nincs besorolva</span>'}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">Nincs karrieradat.</td></tr>'}</tbody></table></div>
      <div id="detail" style="margin-top:16px"></div>`;
    $('#vissza').addEventListener('click', e => { e.preventDefault(); szemelyekLap(); });
    $('#kar-tbl tbody')?.addEventListener('click', e => {
      const tr = e.target.closest('tr[data-h]'); if (!tr) return;
      harmReszlet(Number(tr.dataset.h), $('#detail'), () => szemelyLap(id)).catch(err => hibaKiir($('#detail'), err));
      $('#detail').scrollIntoView({ behavior: 'smooth' });
    });
  } catch (e) { hibaKiir(app, e); }
}

// ---------- Harmonizáció ----------
async function harmLap() {
  app.innerHTML = `<h2>Harmonizáció</h2>
    <p class="muted">A kódolói besorolások karrierállomásonként: a beírt és az érvényes (egységesített) érték. Kattints egy sorra a részletekhez és az egyedi döntéshez.</p>
    <div class="toolbar">
      <select id="h-a"><option value="">Minden állapot</option><option>rendben</option><option>döntésre vár</option><option>ütközés</option><option>párosítatlan</option></select>
      <select id="h-f"><option value="">Minden forrás</option></select>
      <input type="search" id="h-q" placeholder="Érték (pl. KÖZGAZDÁSZ)…">
    </div>
    <div class="grid2"><div><div class="tbl-wrap" id="h-list"></div><div id="h-pager"></div></div><div class="sticky" id="detail"><div class="card empty">Válassz egy sort.</div></div></div>`;
  const st = { page: 0, allapot: '', forras: '', kereses: '' };
  try {
    const { data: fr } = await q(sb.from('tbl_forrasok').select('forras_id,megnevezes').eq('tipus', 'harmonizációs ellenőrzés (Excel)').order('megnevezes'));
    $('#h-f').innerHTML += fr.map(f => `<option value="${f.forras_id}">${esc(f.megnevezes)}</option>`).join('');
  } catch (e) { return hibaKiir(app, e); }
  const lista = async () => {
    const box = $('#h-list'); box.innerHTML = '<div class="empty">Betöltés…</div>';
    let qq = sb.from('v_karrier_harmonizalt').select('harm_id,szemelyid,harmonizalt,hivatas1,hivatas2,harmonizalt_beirt,hivatas1_beirt,hivatas2_beirt,allapot,nyitott_ertekek', { count: 'exact' });
    if (st.allapot) qq = qq.eq('allapot', st.allapot);
    if (st.forras) qq = qq.eq('forras_id', Number(st.forras));
    if (st.kereses) { const t = st.kereses; qq = qq.or(`harmonizalt_beirt.ilike.%${t}%,hivatas1_beirt.ilike.%${t}%,hivatas2_beirt.ilike.%${t}%`); }
    try {
      const { data, count } = await q(qq.order('harm_id').range(st.page * PAGE, st.page * PAGE + PAGE - 1));
      const ids = [...new Set(data.map(r => r.szemelyid).filter(Boolean))];
      const nevek = new Map();
      if (ids.length) { const { data: n } = await q(sb.from('tbl_szemelyek').select('szemelyid,vezeteknev,keresztnev').in('szemelyid', ids)); n.forEach(x => nevek.set(x.szemelyid, `${x.vezeteknev} ${x.keresztnev}`)); }
      const cell = (ervenyes, beirt) => ervenyes ? (ervenyes !== beirt && beirt ? `${esc(ervenyes)} <span class="muted small">(${esc(beirt)})</span>` : esc(ervenyes)) : (beirt ? `<span class="badge b-warn">${esc(beirt)}</span>` : '<span class="muted">—</span>');
      box.innerHTML = data.length ? `<table><thead><tr><th>Név</th><th>Harmonizált</th><th>Hivatás1</th><th>Hivatás2</th><th>Állapot</th></tr></thead><tbody>${
        data.map(r => `<tr class="click" data-h="${r.harm_id}"><td>${esc(nevek.get(r.szemelyid) || '?')}</td><td>${cell(r.harmonizalt, r.harmonizalt_beirt)}</td><td>${cell(r.hivatas1, r.hivatas1_beirt)}</td><td>${cell(r.hivatas2, r.hivatas2_beirt)}</td><td>${allapotBadge(r.allapot)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nincs találat.</div>';
      box.querySelector('tbody')?.addEventListener('click', e => {
        const tr = e.target.closest('tr'); if (!tr) return;
        box.querySelectorAll('tr').forEach(x => x.classList.remove('sel')); tr.classList.add('sel');
        harmReszlet(Number(tr.dataset.h), $('#detail'), lista).catch(err => hibaKiir($('#detail'), err));
      });
      $('#h-pager').innerHTML = ''; $('#h-pager').appendChild(pager(count, st.page, p => { st.page = p; lista(); }));
    } catch (e) { hibaKiir(box, e); }
  };
  $('#h-a').addEventListener('change', e => { st.allapot = e.target.value; st.page = 0; lista(); });
  $('#h-f').addEventListener('change', e => { st.forras = e.target.value; st.page = 0; lista(); });
  $('#h-q').addEventListener('input', debounce(e => { st.kereses = tiszta(e.target.value); st.page = 0; lista(); }));
  lista();
}

// ---------- Szabályok ----------
async function szabalyokLap() {
  app.innerHTML = `<h2>Szabályok</h2>
    <p class="muted">Értékszintű döntések: egy beírt értékre vonatkozó döntés minden érintett sorra érvényes. Itt a már elfogadott szabályok is láthatók és módosíthatók.</p>
    <div class="toolbar"><select id="sz-a"><option value="">Minden állapot</option><option>nyitott</option><option>javaslat</option><option>elfogadva</option><option>elutasítva</option></select>
      <select id="sz-o"><option value="">Minden mező</option><option value="harmonizalt">Harmonizált foglalkozás</option><option value="hivatas1">Hivatás1</option><option value="hivatas2">Hivatás2</option></select>
      <input type="search" id="sz-k" placeholder="Beírt érték…"></div>
    <div class="grid2"><div><div class="tbl-wrap" id="r-list"></div><div id="r-pager"></div></div><div class="sticky" id="ny-detail"><div class="card empty">Válassz egy szabályt.</div></div></div>`;
  const st = { page: 0, allapot: '', oszlop: '', kereses: '' };
  const lista = async () => {
    const box = $('#r-list'); box.innerHTML = '<div class="empty">Betöltés…</div>';
    let qq = sb.from('tbl_ertek_szabalyok').select('szabaly_id,oszlop,beirt_ertek,cel_oszlop,cel_ertek,allapot,dontotte', { count: 'exact' });
    if (st.allapot) qq = qq.eq('allapot', st.allapot);
    if (st.oszlop) qq = qq.eq('oszlop', st.oszlop);
    if (st.kereses) qq = qq.ilike('beirt_ertek', `%${st.kereses}%`);
    try {
      const { data, count } = await q(qq.order('oszlop').order('beirt_ertek').range(st.page * PAGE, st.page * PAGE + PAGE - 1));
      box.innerHTML = data.length ? `<table><thead><tr><th>Mező</th><th>Beírt</th><th>Cél</th><th>Állapot</th></tr></thead><tbody>${
        data.map(r => `<tr class="click" data-id="${r.szabaly_id}"><td>${esc(MEZONEV[r.oszlop])}</td><td><b>${esc(r.beirt_ertek)}</b></td>
          <td class="small">${r.cel_oszlop ? esc(MEZONEV[r.cel_oszlop]) + ': ' + esc(r.cel_ertek || '') : '<span class="muted">—</span>'}</td><td>${allapotBadge(r.allapot)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nincs találat.</div>';
      box.querySelector('tbody')?.addEventListener('click', e => {
        const tr = e.target.closest('tr'); if (!tr) return;
        box.querySelectorAll('tr').forEach(x => x.classList.remove('sel')); tr.classList.add('sel');
        szabalyReszlet(Number(tr.dataset.id), $('#ny-detail'), lista).catch(err => hibaKiir($('#ny-detail'), err));
      });
      $('#r-pager').innerHTML = ''; $('#r-pager').appendChild(pager(count, st.page, p => { st.page = p; lista(); }));
    } catch (e) { hibaKiir(box, e); }
  };
  $('#sz-a').addEventListener('change', e => { st.allapot = e.target.value; st.page = 0; lista(); });
  $('#sz-o').addEventListener('change', e => { st.oszlop = e.target.value; st.page = 0; lista(); });
  $('#sz-k').addEventListener('input', debounce(e => { st.kereses = tiszta(e.target.value); st.page = 0; lista(); }));
  lista();
}

// ---------- Napló ----------
async function naploLap() {
  app.innerHTML = `<h2>Napló</h2><p class="muted">Az utolsó 200 módosítás: ki, mikor, melyik táblában.</p><div class="tbl-wrap" id="n-list"><div class="empty">Betöltés…</div></div>`;
  try {
    const { data } = await q(sb.from('tbl_valtozasnaplo').select('naplo_id,tabla,muvelet,idopont,felhasznalo,regi,uj').order('naplo_id', { ascending: false }).limit(200));
    const valtozas = r => {
      if (!r.uj) return 'törölve';
      const ki = []; for (const k of Object.keys(r.uj)) if (JSON.stringify(r.uj[k]) !== JSON.stringify(r.regi?.[k]) && !['dontes_ideje', 'egyedi_ideje', 'rogzitve'].includes(k)) ki.push(`${k}: ${r.regi?.[k] ?? '—'} → ${r.uj[k] ?? '—'}`);
      return ki.join('; ');
    };
    $('#n-list').innerHTML = data.length ? `<table><thead><tr><th>Időpont</th><th>Ki</th><th>Tábla</th><th>Változás</th></tr></thead><tbody>${
      data.map(r => `<tr><td class="small">${new Date(r.idopont).toLocaleString('hu-HU')}</td><td class="small">${esc(r.felhasznalo)}</td><td class="small">${esc(r.tabla)}</td><td class="small">${esc(valtozas(r))}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Még nincs bejegyzés.</div>';
  } catch (e) { hibaKiir($('#n-list'), e); }
}

init();
