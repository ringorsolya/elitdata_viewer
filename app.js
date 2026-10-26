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

// ---------- Teljes személyi adatlap ----------
// A kódtáblák egyszer töltődnek be; ahol nincs megbízható kódtábla, a kód „kód N” formában látszik (lásd KODKONYV_HIANY).
async function kodtablak() {
  if (S.kt) return S.kt;
  const [vm, kit, kk, part, szerz, zst, fr] = await Promise.all([
    q(sb.from('kod_varmegyek').select('kodertek,kodnev')),
    q(sb.from('tbl_kod_kituntetes').select('lista,kituntetekod,kituntetenev')),
    q(sb.from('tbl_kod_kulfoldikit').select('orszag,kodertek,kituntetenev')),
    q(sb.from('tbl_kod_part').select('partkod,partnev')),
    q(sb.from('tbl_kod_szerzetesrendek').select('kodertek,kodnev')),
    q(sb.from('tbl_kod_zsidotorvenyek').select('kodertek,kodnev,tipus')),
    q(sb.from('tbl_forrasok').select('forras_id,megnevezes,fazis,tipus')),
  ]);
  const m = (rows, k, v) => new Map(rows.map(r => [Number(r[k]), r[v]]));
  S.kt = {
    hely: m(vm.data, 'kodertek', 'kodnev'),
    kitHazai: m(kit.data.filter(r => r.lista === 1), 'kituntetekod', 'kituntetenev'),
    kitKulf: kk.data,
    part: m(part.data, 'partkod', 'partnev'),
    szerzetes: m(szerz.data, 'kodertek', 'kodnev'),
    zst: m(zst.data, 'kodertek', 'kodnev'),
    forras: new Map(fr.data.map(r => [r.forras_id, r])),
  };
  return S.kt;
}
// Vélelmezett vallás-kódok: a korábbi ElitData-profilfájl feloldása alapján, a KIG-kódkönyvvel még egyeztetendő.
const VALLAS = { 0: 'nincs / felekezeten kívüli', 1: 'római katolikus', 2: 'református', 3: 'evangélikus', 4: 'unitárius', 5: 'görögkatolikus', 6: 'görögkatolikus', 8: 'izraelita' };
const SZEREP = { APA: 'apa', ANYA: 'anya', HAZASTARS_1: '1. házastárs', HAZASTARS_2: '2. házastárs', HAZASTARS_3: '3. házastárs' };
const LAKAS = { helyszin: 'Helyszín (kód)', lakcim: 'Lakcím típusa (kód)', lakasbanevek: 'Lakásban töltött évek', budapestenevek: 'Budapesten töltött évek', lakber: 'Lakbér', utcaiszobak: 'Utcai szobák', udvariszobak: 'Udvari szobák', kertiszobak: 'Kerti szobák', hall: 'Hall', cseledszoba: 'Cselédszoba', cseledfulke: 'Cselédfülke', konyha: 'Konyha', teakonyha: 'Teakonyha', eloszoba: 'Előszoba', eleskamra: 'Éléskamra', feredo: 'Fürdőszoba', veranda: 'Veranda', muterem: 'Műterem', egyebhelyiseg: 'Egyéb helyiség', garage: 'Garázs', halofulke: 'Hálófülke', pince: 'Pince', padlas: 'Padlás', alberlo: 'Albérlő', vizvezetek: 'Vízvezeték', gazvezetek: 'Gázvezeték', villany: 'Villany', kozpontifutes: 'Központi fűtés', etagefutes: 'Etázsfűtés', gazfutes: 'Gázfűtés', villanyfutes: 'Villanyfűtés', melegviz: 'Melegvíz', telefon: 'Telefon', detektorradio: 'Detektoros rádió', lamparadio: 'Lámpás rádió', fozeshelyek: 'Főzőhelyek', furdeshelyek: 'Fürdőhelyek', wcszam: 'WC', nemwcszam: 'Nem vízöblítéses WC' };
const ZST = { zst_szul: 'Zsidónak minősült születése alapján', zst_fele: 'Felekezet alapján', zst_gyer: 'Gyermekei érintettek', zst_1in: '1. törvény: érintett', zst_1mi: '1. törvény: következmény / mentesítés', zst_1ev: '1. törvény: év', zst_1ho: '1. törvény: hónap', zst_2in: '2. törvény: érintett', zst_2mi: '2. törvény: következmény / mentesítés', zst_2ev: '2. törvény: év', zst_2ho: '2. törvény: hónap' };
const PER_TIPUS = { BAJ: 'B-listázás / igazolás (1945–)', OSE: '1956 utáni eljárás' };

function profilRender(P, id) {
  const kt = S.kt;
  const sz = P.szemely || {}, r = P.reszletek || {};
  const szul = ev(sz.szuletesiev);
  const kod = v => (v === null || v === undefined || v === '') ? null : `<span class="kod" title="A kód jelentése a KIG-kódkönyvből pótlandó">kód ${esc(v)}</span>`;
  const helyF = v => { if (v === null || v === undefined || v === '') return null; const n = kt.hely.get(Number(v)); return n ? `${esc(n)} <span class="muted small">(${esc(v)})</span>` : kod(v); };
  const evF = v => (v === null || v === undefined || v === '') ? null : esc(ev(v, szul));
  const boolF = v => (v === null || v === undefined || v === '') ? null : (Number(v) === 1 ? 'igen' : Number(v) === 0 ? 'nem' : kod(v));
  const txt = v => (v === null || v === undefined || v === '') ? null : esc(v);
  const fb = fid => { const f = kt.forras.get(fid); return f ? forrasBadge(f.megnevezes, f.fazis) : ''; };
  // az állítások (javítások) felülírják a megjelenített értéket, a régi érték megmarad tooltipben
  const allit = {};
  (P.allitasok || []).filter(a => a.elfogadott !== false).forEach(a => { allit[a.tabla + '.' + a.mezo] = a; });
  const ertek = (tabla, mezo, sor) => { const a = allit[tabla + '.' + mezo]; return a ? { v: a.ertek, forras: a.forras_id, javitva: sor ? sor[mezo] : null } : { v: sor ? sor[mezo] : null, forras: sor ? sor.forras_id : null }; };
  const kvSor = (cim, html, forras) => html === null || html === undefined ? '' : `<div>${esc(cim)}</div><div>${html} ${forras ? fb(forras) : ''}</div>`;
  const kvBlokk = (sorok) => { const h = sorok.join(''); return h ? `<div class="kv">${h}</div>` : '<p class="muted">Nincs adat.</p>'; };
  const mezo = (tabla, sor, m, cim, f) => { const e = ertek(tabla, m, sor); const h = f(e.v); return kvSor(cim, h === null ? null : h + (e.javitva !== undefined && allit[tabla + '.' + m] ? ` <span class="muted small" title="Eredeti érték">(eredetileg: ${esc(e.javitva ?? '—')})</span>` : ''), e.forras); };
  // táblázat: csak a kitöltött oszlopok
  const tabla = (sorok, oszlopok) => {
    if (!sorok || !sorok.length) return '<p class="muted">Nincs adat.</p>';
    const aktiv = oszlopok.filter(o => sorok.some(s => { const v = o.f ? o.f(s) : s[o.k]; return v !== null && v !== undefined && v !== ''; }));
    return `<div class="tbl-wrap"><table><thead><tr>${aktiv.map(o => `<th>${esc(o.c)}</th>`).join('')}<th>Forrás</th></tr></thead><tbody>${
      sorok.map(s => `<tr>${aktiv.map(o => { const v = o.f ? o.f(s) : txt(s[o.k]); return `<td class="${o.cls || ''}">${v ?? '<span class="muted">—</span>'}</td>`; }).join('')}<td>${fb(s.forras_id)}</td></tr>`).join('')}</tbody></table></div>`;
  };
  const szakasz = (cim, html, db) => `<section class="card szakasz"><h3>${esc(cim)}${db ? ` <span class="muted small">(${db})</span>` : ''}</h3>${html}</section>`;
  const pozkod = s => ['1914', '1922', '1928', '1933', '1938', '1942', '1947'].filter(y => s['pozkod_' + y] !== null && s['pozkod_' + y] !== undefined).map(y => `${y}: ${s['pozkod_' + y]}`).join(', ') || null;

  // --- szakaszok ---
  const alap = kvBlokk([
    mezo('tbl_szemelyek', sz, 'szuletesiev', 'Születési év', evF),
    mezo('tbl_szemelyek', sz, 'szuletesihely', 'Születési hely', txt),
    mezo('tbl_szemelyek', sz, 'szuletesiorszagkod', 'Születési vármegye / ország', helyF),
    mezo('tbl_szemelyek', sz, 'nemzetisegkod', 'Nemzetiség (vélelmezett)', kod),
    mezo('tbl_szemelyek', sz, 'doktoricim', 'Doktori cím', boolF),
    mezo('tbl_szemelyek', sz, 'szerzetese', 'Szerzetes', boolF),
    mezo('tbl_elittag_reszletek', r, 'szerzetesrende', 'Szerzetesrend', v => v === null || v === undefined ? null : (kt.szerzetes.get(Number(v)) ? esc(kt.szerzetes.get(Number(v))) : kod(v))),
    mezo('tbl_elittag_reszletek', r, 'szerzetesbelepesev', 'Rendbe lépés éve', evF),
    mezo('tbl_elittag_reszletek', r, 'szerzeteskilepesev', 'Rendből kilépés éve', evF),
  ]);
  const halal = kvBlokk([
    kvSor('Halálozás ideje', [ertek('tbl_elittag_reszletek', 'halalev', r).v ? ev(ertek('tbl_elittag_reszletek', 'halalev', r).v, szul) : null, r.halalho, r.halalnap].filter(x => x !== null && x !== undefined && x !== '').map(esc).join('. ') || null, r.forras_id),
    mezo('tbl_elittag_reszletek', r, 'halalhely', 'Halálozás helye', txt),
    mezo('tbl_elittag_reszletek', r, 'halalhelymegyekod', 'Halálozás vármegye / ország', helyF),
    mezo('tbl_elittag_reszletek', r, 'halalmodja', 'Halál módja', kod),
    mezo('tbl_elittag_reszletek', r, 'halalmodjaegyeb', 'Halál módja (szövegesen)', txt),
    mezo('tbl_elittag_reszletek', r, 'halalpontose', 'Halálozási adat pontossága', kod),
  ]);
  const csaladiAllapot = kvBlokk([
    mezo('tbl_elittag_reszletek', r, 'testverekszama', 'Testvérek száma', txt),
    mezo('tbl_elittag_reszletek', r, 'hazassagokszama', 'Házasságok száma', txt),
    mezo('tbl_elittag_reszletek', r, 'elsohazassagev', 'Első házasság éve', evF),
    mezo('tbl_elittag_reszletek', r, 'hazaskor', 'Életkor a házasságkötéskor', txt),
    mezo('tbl_elittag_reszletek', r, 'gyerekekszama', 'Gyerekek száma', txt),
    mezo('tbl_elittag_reszletek', r, 'csaladiallapot1928', 'Családi állapot 1928', kod),
    mezo('tbl_elittag_reszletek', r, 'csaladiallapot1938', 'Családi állapot 1938', kod),
    mezo('tbl_elittag_reszletek', r, 'csaladiallapot1942', 'Családi állapot 1942', kod),
    mezo('tbl_elittag_reszletek', r, 'apahalalev', 'Apa halála (kategória)', kod),
    mezo('tbl_elittag_reszletek', r, 'anyahalalev', 'Anya halála (kategória)', kod),
  ]);
  const vallas = tabla(P.vallas, [
    { c: 'Felekezet', f: s => s.jelenlegivallas === null ? null : `${esc(VALLAS[s.jelenlegivallas] ?? '')} ${kod(s.jelenlegivallas)}${VALLAS[s.jelenlegivallas] ? ' <span class="muted small">(vélelmezett)</span>' : ''}` },
    { c: 'Áttérés', f: s => s.regivallas === null && s.ujvallas === null ? null : `${esc(VALLAS[s.regivallas] ?? 'kód ' + s.regivallas)} → ${esc(VALLAS[s.ujvallas] ?? 'kód ' + s.ujvallas)}` },
    { c: 'Áttérés éve', f: s => evF(s.vallasvaltoztataseve) },
  ]);
  const nemes = kvBlokk([
    ...(P.nemesseg || []).flatMap(n => [kvSor('Nemes', boolF(n.nemese), n.forras_id), kvSor('Nemesség éve', evF(n.nemessegeve), n.forras_id),
      kvSor('Főnemesi rang', kod(n.fonemese), n.forras_id), kvSor('Főnemesség éve', evF(n.fonemessegeve), n.forras_id)]),
    ...(P.nevvaltoztatasok || []).map(n => kvSor('Névváltoztatás éve', evF(n.nevvaltoztataseve), n.forras_id)),
  ]);
  const tanul = tabla(P.tanulmanyok, [
    { c: 'Szint', f: s => esc({ altalanos: 'alapfok', kozep: 'középfok', felso: 'felsőfok' }[s.iskolatipus] || s.iskolatipus) },
    { c: 'Intézmény', f: s => s.egyetem ? esc(s.egyetem) + (s.egyetem_kar !== null && s.egyetem_kar !== undefined ? ` <span class="muted small">(kar: ${esc(s.egyetem_kar)})</span>` : '') : (s.iskola ? `${esc(s.iskola)} <span class="muted small">${esc(s.iskola_hely || '')}</span>` : null) },
    { c: 'Évek', f: s => (s.kezdoev === null && s.befejezesev === null) ? null : idoszak(s.kezdoev, s.befejezesev, szul) },
    { c: 'Szak', k: 'szak' },
    { c: 'Diploma éve', f: s => evF(s.diplomaev) },
    { c: 'Diploma fajtája', f: s => kod(s.diplomafajta) },
    { c: 'Tanítási nyelv', f: s => kod(s.tanitasinyelv) },
    { c: 'Végzettség', f: s => kod(s['vegzettségkod']) },
  ]);
  const karrier = P.karrier && P.karrier.length ? `<div class="tbl-wrap"><table id="kar-tbl"><thead><tr><th>Időszak</th><th>Foglalkozás</th><th>Munkahely</th><th>Helyszín</th><th>Forrás</th><th>Harmonizált</th><th>Hivatás1</th><th>Hivatás2</th><th>Specifikáció</th><th>Állapot</th></tr></thead><tbody>${
    P.karrier.map(k => `<tr ${k.harm_id ? `class="click" data-h="${k.harm_id}"` : ''}><td>${idoszak(k.elsoev, k.utolsoev)}${k.leiras && k.leiras.startsWith('? kód') ? ` <span class="badge b-warn">${esc(k.leiras)}</span>` : ''}</td>
      <td>${dash(k.foglalkozas)}</td><td class="small">${dash(k.munkahely)}</td><td class="small">${dash(k.helyszin)}</td><td>${forrasBadge(k.forras, k.fazis)}</td>
      <td>${dash(k.harmonizalt)}</td><td>${dash(k.hivatas1)}</td><td>${dash(k.hivatas2)}</td><td class="small">${dash(k.specifikacio)}</td>
      <td>${k.harm_id ? allapotBadge(k.harm_allapot) : '<span class="muted small">nincs besorolva</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Nincs karrieradat.</p>';
  const karrierpoz = tabla(P.karrierpoziciok, [{ c: 'Belépés éve', f: s => evF(s.belepesev) }, { c: 'Pozíciókód évenként', f: s => pozkod(s), cls: 'small' }]);
  const csalad = tabla(P.csalad, [
    { c: 'Viszony', f: s => esc(SZEREP[s.szerep] || (s.szerep || '').toLowerCase().replace('_', ' ') || s.viszony) },
    { c: 'Név', f: s => esc(s.nev) },
    { c: 'Született', f: s => [s.szuletesiev ? ev(s.szuletesiev) : null, s.szuletesihely].filter(Boolean).map(esc).join(', ') || null },
    { c: 'Házasságból', f: s => s.hazassagbol ? esc(s.hazassagbol) + '.' : null },
    { c: 'Foglalkozás', f: s => (s.foglalkozasok || []).map(f => `${esc(f.foglalkozas)} <span class="muted small">(${esc((f.mikor || '').replace(' foglalkozás', ''))})</span>`).join('; ') || null, cls: 'small' },
  ]);
  const kitKulfNev = s => {
    const orszag = kt.hely.get(Number(s.orszagkod));
    const t = kt.kitKulf.find(k => Number(k.kodertek) === Number(s.kituntetekod) && orszag && (orszag.startsWith(k.orszag) || k.orszag.startsWith(orszag.split(' ')[0])));
    return t ? esc(t.kituntetenev) : `${kod(s.kituntetekod)}`;
  };
  const kituntetes = [
    P.kituntetes_hazai?.length ? '<h4>Hazai kitüntetések</h4>' + tabla(P.kituntetes_hazai, [
      { c: 'Kitüntetés', f: s => kt.kitHazai.get(Number(s.kituntetekod)) ? esc(kt.kitHazai.get(Number(s.kituntetekod))) : kod(s.kituntetekod) }, { c: 'Év', f: s => evF(s.ev) }]) : '',
    P.kituntetes_kulfoldi?.length ? '<h4>Külföldi kitüntetések</h4>' + tabla(P.kituntetes_kulfoldi, [
      { c: 'Ország', f: s => helyF(s.orszagkod) }, { c: 'Kitüntetés', f: kitKulfNev }, { c: 'Lista', k: 'lista' }, { c: 'Év', f: s => evF(s.ev) }]) : '',
    P.csapat_ermek?.length ? '<h4>Címek, érmek (CA/CE)</h4>' + tabla(P.csapat_ermek, [{ c: 'Típus', k: 'tipus' }, { c: 'Kód', f: s => kod(s.kituntetekod) }, { c: 'Év', f: s => evF(s.ev) }]) : '',
    P.dijak?.length ? '<h4>Díjak</h4>' + tabla(P.dijak, [{ c: 'Díj', k: 'dijaknev' }, { c: 'Adományozó', k: 'dijakkod' }, { c: 'Helyszín', f: s => helyF(s.helyszinkod) }, { c: 'Év', f: s => evF(s.ev) }]) : '',
    P.diszdoktoratus?.length ? '<h4>Díszdoktorátus</h4>' + tabla(P.diszdoktoratus, [{ c: 'Egyetem', k: 'egyetemkod' }, { c: 'Helyszín', f: s => helyF(s.helyszinkod) }, { c: 'Év', f: s => evF(s.ev) }]) : '',
    P.akad_kituntetesek?.length ? '<h4>Külföldi akadémiai tagság</h4>' + tabla(P.akad_kituntetesek, [{ c: 'Akadémia', k: 'szervezetnev' }, { c: 'Ország', f: s => helyF(s.orszagkod) }, { c: 'Tagság', f: s => kod(s.kituntetekod) }, { c: 'Év', f: s => evF(s.ev) }]) : '',
  ].join('');
  const katonai = tabla(P.katonai, [
    { c: 'Világháború', k: 'vilaghaborukod' }, { c: 'Kategória', f: s => kod(s.kategoria) }, { c: 'Rendfokozat', f: s => kod(s.rendfokozat) },
    { c: 'Front (hónap)', f: s => [s.frontzaszlo1 !== null ? `${s.frontzaszlo1}${s.frontzaszlo1honap !== null ? ' (' + s.frontzaszlo1honap + ')' : ''}` : null, s.frontzaszlo2 !== null ? `${s.frontzaszlo2}${s.frontzaszlo2honap !== null ? ' (' + s.frontzaszlo2honap + ')' : ''}` : null].filter(Boolean).join('; ') || null },
    { c: 'Sebesülések', k: 'sebesulesekszama' }, { c: 'Vitéz', f: s => boolF(s.viteze) }, { c: 'Munkaszolgálat', f: s => boolF(s.munkaszolgalate) },
  ]);
  const kulfold = tabla(P.kulfold, [{ c: 'Ország', f: s => helyF(s.orszagkod) }, { c: 'Időszak', f: s => (s.kezdoev === null && s.vegev === null) ? null : idoszak(s.kezdoev, s.vegev, szul) }]);
  const szerv = [
    P.szervezet_belfold?.length ? '<h4>Belföldi szervezetek</h4>' + tabla(P.szervezet_belfold, [{ c: 'Szervezet', k: 'szervezetnev' }, { c: 'Belépés', f: s => evF(s.belepesev) }, { c: 'Pozíciókód évenként', f: s => pozkod(s), cls: 'small' }]) : '',
    P.szervezet_kulfold?.length ? '<h4>Külföldi szervezetek</h4>' + tabla(P.szervezet_kulfold, [{ c: 'Szervezet', k: 'szervezetnev' }, { c: 'Ország', f: s => helyF(s.orszagkod) }, { c: 'Pozíciókód évenként', f: s => pozkod(s), cls: 'small' }]) : '',
  ].join('');
  const egyebPol = (P.egyeb_politikai || []).map(s => kvBlokk(Object.entries(s).filter(([k, v]) => v !== null && v !== '' && !['azonosító', 'szemelyid', 'forras_id', 'rogzitve', 'elfogadott'].includes(k)).map(([k, v]) => kvSor(k, isNaN(Number(v)) ? esc(v) : kod(v), s.forras_id)))).join('');
  const politika = [
    P.parttagsag?.length ? '<h4>Párttagság</h4>' + tabla(P.parttagsag, [{ c: 'Párt', f: s => kt.part.get(Number(s.partkod)) ? esc(kt.part.get(Number(s.partkod))) : kod(s.partkod) }]) : '',
    P.part_megfigyeles?.length ? '<h4>Párthovatartozás megfigyelési évenként</h4>' + tabla(P.part_megfigyeles, [{ c: 'Év', k: 'ev' }, { c: 'Párt', f: s => kt.part.get(Number(s.partkod)) ? esc(kt.part.get(Number(s.partkod))) : kod(s.partkod) }]) : '',
    P.felsohaz_tagsag?.length ? '<h4>Felsőházi tagság</h4>' + tabla(P.felsohaz_tagsag, [{ c: 'Jogcím', f: s => kod(s.helyszinkod) }, { c: 'Tag', f: s => boolF(s.thb_yn) }]) : '',
    P.felsohaz_pozicio?.length ? '<h4>Felsőházi pozíció</h4>' + tabla(P.felsohaz_pozicio, [{ c: 'Pozíció', f: s => kod(s.jelkod) }]) : '',
    P.parl_bizottsag?.length ? '<h4>Parlamenti bizottság</h4>' + tabla(P.parl_bizottsag, [{ c: 'Év', k: 'ev' }, { c: 'Ház', f: s => esc({ F: 'felsőház', A: 'alsóház' }[s.tipus] || s.tipus) }, { c: 'Szerep', k: 'szerep' }, { c: 'Bizottságok száma', k: 'ertek' }]) : '',
    egyebPol ? '<h4>Egyéb politikai adatok</h4>' + egyebPol : '',
    P.perek?.length ? '<h4>Perek, ítéletek</h4>' + tabla(P.perek, [{ c: 'Eljárás', f: s => esc(PER_TIPUS[s.tipuskod] || s.tipuskod) }, { c: 'Ügy', f: s => kod(s.ugycod) }]) : '',
    P.zsidotorvenyek?.length ? '<h4>Zsidótörvények</h4>' + (P.zsidotorvenyek || []).map(s => kvBlokk(Object.entries(s).filter(([k, v]) => v !== null && k.startsWith('zst')).map(([k, v]) => kvSor(ZST[k] || k, k.endsWith('mi') && kt.zst.get(Number(v)) ? esc(kt.zst.get(Number(v))) : (k.endsWith('in') || k === 'zst_szul' || k === 'zst_fele' ? boolF(v) : esc(v)), s.forras_id)))).join('') : '',
  ].join('');
  const vagyon = [
    P.vagyon?.length ? tabla(P.vagyon, [{ c: 'Év', k: 'ev' }, { c: 'Fizetés', k: 'fizetes' }, { c: 'Öröklés', k: 'orokles' }, { c: 'Háztartás', k: 'haztartas' }, { c: 'Igazgatósági tagság', k: 'igazgatosagitag' }, { c: 'Forgalmi adó (kórház)', k: 'forgotokkorhaz' }]) : '',
    P.lakas?.length ? '<h4>Lakás (1942)</h4>' + (P.lakas || []).map(s => kvBlokk(Object.entries(s).filter(([k, v]) => v !== null && v !== 0 && !['lakasid', 'szemelyid', 'forras_id', 'rogzitve', 'elfogadott', 'ev'].includes(k)).map(([k, v]) => kvSor(LAKAS[k] || k, esc(v), null)))).join('') : '',
    P.haztartas?.length ? '<h4>Háztartás (1942)</h4>' + tabla(P.haztartas, [{ c: 'Jelenlévők', k: 'jelenlevokszama' }, { c: 'Távollévők', k: 'tavollevokszama' }, { c: 'Háztartási alkalmazott', k: 'haztartasialkalmazottak' }, { c: 'Gyerekek', k: 'gyerekek' }, { c: 'Más rokon', k: 'masrokon' }]) : '',
  ].join('');
  const nyit = P.nyitott || [];
  const db = a => (a && a.length) || 0;
  const tartalom = [
    ['alap', 'Alapadatok', `${S.donto ? '<div class="szerk-gomb"><button class="btn" id="alap-szerk">Szerkesztés</button></div>' : ''}<div id="alap-nezet"><div class="grid2"><div>${alap}</div><div>${halal}</div></div>${javitasLista(P, fb)}</div><div id="alap-urlap"></div>`],
    ['csalad', 'Család', `${csaladiAllapot}<h4>Rokonok</h4>${csalad}`, db(P.csalad)],
    ['vallas', 'Vallás', vallas, db(P.vallas)],
    ['nemesseg', 'Nemesség, névváltoztatás', nemes],
    ['tanulmanyok', 'Tanulmányok', tanul, db(P.tanulmanyok)],
    ['karrier', 'Karrier és harmonizáció', karrier + (db(P.karrierpoziciok) ? '<h4>Karrierpozíciók</h4>' + karrierpoz : '') + '<div id="detail" style="margin-top:12px"></div>', db(P.karrier)],
    ['kituntetes', 'Kitüntetések, díjak, címek', kituntetes || '<p class="muted">Nincs adat.</p>'],
    ['szervezet', 'Szervezeti tagság', szerv || '<p class="muted">Nincs adat.</p>'],
    ['politika', 'Politika, perek', politika || '<p class="muted">Nincs adat.</p>'],
    ['katonai', 'Katonai szolgálat', katonai, db(P.katonai)],
    ['kulfold', 'Külföldi tartózkodás', kulfold, db(P.kulfold)],
    ['vagyon', 'Vagyon, lakás, háztartás', vagyon || '<p class="muted">Nincs adat.</p>'],
  ];
  return { szul, nyit, tartalom, nev: `${sz.vezeteknev || ''} ${sz.keresztnev || ''}`.trim() };
}


// ---------- Alapadatok javítása ----------
const JAVITHATO = [
  ['tbl_szemelyek', 'szuletesiev', 'Születési év', 'ev'], ['tbl_szemelyek', 'szuletesihely', 'Születési hely', 'text'],
  ['tbl_szemelyek', 'szuletesiorszagkod', 'Születési vármegye / ország', 'hely'], ['tbl_szemelyek', 'nemzetisegkod', 'Nemzetiség (kód)', 'kod'],
  ['tbl_szemelyek', 'doktoricim', 'Doktori cím', 'bool'], ['tbl_szemelyek', 'szerzetese', 'Szerzetes', 'bool'],
  ['tbl_elittag_reszletek', 'szerzetesrende', 'Szerzetesrend', 'szerzetes'], ['tbl_elittag_reszletek', 'szerzetesbelepesev', 'Rendbe lépés éve', 'ev'],
  ['tbl_elittag_reszletek', 'szerzeteskilepesev', 'Rendből kilépés éve', 'ev'],
  ['tbl_elittag_reszletek', 'halalev', 'Halálozás éve', 'ev'], ['tbl_elittag_reszletek', 'halalho', 'Halálozás hónapja', 'text'],
  ['tbl_elittag_reszletek', 'halalnap', 'Halálozás napja', 'text'], ['tbl_elittag_reszletek', 'halalhely', 'Halálozás helye', 'text'],
  ['tbl_elittag_reszletek', 'halalhelymegyekod', 'Halálozás vármegye / ország', 'hely'], ['tbl_elittag_reszletek', 'halalmodja', 'Halál módja (kód)', 'kod'],
  ['tbl_elittag_reszletek', 'halalmodjaegyeb', 'Halál módja (szövegesen)', 'text'],
  ['tbl_elittag_reszletek', 'testverekszama', 'Testvérek száma', 'text'], ['tbl_elittag_reszletek', 'hazassagokszama', 'Házasságok száma', 'text'],
  ['tbl_elittag_reszletek', 'elsohazassagev', 'Első házasság éve', 'ev'], ['tbl_elittag_reszletek', 'hazaskor', 'Életkor a házasságkötéskor', 'text'],
  ['tbl_elittag_reszletek', 'gyerekekszama', 'Gyerekek száma', 'text'],
  ['tbl_elittag_reszletek', 'csaladiallapot1928', 'Családi állapot 1928 (kód)', 'kod'], ['tbl_elittag_reszletek', 'csaladiallapot1938', 'Családi állapot 1938 (kód)', 'kod'],
  ['tbl_elittag_reszletek', 'csaladiallapot1942', 'Családi állapot 1942 (kód)', 'kod'],
];
function aktualis(P, tabla, mezo) {
  const a = (P.allitasok || []).filter(x => x.elfogadott !== false && x.tabla === tabla && x.mezo === mezo).pop();
  if (a) return a.ertek;
  const sor = tabla === 'tbl_szemelyek' ? P.szemely : P.reszletek;
  const v = sor ? sor[mezo] : null;
  return v === null || v === undefined ? '' : String(v);
}
function javitasLista(P, fb) {
  const a = (P.allitasok || []);
  if (!a.length) return '';
  const nev = Object.fromEntries(JAVITHATO.map(j => [j[0] + '.' + j[1], j[2]]));
  return `<h4>Javítások</h4><div class="tbl-wrap"><table><thead><tr><th>Mező</th><th>Új érték</th><th>Forrás</th><th>Hivatkozás</th><th>Ki, mikor</th><th></th></tr></thead><tbody>${
    a.slice().reverse().map(x => `<tr class="${x.elfogadott === false ? 'visszavont' : ''}"><td>${esc(nev[x.tabla + '.' + x.mezo] || x.mezo)}</td><td>${dash(x.ertek)}</td><td>${fb(x.forras_id)} ${esc((S.kt.forras.get(x.forras_id) || {}).megnevezes || '')}</td>
      <td class="small">${dash(x.hivatkozas)}${x.megjegyzes ? `<br><span class="muted">${esc(x.megjegyzes)}</span>` : ''}</td><td class="small">${esc(x.rogzitette || '')}<br>${new Date(x.rogzitve).toLocaleString('hu-HU')}</td>
      <td>${x.elfogadott === false ? '<span class="badge b-gray">visszavonva</span>' : (S.donto ? `<button class="btn small" data-visszavon="${x.allitas_id}">Visszavonás</button>` : '')}</td></tr>`).join('')}</tbody></table></div>`;
}
function forrasValaszto(prefix) {
  const fr = [...S.kt.forras.values()].filter(f => f.fazis !== 'KIG-féle kutatás' && !/^(harmonizációs|kódlista|kódolói)/.test(f.tipus || ''));
  return `<fieldset class="forras-box"><legend>Forrás (kötelező)</legend>
    <label>Forrás<select id="${prefix}-fs"><option value="">— válassz —</option>${fr.map(f => `<option value="${f.forras_id}">${esc(f.megnevezes)}</option>`).join('')}<option value="uj">+ Új forrás felvétele…</option></select></label>
    <div id="${prefix}-uj" class="hidden form" style="margin-top:0">
      <label>Új forrás megnevezése<input id="${prefix}-un" placeholder="pl. Magyar Életrajzi Lexikon 1–4."></label>
      <label>Típusa<select id="${prefix}-ut"><option>szakirodalom</option><option>levéltári forrás</option><option>lexikon, adattár</option><option>sajtó</option><option>internetes forrás</option><option>egyéb</option></select></label>
    </div>
    <label>Pontos hivatkozás (oldal, jelzet, URL)<input id="${prefix}-hiv" placeholder="pl. II. köt. 214. o. / MNL OL K 27 / https://…"></label>
    <label>Megjegyzés<textarea id="${prefix}-megj"></textarea></label></fieldset>`;
}
async function forrasAzonosito(prefix) {
  const v = $('#' + prefix + '-fs').value;
  if (!v) throw new Error('Válassz forrást, vagy vegyél fel újat.');
  if (v !== 'uj') return Number(v);
  const nev = $('#' + prefix + '-un').value.trim();
  if (!nev) throw new Error('Add meg az új forrás megnevezését.');
  const { data } = await q(sb.rpc('forras_felvesz', { p_megnevezes: nev, p_tipus: $('#' + prefix + '-ut').value, p_hivatkozas: null }));
  S.kt = null; await kodtablak();
  return data;
}
function alapSzerkeszt(P, id) {
  const kt = S.kt, szul = ev(P.szemely.szuletesiev);
  const helyOpt = [...kt.hely.entries()].sort((a, b) => a[1].localeCompare(b[1], 'hu')).map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join('');
  const szerzOpt = [...kt.szerzetes.entries()].map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join('');
  const mezo = ([t, m, cim, tip]) => {
    let v = aktualis(P, t, m); if (tip === 'ev' && v !== '') v = String(ev(v, szul));
    const idd = `f-${t}-${m}`;
    let inp;
    if (tip === 'hely') inp = `<select id="${idd}"><option value="">—</option>${helyOpt}${v && !kt.hely.has(Number(v)) ? `<option value="${esc(v)}">kód ${esc(v)}</option>` : ''}</select>`;
    else if (tip === 'bool') inp = `<select id="${idd}"><option value="">—</option><option value="1">igen</option><option value="0">nem</option></select>`;
    else if (tip === 'szerzetes') inp = `<select id="${idd}"><option value="">—</option>${szerzOpt}</select>`;
    else inp = `<input id="${idd}" ${tip === 'ev' ? 'inputmode="numeric" placeholder="éééé"' : ''}>`;
    return `<label data-k="${t}.${m}" data-tip="${tip}" data-eredeti="${esc(v)}">${esc(cim)}${inp}</label>`;
  };
  const box = $('#alap-urlap');
  $('#alap-nezet').classList.add('hidden'); $('#alap-szerk').classList.add('hidden');
  box.innerHTML = `<form id="alap-f" class="form"><p class="muted small">Csak a megváltoztatott mezők mentődnek, új bejegyzésként; az eredeti érték megmarad és visszakereshető.</p>
    <div class="szerk-racs">${JAVITHATO.map(mezo).join('')}</div>${forrasValaszto('af')}
    <div class="toolbar"><button class="btn primary" type="submit">Mentés</button><button class="btn" type="button" id="alap-megse">Mégse</button></div><div id="alap-msg"></div></form>`;
  box.querySelectorAll('label[data-k]').forEach(l => { const el = l.querySelector('input,select'); el.value = l.dataset.eredeti; });
  $('#af-fs').addEventListener('change', e => $('#af-uj').classList.toggle('hidden', e.target.value !== 'uj'));
  $('#alap-megse').addEventListener('click', () => { box.innerHTML = ''; $('#alap-nezet').classList.remove('hidden'); $('#alap-szerk').classList.remove('hidden'); });
  $('#alap-f').addEventListener('submit', async e => {
    e.preventDefault();
    const valt = {};
    const btn = e.target.querySelector('button[type=submit]');
    try {
      box.querySelectorAll('label[data-k]').forEach(l => {
        const uj = l.querySelector('input,select').value.trim();
        if (uj !== l.dataset.eredeti) {
          if (l.dataset.tip === 'ev' && uj && !/^\d{4}$/.test(uj)) throw new Error(`${l.firstChild.textContent}: négyjegyű évszámot adj meg.`);
          valt[l.dataset.k] = uj;
        }
      });
      if (!Object.keys(valt).length) { msg($('#alap-msg'), 'Nem változott semmi.', 'info'); return; }
      btn.disabled = true;
      const fid = await forrasAzonosito('af');
      await q(sb.rpc('javit_mezok', { p_szemelyid: id, p_valtozasok: valt, p_forras_id: fid, p_hivatkozas: $('#af-hiv').value || null, p_megjegyzes: $('#af-megj').value || null }));
      msg($('#alap-msg'), `${Object.keys(valt).length} mező javítása rögzítve.`, 'ok');
      setTimeout(() => szemelyLap(id).then(() => $('#sz-alap')?.scrollIntoView()), 800);
    } catch (err) { btn.disabled = false; hibaKiir($('#alap-msg'), err); }
  });
}

async function szemelyLap(id) {
  location.hash = 'szemely=' + id;
  app.innerHTML = '<div class="empty">Betöltés…</div>';
  try {
    await kodtablak();
    const { data: P } = await q(sb.rpc('szemely_osszes', { p_id: id }));
    if (!P || !P.szemely) { app.innerHTML = '<div class="empty">Nincs ilyen személy.</div>'; return; }
    const R = profilRender(P, id);
    const sz = P.szemely;
    app.innerHTML = `<p><a href="#" id="vissza">‹ Vissza a listához</a></p>
      <div class="fejlec"><div><h2>${esc(R.nev)}</h2>
        <p class="muted">${R.szul ? esc(R.szul) : '?'}${P.reszletek && P.reszletek.halalev ? '–' + esc(ev(P.reszletek.halalev, R.szul)) : ''} · ${esc(sz.szuletesihely || '')} · SzemélyID: ${id}</p></div>
        <nav class="ugro">${R.tartalom.map(t => `<a href="#" data-ugro="${t[0]}">${esc(t[1])}</a>`).join('')}</nav></div>
      <div class="legend"><span>${forrasBadge('KIG-féle kutatás', 'KIG-féle kutatás')} KIG-féle kutatás</span><span>${forrasBadge('x', 'ElitData2026')} ElitData2026</span><span><span class="kod">kód N</span> a jelentése a KIG-kódkönyvből pótlandó</span></div>
      ${R.nyit.length ? `<div class="msg info">${R.nyit.length} nyitott kérdés: ${R.nyit.map(n => esc(n.tipus)).join(', ')}.</div>` : ''}
      ${R.tartalom.map(([k, cim, html, n]) => `<div id="sz-${k}">${`<section class="card szakasz"><h3>${esc(cim)}${n ? ` <span class="muted small">(${n})</span>` : ''}</h3>${html}</section>`}</div>`).join('')}`;
    $('#vissza').addEventListener('click', e => { e.preventDefault(); szemelyekLap(); });
    $('#alap-szerk')?.addEventListener('click', () => alapSzerkeszt(P, id));
    app.querySelectorAll('[data-visszavon]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Biztosan visszavonod ezt a javítást? Az eredeti érték lesz ismét érvényes.')) return;
      try { await q(sb.rpc('javitas_visszavon', { p_allitas_id: Number(b.dataset.visszavon) })); szemelyLap(id); } catch (err) { alert('Hiba: ' + (err.message || err)); }
    }));
    app.querySelectorAll('[data-ugro]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); $('#sz-' + a.dataset.ugro).scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
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
