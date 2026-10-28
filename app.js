// ElitData ellenőrző felület
// Az adatok a Supabase-ben vannak; olvasni csak a munkatárslistán szereplő, bejelentkezett felhasználók tudnak,
// javítani mindenki a saját körében tud: akihez csoport (pl. orvosok) van rendelve, csak annak tagjait;
// a mindenkit érintő szabálydöntéseket csak a korlátozás nélküli munkatársak hozhatják (adatbázis-oldali ellenőrzés).
'use strict';

const SUPABASE_URL = 'https://rrvdpkxcaptngzkkblxd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJydmRwa3hjYXB0bmd6a2tibHhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0ODM4NzEsImV4cCI6MjA5MTA1OTg3MX0.3zwmyGGRo-wdVu_9GejX_bV3Iv3BoW-mnjB-StbbAec';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const PAGE = 50;
const S = { csoportNav: null, user: null, szerep: null, donto: false, tab: 'nyitott', kodok: null, csoportjaim: [], szerkCache: new Map(), szerkEz: false };
const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');

// ---------- segédfüggvények ----------
function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const dash = v => (v === null || v === undefined || v === '' ? '<span class="muted">—</span>' : esc(v));
// harmonizált mező megjelenítése: érték · NINCS (kifejezetten nincs) · döntésre váró beírt érték (sárga) · — (nincs adat)
const HARM_CIMKE = { harmonizalt: 'harmonizált: ', hivatas1: 'Hivatás1: ', hivatas2: 'Hivatás2: ' };
const EGYEBPOL = { els_19in: '1919: érintett', els_19mi: '1919: milyen szerep', els_19_x: '1919: jelölés', kormr_in: 'Kormányzati megbízatás', kormr_mi: 'Kormányzati megbízatás: milyen',
  kormr_ev: 'Kormányzati megbízatás: év', kormr_ho: 'Kormányzati megbízatás: hónap', lager1: 'Láger', lager2: 'Láger (2.)', nyil_in: 'Nyilas üldözés: érintett', nyil_mi: 'Nyilas üldözés: mi történt',
  igb_45in: '1945 utáni igazolás: érintett', igb_45ev: 'Igazolás éve', igb_45ho: 'Igazolás hónapja', igb_45mi: 'Igazolás eredménye', igb_45it: 'Igazolás: ítélet', igb_45fr: 'Igazolás: év',
  baj48_it: '1948 utáni eljárás: ítélet', baj48_fr: '1948 utáni eljárás: év', ose56_it: '1956 utáni eljárás: ítélet', ose56_fr: '1956 utáni eljárás: év',
  ...Object.fromEntries([1, 2, 3, 4, 5, 6].flatMap(i => [[`ah${i}_tol`, `Állami hivatal ${i}: tól`], [`ah${i}_ig`, `Állami hivatal ${i}: ig`]])) };
function harmF(k, m) {
  const v = k[m];
  if (v !== null && v !== undefined && v !== '') return String(v).toUpperCase() === 'NINCS' ? 'NINCS' : esc(v);
  const cim = HARM_CIMKE[m], ny = (k.nyitott_ertekek || '').split('; ').find(x => cim && x.startsWith(cim));
  if (ny) return `<span class="badge b-warn" title="Döntésre vár – a kódoló által beírt érték">${esc(ny.slice(cim.length))} ?</span>`;
  if (k.harm_id && m !== 'hivatas2') return '<span class="badge b-warn" title="A harmonizációs sorban ez a mező üres – döntésre vár">hiányzik</span>';
  return '<span class="muted">—</span>';
}
// nem harmonizált karriersor: egyetlen cella a harmonizációs oszlopok helyén (ne keveredjen a „—” és a NINCS)
const NEMHARM = (n, cls = '') => `<td colspan="${n}" class="muted small ${cls}" style="text-align:center;font-style:italic">nincs harmonizálva</td>`;
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
  szuletesiorszagkod: 'Születési ország (kód)', nemzetisegkod: 'Nemzetiség', doktoricim: 'Doktori cím', vegzettsegid: 'Végzettség (kód)',
  szerzetese: 'Szerzetes', halalev: 'Halálozás éve', halalho: 'Halálozás hónapja', halalnap: 'Halálozás napja', halalhely: 'Halálozás helye',
  halalhelymegyekod: 'Halálozás helye (megyekód)', halalmodja: 'Halál módja (kód)', halalpontose: 'Halálozási adat pontossága',
  testverekszama: 'Testvérek száma', gyerekekszama: 'Gyerekek száma', hazassagokszama: 'Házasságok száma', elsohazassagev: 'Első házasság éve',
  hazaskor: 'Házasságkötéskori kor', csaladiallapot1928: 'Családi állapot 1928', csaladiallapot1938: 'Családi állapot 1938',
  csaladiallapot1942: 'Családi állapot 1942', anyahalalev: 'Anya halála', apahalalev: 'Apa halála', szerzetesrende: 'Szerzetesrend (kód)',
};
const REJTETT_MEZO = new Set(['elittage', 'eredetiazon1', 'eredetiazon2', 'adatforraslap', 'rogzitesdatuma']);
function msg(el, text, kind = 'info') { el.innerHTML = `<div class="msg ${kind}">${esc(text)}</div>`; }
async function q(promise) { const { data, error, count } = await promise; if (error) throw error; return { data, count }; }
function hibaSzoveg(e) {
  if (!e) return 'ismeretlen hiba';
  if (typeof e === 'string') return e;
  const t = e.message || e.details || e.hint || e.error_description || '';
  if (/statement timeout|canceling statement/i.test(t) || e.code === '57014') return 'a lekérdezés túl sokáig tartott (időtúllépés) – próbáld újra, ha tartósan fennáll, szólj.';
  return t || JSON.stringify(e);
}
function hibaKiir(el, e) { console.error(e); msg(el, 'Hiba: ' + hibaSzoveg(e), 'err'); }
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
function tavolsag(a, b) {
  a = a.toUpperCase(); b = b.toUpperCase();
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function hasonlok(ertek, vals, n = 4) {
  return vals.filter(v => v.toUpperCase() !== ertek.toUpperCase()).map(v => [v, tavolsag(ertek, v)])
    .filter(([v, t]) => t <= Math.max(2, Math.round(ertek.length / 4))).sort((x, y) => x[1] - y[1]).slice(0, n).map(x => x[0]);
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
    const { data: cs } = await q(sb.from('tbl_munkatars_csoportok').select('csoport_id, tbl_csoportok(nev)').eq('email', S.user.email.toLowerCase()));
    S.csoportjaim = (cs || []).map(c => c.tbl_csoportok?.nev).filter(Boolean);
    $('#userinfo').textContent = (m && m.nev ? m.nev : S.user.email) + (S.csoportjaim.length ? ` (javíthat: ${S.csoportjaim.join(', ')})` : '');
    document.querySelector('#tabs [data-tab=munkatarsak]')?.classList.toggle('hidden', !S.donto);
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
  ({ nyitott: nyitottLap, javaslatok: javaslatokLap, szemelyek: szemelyekLap, harm: harmLap, szabalyok: szabalyokLap, naplo: naploLap, munkatarsak: munkatarsakLap, csoportok: csoportokLap })[tab]();
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
        tetel(data[Number(tr.dataset.i)], () => lista());
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
    if (r.tipus === 'feloldatlan évkód') return await karrierSzerk(Number(r.rekord_id), d, utana);
    return await ellenorzendoReszlet(Number(r.rekord_id), d, utana);
  } catch (e) { hibaKiir(d, e); }
}
async function szerkHet(szemelyid) {
  if (!szemelyid) return S.donto;
  if (!S.szerkCache.has(szemelyid)) { const { data } = await q(sb.rpc('szerkesztheti', { p_szemelyid: szemelyid })); S.szerkCache.set(szemelyid, !!data); }
  return S.szerkCache.get(szemelyid);
}
function szemLinkek(root) {
  root.querySelectorAll('[data-szem]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); valt('szemelyek', false); szemelyLap(Number(a.dataset.szem)); }));
}

async function hatasSzamol(ids) {
  const h = { rendben: 0, var: 0, egyeb: 0, masik: [] };
  if (!ids.length) return h;
  const { data } = await q(sb.from('v_karrier_harmonizalt').select('allapot,nyitott_ertekek').in('harm_id', ids.slice(0, 300)));
  const m = new Map();
  for (const r of data) {
    if (r.allapot === 'rendben') h.rendben++; else if (r.allapot === 'döntésre vár') h.var++; else h.egyeb++;
    for (const n of (r.nyitott_ertekek || '').split('; ').filter(Boolean)) m.set(n, (m.get(n) || 0) + 1);
  }
  h.masik = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([n, k]) => `${n} (${k})`);
  return h;
}
function hatasHtml(h) {
  return `${h.rendben} rendben · ${h.var} döntésre vár${h.egyeb ? ` · ${h.egyeb} egyéb` : ''}${h.masik.length ? `<br><span class="muted small">nyitott értékek ezekben a sorokban: ${esc(h.masik.slice(0, 4).join('; '))}</span>` : ''}`;
}
function celSzoveg(s) {
  if (!s.cel_oszlop) return '';
  return esc(MEZONEV[s.cel_oszlop]) + ': ' + esc(s.cel_ertek || '') + (s.cel2_oszlop ? ' <b>+</b> ' + esc(MEZONEV[s.cel2_oszlop]) + ': ' + esc(s.cel2_ertek || '') : '');
}
// szabály részletei + döntés
async function szabalyReszlet(id, d, utana, uzenet) {
  const { data: s } = await q(sb.from('tbl_ertek_szabalyok').select('*').eq('szabaly_id', id).single());
  const col = s.oszlop + '_beirt';
  const { data: sorok, count } = await q(sb.from('tbl_karrier_harmonizalas')
    .select('harm_id,szemelyid,fajl_nev,fajl_foglalkozas,fajl_elsoev,fajl_utolsoev,harmonizalt_beirt,hivatas1_beirt,hivatas2_beirt,specifikacio_beirt,megjegyzes,forras_id', { count: 'exact' })
    .ilike(col, s.beirt_ertek.replace(/[\\%_]/g, m => '\\' + m)).order('fajl_nev').limit(300));
  const k = await kodok();
  // személyenként összevonva
  const szem = new Map();
  for (const r of sorok) {
    const key = r.szemelyid || r.fajl_nev;
    if (!szem.has(key)) szem.set(key, { ...r, sorok: 0, fogl: new Set() });
    const x = szem.get(key); x.sorok++; if (r.fajl_foglalkozas) x.fogl.add(r.fajl_foglalkozas);
  }
  const lista = s.oszlop;
  // hatás: az érintett sorok jelenlegi harmonizációs állapota
  const hatas = await hatasSzamol(sorok.map(r => r.harm_id));
  let kanon = null;
  if (s.allapot === 'összevonva') {
    const { data: ks } = await q(sb.from('tbl_ertek_szabalyok').select('szabaly_id,beirt_ertek,allapot,cel_oszlop,cel_ertek,cel2_oszlop,cel2_ertek')
      .eq('oszlop', s.oszlop).neq('allapot', 'összevonva').ilike('beirt_ertek', s.beirt_ertek.trim().replace(/[\\%_]/g, m => '\\' + m)));
    kanon = (ks || [])[0] || null;
  }
  d.innerHTML = `<div class="card">
    ${uzenet ? `<div class="msg ok small" style="margin-bottom:10px">${uzenet}</div>` : ''}
    ${kanon ? `<div class="msg info small" style="margin-bottom:10px">Ez a szabály össze van vonva a(z) <b>„${esc(kanon.beirt_ertek)}”</b> szabállyal (csak kis/nagybetűben tér el), annak döntése érvényes rá is: ${allapotBadge(kanon.allapot)} ${celSzoveg(kanon) || ''}. Ha itt döntesz, a döntés a(z) „${esc(kanon.beirt_ertek)}” szabályra kerül, és mindkét alakra érvényes lesz.</div>` : ''}
    <h3 style="margin-top:0">${esc(MEZONEV[s.oszlop])}: „${esc(s.beirt_ertek)}”</h3>
    <div class="kv small">
      <div>Állapot</div><div>${allapotBadge(s.allapot)}</div>
      <div>Típus</div><div>${dash(s.tipus)}</div>
      <div>Javaslat</div><div>${celSzoveg(s) || '<span class="muted">nincs</span>'}</div>
      <div>Érintett</div><div>${count} sor, ${szem.size} személy</div>
      <div>Jelenleg</div><div>${hatasHtml(hatas)}</div>
      ${s.dontotte ? `<div>Döntött</div><div>${esc(s.dontotte)}, ${new Date(s.dontes_ideje).toLocaleString('hu-HU')}</div>` : ''}
      ${s.megjegyzes ? `<div>Megjegyzés</div><div>${esc(s.megjegyzes)}</div>` : ''}
    </div>
    ${true ? `<form class="form" id="szf">
      <div class="opts">
        <label><input type="radio" name="mod" value="lista" checked> <span>Felvesszük a(z) <b>${esc(MEZONEV[lista])}</b> listára ebben az alakban</span></label>
        <label><input type="radio" name="mod" value="elir"> <span><b>Elírás</b> – javítjuk a helyes alakra (ugyanebben a mezőben)</span></label>
        <label><input type="radio" name="mod" value="atir"> <span>Átírjuk / áthelyezzük másik értékre vagy mezőbe</span></label>
        <label><input type="radio" name="mod" value="spec"> <span>Specifikációba kerül</span></label>
        <label><input type="radio" name="mod" value="spec2"> <span>Specifikációba kerül, <b>és</b> egy másik mezőbe más érték kerül (pl. Hivatás2: PAP)</span></label>
        <label><input type="radio" name="mod" value="elutasit"> <span>Elutasítjuk (a beírt érték érvénytelen, egyedileg kell javítani)</span></label>
      </div>
      <div id="elir" class="hidden form">
        ${(() => { const h = hasonlok(s.beirt_ertek, k[s.oszlop] || []); return h.length ? `<div class="small">Hasonló listás értékek: ${h.map(v => `<button type="button" class="btn small" data-hasonlo="${esc(v)}">${esc(v)}</button>`).join(' ')}</div>` : '<p class="muted small" style="margin:0">Nincs hasonló érték a listán – írd be a helyes alakot.</p>'; })()}
        <label>Helyes alak<input id="elire" list="dl-elir" value="${esc(s.cel_oszlop === s.oszlop && s.cel_ertek !== s.beirt_ertek ? s.cel_ertek || '' : '')}" placeholder="pl. ERDŐMÉRNÖK"></label>
        ${datalist('dl-elir', k[s.oszlop] || [])}
        <p class="muted small" style="margin:0">Ha a helyes alak még nincs a listán, a mentéskor felkerül rá. A szabály minden ugyanígy elgépelt sorra érvényes.</p>
      </div>
      <div id="atir" class="hidden form">
        <label>Célmező<select id="celo">${['harmonizalt', 'hivatas1', 'hivatas2', 'specifikacio'].map(c => `<option value="${c}" ${c === (s.cel_oszlop || s.oszlop) ? 'selected' : ''}>${MEZONEV[c]}</option>`).join('')}</select></label>
        <label>Célérték<input id="cele" list="dl-cel" value="${esc(s.cel_ertek || s.beirt_ertek)}"></label>
        <span id="dl-wrap"></span>
      </div>
      <div id="spec2" class="hidden form">
        <p class="muted small" style="margin:0">A(z) „${esc(s.beirt_ertek)}” érték a Specifikációba kerül, és minden ilyen sorban ez az érték kerül a megadott mezőbe.</p>
        <label>Mező<select id="cel2o">${['hivatas2', 'hivatas1', 'harmonizalt'].map(c => `<option value="${c}" ${c === (s.cel2_oszlop || s.oszlop) ? 'selected' : ''}>${MEZONEV[c]}</option>`).join('')}</select></label>
        <label>Érték<input id="cel2e" list="dl-cel2" value="${esc(s.cel2_ertek || '')}" placeholder="pl. PAP"></label>
        <span id="dl2-wrap"></span>
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
  if (!$('#szf', d)) return;
  const f = $('#szf', d);
  const dl = () => { $('#dl-wrap', d).innerHTML = datalist('dl-cel', k[$('#celo', d).value] || []); };
  dl(); $('#celo', d).addEventListener('change', dl);
  const dl2 = () => { $('#dl2-wrap', d).innerHTML = datalist('dl-cel2', k[$('#cel2o', d).value] || []); };
  dl2(); $('#cel2o', d).addEventListener('change', dl2);
  if (s.cel_oszlop === 'specifikacio' && s.cel2_oszlop) f.mod.value = 'spec2';
  else if (s.cel_oszlop === 'specifikacio') f.mod.value = 'spec'; else if (s.cel_oszlop === s.oszlop && s.cel_ertek && s.cel_ertek.toUpperCase() !== s.beirt_ertek.toUpperCase()) f.mod.value = 'elir';
  else if (s.cel_oszlop && s.cel_oszlop !== s.oszlop || (s.cel_ertek && s.cel_ertek !== s.beirt_ertek)) f.mod.value = 'atir';
  d.querySelectorAll('[data-hasonlo]').forEach(b => b.addEventListener('click', () => { $('#elire', d).value = b.dataset.hasonlo; }));
  const mutat = () => { $('#elir', d).classList.toggle('hidden', f.mod.value !== 'elir'); $('#atir', d).classList.toggle('hidden', f.mod.value !== 'atir'); $('#spec2', d).classList.toggle('hidden', f.mod.value !== 'spec2'); };
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
      } else if (f.mod.value === 'elir') {
        const v = $('#elire', d).value.trim();
        if (!v) throw new Error('Add meg a helyes alakot.');
        if (v.toUpperCase() === s.beirt_ertek.trim().toUpperCase()) throw new Error('A helyes alak megegyezik a beírt értékkel – ilyenkor a „Felvesszük a listára” lehetőséget válaszd.');
        const listan = (k[s.oszlop] || []).find(x => x.toUpperCase() === v.toUpperCase());
        if (!listan) {
          if (!confirm(`A(z) „${v}” még nincs a(z) ${MEZONEV[s.oszlop]} listán. Felvegyük?`)) { btn.disabled = false; return; }
          await q(sb.rpc('lista_bovit', { p_lista: s.oszlop, p_ertek: v, p_meghatarozas: null }));
          S.kodok = null;
        }
        await q(sb.rpc('dont_szabaly', { p_szabaly_id: id, p_allapot: 'elfogadva', p_cel_oszlop: s.oszlop, p_cel_ertek: listan || v, p_megjegyzes: megj || 'Elírás javítása' }));
      } else if (f.mod.value === 'atir') {
        await q(sb.rpc('dont_szabaly', { p_szabaly_id: id, p_allapot: 'elfogadva', p_cel_oszlop: $('#celo', d).value, p_cel_ertek: $('#cele', d).value, p_megjegyzes: megj || null }));
      } else if (f.mod.value === 'spec2') {
        const v2 = $('#cel2e', d).value.trim();
        if (!v2) throw new Error('Add meg, milyen érték kerüljön a(z) ' + MEZONEV[$('#cel2o', d).value] + ' mezőbe.');
        await q(sb.rpc('dont_szabaly', { p_szabaly_id: id, p_allapot: 'elfogadva', p_cel_oszlop: 'specifikacio', p_cel_ertek: s.beirt_ertek, p_megjegyzes: megj || null, p_cel2_oszlop: $('#cel2o', d).value, p_cel2_ertek: v2 }));
      } else if (f.mod.value === 'spec') {
        await q(sb.rpc('dont_szabaly', { p_szabaly_id: id, p_allapot: 'elfogadva', p_cel_oszlop: 'specifikacio', p_cel_ertek: s.beirt_ertek, p_megjegyzes: megj || null }));
      } else {
        await q(sb.rpc('dont_szabaly', { p_szabaly_id: id, p_allapot: 'elutasítva', p_cel_oszlop: null, p_cel_ertek: null, p_megjegyzes: megj || null }));
      }
      const uj = await hatasSzamol(sorok.map(r => r.harm_id));
      const valt = uj.rendben - hatas.rendben;
      await szabalyReszlet(id, d, utana, `<b>Döntés rögzítve.</b> ${valt > 0 ? `${valt} sor került „rendben” állapotba.` : 'A sorok állapota nem változott.'} ${uj.var ? `${uj.var} sor továbbra is döntésre vár, mert bennük <b>másik mező</b> is nyitott (pl. ${esc(uj.masik.slice(0, 3).join('; '))}).` : ''}${s.allapot === 'elfogadva' && valt === 0 ? ' Ez a szabály már korábban is érvényben volt, ezért a döntés nem változtatott az adatokon.' : ''}`);
      if (utana) utana();
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
  const szerk = true; // a harmonizációt minden munkatárs szerkesztheti
  const sor = m => `<tr><td>${MEZONEV[m]}</td><td>${dash(h[m + '_beirt'])}</td><td><b>${dash(v[m])}</b></td><td>${dash(h[m + '_egyedi'])}</td></tr>`;
  d.innerHTML = `<div class="card">
    <h3 style="margin-top:0">${h.szemelyid ? `<a href="#szemely=${h.szemelyid}" data-szem="${h.szemelyid}">${esc(h.fajl_nev)}</a>` : esc(h.fajl_nev)}</h3>
    <div class="kv small">
      <div>Állapot</div><div>${allapotBadge(v.allapot)} ${v.nyitott_ertekek ? `<span class="muted">${esc(v.nyitott_ertekek)}</span>` : ''}</div>
      <div>Karrierállomás</div><div>${esc(h.fajl_foglalkozas || '')} · ${esc(h.fajl_munkahely || '')} · ${esc([h.fajl_elsoev, h.fajl_utolsoev].filter(Boolean).join('–'))}</div>
      <div>Forrás</div><div>${forrasBadge(f.megnevezes, f.fazis)} ${esc(f.megnevezes)} (${esc(h.fajl_munkalap || '')}, ${esc(h.fajl_sor || '')}. sor)</div>
      ${h.megjegyzes ? `<div>Kódolói megjegyzés</div><div>${esc(h.megjegyzes)}</div>` : ''}
      ${h.jeloles ? `<div>Jelölés</div><div>${esc(h.jeloles)}</div>` : ''}
      ${[['hierarchia_beirt', 'Hierarchia'], ['agazat_beirt', 'Ágazat'], ['hangszer_beirt', 'Hangszer'], ['statusz_beirt', 'Státusz']].filter(([m]) => h[m]).map(([m, c]) => `<div>${c}</div><div>${esc(h[m])}</div>`).join('')}
      ${h.egyedi_dontotte ? `<div>Egyedi döntés</div><div>${esc(h.egyedi_dontotte)}, ${new Date(h.egyedi_ideje).toLocaleString('hu-HU')}${h.egyedi_megjegyzes ? ' – ' + esc(h.egyedi_megjegyzes) : ''}</div>` : ''}
    </div>
    <h3>Besorolás</h3>
    <div class="tbl-wrap"><table><thead><tr><th>Mező</th><th>Beírt</th><th>Érvényes</th><th>Egyedi döntés</th></tr></thead><tbody>
      ${['harmonizalt', 'hivatas1', 'hivatas2', 'specifikacio'].map(sor).join('')}</tbody></table></div>
    ${szerk && h.karrierid ? `<form class="form" id="egf">
      <h3>Egyedi döntés erre a sorra</h3>
      <label>Mező<select id="egm">${['hivatas1', 'hivatas2', 'harmonizalt', 'specifikacio'].map(m => `<option value="${m}">${MEZONEV[m]}</option>`).join('')}</select></label>
      <label>Érték (üresen hagyva: az egyedi döntés törlése)<input id="ege" list="dl-eg"></label><span id="dl-eg-w"></span>
      <label>Megjegyzés<textarea id="egj"></textarea></label>
      <button class="btn primary" type="submit">Rögzítés</button><div id="egmsg"></div></form>` : ''}
    ${!h.karrierid ? '<p class="muted small">Ez a sor nem párosítható karrierállomással; a forrásfájlban kell ellenőrizni.</p>' : ''}
  </div>`;
  szemLinkek(d);
  if (!(szerk && h.karrierid)) return;
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
  const szerk = true; // a nyitott kérdéseket minden munkatárs lezárhatja
  d.innerHTML = `<div class="card"><h3 style="margin-top:0">${esc(e.tipus)}</h3>
    <div class="kv small">
      ${e.szemelyid ? `<div>Személy</div><div><a href="#szemely=${e.szemelyid}" data-szem="${e.szemelyid}">${esc(nev)}</a> <span class="muted">(${e.szemelyid})</span></div>` : ''}
      <div>Kérdés</div><div>${esc(e.kerdes)}</div><div>Állapot</div><div>${allapotBadge(e.allapot)}</div>
      ${e.valasz ? `<div>Válasz</div><div>${esc(e.valasz)}</div>` : ''}
    </div>
    ${szerk ? `<form class="form" id="elf">
      <label>Válasz / indoklás<textarea id="elv" required>${esc(e.valasz || '')}</textarea></label>
      <div class="toolbar"><button class="btn primary" type="submit" data-a="megoldva">Megoldva</button>
      <button class="btn" type="submit" data-a="elvetve">Elvetve (nem probléma)</button></div><div id="elmsg"></div></form>` : ''}
  </div>`;
  szemLinkek(d);
  if (!szerk) return;
  let akcio = 'megoldva';
  $('#elf', d).querySelectorAll('button').forEach(b => b.addEventListener('click', () => { akcio = b.dataset.a; }));
  $('#elf', d).addEventListener('submit', async ev2 => {
    ev2.preventDefault();
    try { await q(sb.rpc('lezar_ellenorzendo', { p_id: id, p_allapot: akcio, p_valasz: $('#elv', d).value })); msg($('#elmsg', d), 'Rögzítve.', 'ok'); setTimeout(utana, 1000); }
    catch (e2) { hibaKiir($('#elmsg', d), e2); }
  });
}

// ---------- Személyek ----------
function szerepNev(sz) {
  const m = /^(.*?)\s*(\d+)$/.exec(sz || ''); const alap = (m ? m[1] : sz || '').replace('hazastars', 'házastárs').replace('gyerek', 'gyermek').replace('dedapa', 'dédapa');
  return m ? `${m[2]}. ${alap}` : alap;
}
async function szemelyekLap() {
  location.hash = '';
  app.innerHTML = `<h2>Személyek</h2>
    <p class="muted">Az elittagok és családtagjaik. Kattints egy névre az adatlaphoz; a családtagoknál az „Elittag” oszlopban a hozzájuk tartozó elittag.</p>
    <div class="toolbar"><input type="search" id="sz-q" placeholder="Név…">
      <select id="sz-kik"><option value="elit">Elittagok</option><option value="csalad">Családtagok</option><option value="mind">Mindenki</option></select>
      <select id="sz-f"><option value="">Mind</option><option value="nyitott">Van nyitott harmonizáció</option><option value="kerdes">Van nyitott kérdés</option><option value="nokarr">Nincs karrieradat</option></select>
      <select id="sz-h"><option value="">Minden foglalkozás / hivatás</option></select></div>
    <div class="tbl-wrap" id="sz-list"></div><div id="sz-pager"></div>`;
  const st = { page: 0, kereses: '', szuro: '', kik: 'elit', hiv: '', hivIds: null };
  kodok().then(k => {
    const ertekek = [...new Set([...k.harmonizalt, ...k.hivatas1, ...k.hivatas2])].sort((a, b) => a.localeCompare(b, 'hu'));
    $('#sz-h').insertAdjacentHTML('beforeend', ertekek.map(v => `<option>${esc(v)}</option>`).join(''));
  }).catch(() => {});
  const lista = async () => {
    const box = $('#sz-list'); box.innerHTML = '<div class="empty">Betöltés…</div>';
    let qq = sb.from('v_szemely_minden').select('*', { count: 'exact' });
    if (st.hiv) {
      if (!st.hivIds) {
        const v = st.hiv.replace(/["\\]/g, m => '\\' + m);
        const sorok = await mindLeker(() => sb.from('v_karrier_harmonizalt').select('szemelyid').or(`harmonizalt.eq."${v}",hivatas1.eq."${v}",hivatas2.eq."${v}"`).order('harm_id'));
        st.hivIds = [...new Set(sorok.map(r => r.szemelyid).filter(Boolean))];
      }
      qq = qq.in('szemelyid', st.hivIds.length ? st.hivIds : [-1]);
    }
    if (st.kik === 'elit') qq = qq.eq('elittage', 1); else if (st.kik === 'csalad') qq = qq.neq('elittage', 1);
    if (st.kereses) { const t = st.kereses.split(/\s+/); qq = t.length > 1 ? qq.ilike('vezeteknev', `%${t[0]}%`).ilike('keresztnev', `%${t.slice(1).join(' ')}%`) : qq.or(`vezeteknev.ilike.%${t[0]}%,keresztnev.ilike.%${t[0]}%`); }
    if (st.szuro === 'nyitott') qq = qq.gt('harm_nyitott', 0);
    if (st.szuro === 'kerdes') qq = qq.gt('nyitott_kerdes', 0);
    if (st.szuro === 'nokarr') qq = qq.eq('karrier_db', 0);
    try {
      const { data, count } = await q(qq.order('vezeteknev').order('keresztnev').range(st.page * PAGE, st.page * PAGE + PAGE - 1));
      // harmonizált foglalkozás és hivatások az oldalon látható elittagokra
      const elitIds = data.filter(r => r.elittage === 1).map(r => r.szemelyid), H = new Map();
      if (elitIds.length) {
        const hs = await mindLeker(() => sb.from('v_karrier_harmonizalt').select('szemelyid,harmonizalt,hivatas1,hivatas2').in('szemelyid', elitIds).order('harm_id'));
        for (const r of hs) {
          if (!H.has(r.szemelyid)) H.set(r.szemelyid, { h: new Map(), h1: new Map(), h2: new Map() });
          const x = H.get(r.szemelyid);
          for (const [m, k] of [[x.h, 'harmonizalt'], [x.h1, 'hivatas1'], [x.h2, 'hivatas2']]) {
            const v = r[k]; if (v && v.toUpperCase() !== 'NINCS') m.set(v, (m.get(v) || 0) + 1);
          }
        }
      }
      const ert = (m, n = 3) => { if (!m || !m.size) return ''; const t = [...m.entries()].sort((a, b) => b[1] - a[1]); return t.slice(0, n).map(([v, k]) => `${esc(v)}${k > 1 ? ` <span class="muted">(${k})</span>` : ''}`).join(', ') + (t.length > n ? ` <span class="muted">+${t.length - n}</span>` : ''); };
      const kiem = v => st.hiv ? v.replace(new RegExp(esc(st.hiv).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '<mark>$&</mark>') : v;
      box.innerHTML = data.length ? `<table><thead><tr><th>Név</th><th>Született</th><th>Szerep</th><th>Elittag</th><th>Foglalkozás (harmonizált)</th><th>Hivatás1</th><th>Hivatás2</th><th>Nyitott</th></tr></thead><tbody>${
        data.map(r => `<tr class="click" data-id="${r.szemelyid}"><td><b>${esc(r.vezeteknev)} ${esc(r.keresztnev)}</b></td><td>${dash(r.szuletesiev)} <span class="muted small">${esc(r.szuletesihely || '')}</span></td>
          <td class="small">${r.elittage === 1 ? '<span class="badge b-info">elittag</span>' : esc(szerepNev(r.szerep))}</td>
          <td class="small">${r.elittag_id ? `<a href="#szemely=${r.elittag_id}" data-elit="${r.elittag_id}">${esc(r.elittag_nev)}</a>` : ''}</td>
          ${r.elittage === 1
            ? `<td class="small">${kiem(ert(H.get(r.szemelyid)?.h)) || (H.has(r.szemelyid) ? '<span class="muted">—</span>' : `<span class="muted">${r.karrier_db ? 'nincs harmonizálva' : 'nincs karrieradat'}</span>`)}</td><td class="small">${kiem(ert(H.get(r.szemelyid)?.h1))}</td><td class="small">${kiem(ert(H.get(r.szemelyid)?.h2))}</td>`
            : `<td class="small" colspan="3">${esc(r.foglalkozasok || '')}</td>`}
          <td>${r.harm_nyitott ? `<span class="badge b-warn">${r.harm_nyitott} sor</span>` : ''} ${r.nyitott_kerdes ? `<span class="badge b-bad">${r.nyitott_kerdes} kérdés</span>` : ''}</td></tr>`).join('')}</tbody></table>`
        : '<div class="empty">Nincs találat.</div>';
      box.querySelector('tbody')?.addEventListener('click', e => { e.preventDefault(); const a = e.target.closest('[data-elit]'); if (a) return szemelyLap(Number(a.dataset.elit)); const tr = e.target.closest('tr'); if (tr) szemelyLap(Number(tr.dataset.id)); });
      $('#sz-pager').innerHTML = ''; $('#sz-pager').appendChild(pager(count, st.page, p => { st.page = p; lista(); }));
    } catch (e) { hibaKiir(box, e); }
  };
  $('#sz-q').addEventListener('input', debounce(e => { st.kereses = tiszta(e.target.value); st.page = 0; lista(); }));
  $('#sz-f').addEventListener('change', e => { st.szuro = e.target.value; st.page = 0; lista(); });
  $('#sz-kik').addEventListener('change', e => { st.kik = e.target.value; st.page = 0; lista(); });
  $('#sz-h').addEventListener('change', e => { st.hiv = e.target.value; st.hivIds = null; st.page = 0; lista(); });
  lista();
}

// ---------- Teljes személyi adatlap ----------
// A kódtáblák egyszer töltődnek be; ahol nincs megbízható kódtábla, a kód „kód N” formában látszik (lásd KODKONYV_HIANY).
async function kodtablak() {
  if (S.kt) return S.kt;
  const [vm, kit, kk, part, szerz, zst, fr, egy, idp, osz, dipl, hmod, nemz, csall, vall, hpont] = await Promise.all([
    q(sb.from('kod_varmegyek').select('kodertek,kodnev')),
    q(sb.from('tbl_kod_kituntetes').select('lista,kituntetekod,kituntetenev')),
    q(sb.from('tbl_kod_kulfoldikit').select('orszag,kodertek,kituntetenev')),
    q(sb.from('tbl_kod_part').select('partkod,partnev')),
    q(sb.from('tbl_kod_szerzetesrendek').select('kodertek,kodnev')),
    q(sb.from('tbl_kod_zsidotorvenyek').select('kodertek,kodnev,tipus')),
    q(sb.from('tbl_forrasok').select('forras_id,megnevezes,fazis,tipus')),
    q(sb.from('tbl_egyetemek').select('egyetemid,egyetemnev,egyetemnevharmonizalt').range(0, 4999)),
    q(sb.from('tbl_foglalkozas_idopont').select('idopontkod,idopontnev,sorrend').order('sorrend')),
    q(sb.from('v_szerk_oszlopok').select('*').order('sorrend').range(0, 4999)),
    q(sb.from('kod_diplomafajta').select('kodertek,nev,statusz').order('kodertek')),
    q(sb.from('kod_halalmodja').select('kodertek,nev').order('kodertek')),
    q(sb.from('kod_nemzetiseg').select('lista,kod,nev').order('kod')),
    q(sb.from('kod_csaladiallapot').select('kodertek,nev,statusz').order('kodertek')),
    q(sb.from('kod_vallas').select('kodertek,nev,statusz').order('kodertek')),
    q(sb.from('kod_halalpontossag').select('kodertek,nev,statusz').order('kodertek')),
  ]);
  const m = (rows, k, v) => new Map(rows.map(r => [Number(r[k]), r[v]]));
  S.kt = {
    hely: m(vm.data, 'kodertek', 'kodnev'),
    kitHazai: m(kit.data.filter(r => r.lista === 1), 'kituntetekod', 'kituntetenev'),
    diploma: new Map(dipl.data.map(r => [Number(r.kodertek), r])),
    halalmod: m(hmod.data, 'kodertek', 'nev'),
    csaladiallapot: new Map(csall.data.map(r => [Number(r.kodertek), r])),
    vallas: new Map(vall.data.map(r => [Number(r.kodertek), r])),
    halalpontossag: new Map(hpont.data.map(r => [Number(r.kodertek), r])),
    nemzetiseg: m(nemz.data.filter(r => r.lista === 1), 'kod', 'nev'),
    kitKulf: kk.data,
    kitLista: [2, 3, 4, 5].reduce((o, l) => (o[l] = m(kit.data.filter(r => r.lista === l), 'kituntetekod', 'kituntetenev'), o), {}),
    part: m(part.data, 'partkod', 'partnev'),
    szerzetes: m(szerz.data, 'kodertek', 'kodnev'),
    zst: m(zst.data, 'kodertek', 'kodnev'),
    forras: new Map(fr.data.map(r => [r.forras_id, r])),
    egyetem: new Map(egy.data.map(r => [Number(r.egyetemid), r.egyetemnevharmonizalt || r.egyetemnev])),
    idopont: idp.data,
    oszlopok: osz.data.reduce((m, r) => { (m[r.tabla] = m[r.tabla] || []).push(r); return m; }, {}),
  };
  return S.kt;
}
// Vélelmezett vallás-kódok: a korábbi ElitData-profilfájl feloldása alapján, a KIG-kódkönyvvel még egyeztetendő.
const SZEREP = { APA: 'apa', ANYA: 'anya', HAZASTARS_1: '1. házastárs', HAZASTARS_2: '2. házastárs', HAZASTARS_3: '3. házastárs' };
const LAKAS = { helyszin: 'Helyszín (kód)', lakcim: 'Lakcím típusa (kód)', lakasbanevek: 'Lakásban töltött évek', budapestenevek: 'Budapesten töltött évek', lakber: 'Lakbér', utcaiszobak: 'Utcai szobák', udvariszobak: 'Udvari szobák', kertiszobak: 'Kerti szobák', hall: 'Hall', cseledszoba: 'Cselédszoba', cseledfulke: 'Cselédfülke', konyha: 'Konyha', teakonyha: 'Teakonyha', eloszoba: 'Előszoba', eleskamra: 'Éléskamra', feredo: 'Fürdőszoba', veranda: 'Veranda', muterem: 'Műterem', egyebhelyiseg: 'Egyéb helyiség', garage: 'Garázs', halofulke: 'Hálófülke', pince: 'Pince', padlas: 'Padlás', alberlo: 'Albérlő', vizvezetek: 'Vízvezeték', gazvezetek: 'Gázvezeték', villany: 'Villany', kozpontifutes: 'Központi fűtés', etagefutes: 'Etázsfűtés', gazfutes: 'Gázfűtés', villanyfutes: 'Villanyfűtés', melegviz: 'Melegvíz', telefon: 'Telefon', detektorradio: 'Detektoros rádió', lamparadio: 'Lámpás rádió', fozeshelyek: 'Főzőhelyek', furdeshelyek: 'Fürdőhelyek', wcszam: 'WC', nemwcszam: 'Nem vízöblítéses WC' };
const ZST = { zst_szul: 'Zsidónak minősült születése alapján', zst_fele: 'Felekezet alapján', zst_gyer: 'Gyermekei érintettek', zst_1in: '1. törvény: érintett', zst_1mi: '1. törvény: következmény / mentesítés', zst_1ev: '1. törvény: év', zst_1ho: '1. törvény: hónap', zst_2in: '2. törvény: érintett', zst_2mi: '2. törvény: következmény / mentesítés', zst_2ev: '2. törvény: év', zst_2ho: '2. törvény: hónap' };
const PER_TIPUS = { BAJ: 'B-listázás / igazolás (1945–)', OSE: '1956 utáni eljárás' };

function profilRender(P, id) {
  const kt = S.kt;
  const sz = P.szemely || {}, r = P.reszletek || {};
  const szul = ev(sz.szuletesiev);
  const elit = Number(sz.elittage) === 1;
  const kod = v => (v === null || v === undefined || v === '') ? null : `<span class="kod" title="A kód jelentése a KIG-kódkönyvből pótlandó">kód ${esc(v)}</span>`;
  const helyF = v => { if (v === null || v === undefined || v === '') return null; const n = kt.hely.get(Number(v)); return n ? `${esc(n)} <span class="muted small">(${esc(v)})</span>` : kod(v); };
  const evF = v => (v === null || v === undefined || v === '') ? null : esc(ev(v, szul));
  const boolF = v => (v === null || v === undefined || v === '') ? null : (Number(v) === 1 ? 'igen' : Number(v) === 0 ? 'nem' : kod(v));
  const txt = v => (v === null || v === undefined || v === '') ? null : esc(v);
  // kódtáblás feloldás; a következtetett jelentés mellett (?)
  const ktF = mp => v => { if (v === null || v === undefined || v === '') return null; const c = mp.get(Number(v)); return c ? `${esc(c.nev)}${c.statusz === 'következtetett' ? ' <span class="muted small" title="Az adatokból következtetett jelentés">(?)</span>' : ''}` : kod(v); };
  const csallF = v => { if (v === null || v === undefined || v === '') return null; const c = kt.csaladiallapot.get(Number(v)); return c ? `${esc(c.nev)}${c.statusz === 'következtetett' ? ' <span class="muted small" title="A kódkönyv hiányában az adatokból következtetett jelentés">(?)</span>' : ''}` : kod(v); };
  const fb = fid => { const f = kt.forras.get(fid); return f ? forrasBadge(f.megnevezes, f.fazis) : ''; };
  // az állítások (javítások) felülírják a megjelenített értéket, a régi érték megmarad tooltipben
  const allit = {};
  (P.allitasok || []).filter(a => a.elfogadott !== false).forEach(a => { allit[a.tabla + '.' + a.mezo] = a; });
  const ertek = (tabla, mezo, sor) => { const a = allit[tabla + '.' + mezo]; return a ? { v: a.ertek, forras: a.forras_id, javitva: sor ? sor[mezo] : null } : { v: sor ? sor[mezo] : null, forras: sor ? sor.forras_id : null }; };
  const kvSor = (cim, html, forras) => html === null || html === undefined ? '' : `<div>${esc(cim)}</div><div>${html} ${forras ? fb(forras) : ''}</div>`;
  const kvBlokk = (sorok) => { const h = sorok.join(''); return h ? `<div class="kv">${h}</div>` : '<p class="muted">Nincs adat.</p>'; };
  const mezo = (tabla, sor, m, cim, f) => { const e = ertek(tabla, m, sor); const h = f(e.v); return kvSor(cim, h === null ? null : (e.javitva !== undefined && allit[tabla + '.' + m] ? `<span title="Javított érték; eredetileg: ${esc(e.javitva ?? '—')}">${h}</span>` : h), e.forras); };
  // táblázat: csak a kitöltött oszlopok
  const tabla = (sorok, oszlopok) => {
    if (!sorok || !sorok.length) return '<p class="muted">Nincs adat.</p>';
    const aktiv = oszlopok.filter(o => sorok.some(s => { const v = o.f ? o.f(s) : s[o.k]; return v !== null && v !== undefined && v !== ''; }));
    return `<div class="tbl-wrap"><table><thead><tr>${aktiv.map(o => `<th>${esc(o.c)}</th>`).join('')}<th>Forrás</th></tr></thead><tbody>${
      sorok.map(s => `<tr>${aktiv.map(o => { const v = o.f ? o.f(s) : txt(s[o.k]); return `<td class="${o.cls || ''}">${v ?? '<span class="muted">—</span>'}</td>`; }).join('')}<td>${fb(s.forras_id)}${javJel(s)}</td></tr>`).join('')}</tbody></table></div>`;
  };
  const szakasz = (cim, html, db) => `<section class="card szakasz"><h3>${esc(cim)}${db ? ` <span class="muted small">(${db})</span>` : ''}</h3>${html}</section>`;
  const pozkod = s => ['1914', '1922', '1928', '1933', '1938', '1942', '1947'].filter(y => s['pozkod_' + y] !== null && s['pozkod_' + y] !== undefined).map(y => `${y}: ${s['pozkod_' + y]}`).join(', ') || null;

  // --- szakaszok ---
  const alap = kvBlokk([
    mezo('tbl_szemelyek', sz, 'szuletesiev', 'Születési év', evF),
    mezo('tbl_szemelyek', sz, 'szuletesihely', 'Születési hely', txt),
    mezo('tbl_szemelyek', sz, 'szuletesiorszagkod', 'Születési vármegye / ország', helyF),
    mezo('tbl_szemelyek', sz, 'nemzetisegkod', 'Nemzetiség (forrás szerint)', v => v === null || v === undefined || v === '' ? null : (kt.nemzetiseg.get(Number(v)) ? esc(kt.nemzetiseg.get(Number(v))) : kod(v))),
    mezo('tbl_szemelyek', sz, 'doktoricim', 'Doktori cím', boolF),
    mezo('tbl_szemelyek', sz, 'szerzetese', 'Szerzetes', boolF),
    mezo('tbl_elittag_reszletek', r, 'szerzetesrende', 'Szerzetesrend', v => v === null || v === undefined ? null : (kt.szerzetes.get(Number(v)) ? esc(kt.szerzetes.get(Number(v))) : kod(v))),
    mezo('tbl_elittag_reszletek', r, 'szerzetesbelepesev', 'Rendbe lépés éve', evF),
    mezo('tbl_elittag_reszletek', r, 'szerzeteskilepesev', 'Rendből kilépés éve', evF),
  ]);
  const halal = kvBlokk([
    (() => { const he = ertek('tbl_elittag_reszletek', 'halalev', r), hh = ertek('tbl_elittag_reszletek', 'halalho', r), hn = ertek('tbl_elittag_reszletek', 'halalnap', r);
      const HO = ['jan.', 'febr.', 'márc.', 'ápr.', 'máj.', 'jún.', 'júl.', 'aug.', 'szept.', 'okt.', 'nov.', 'dec.'];
      const sz = [he.v ? ev(he.v, szul) + '.' : null, hh.v ? (HO[Number(hh.v) - 1] || hh.v + '.') : null, hn.v ? hn.v + '.' : null].filter(Boolean).join(' ');
      const jav = [he, hh, hn].find(x => x.javitva !== undefined);
      const eredeti = [r.halalev ? ev(r.halalev, szul) : null, r.halalho, r.halalnap].filter(x => x !== null && x !== undefined && x !== '').join('. ');
      return kvSor('Halálozás ideje', sz ? (jav ? `<span title="Javított érték; eredetileg: ${esc(eredeti || '—')}">${esc(sz)}</span>` : esc(sz)) : null, (jav || he).forras || r.forras_id); })(),
    mezo('tbl_elittag_reszletek', r, 'halalhely', 'Halálozás helye', txt),
    mezo('tbl_elittag_reszletek', r, 'halalhelymegyekod', 'Halálozás vármegye / ország', helyF),
    mezo('tbl_elittag_reszletek', r, 'halalmodja', 'Halál módja', v => v === null || v === undefined || v === '' ? null : (kt.halalmod.get(Number(v)) ? esc(kt.halalmod.get(Number(v))) : kod(v))),
    mezo('tbl_elittag_reszletek', r, 'halalmodjaegyeb', 'Halál módja (szövegesen)', txt),
    mezo('tbl_elittag_reszletek', r, 'halalpontose', 'Halálozási adat pontossága', ktF(kt.halalpontossag)),
  ]);
  const csaladiAllapot = kvBlokk([
    mezo('tbl_elittag_reszletek', r, 'testverekszama', 'Testvérek száma', txt),
    mezo('tbl_elittag_reszletek', r, 'hazassagokszama', 'Házasságok száma', txt),
    mezo('tbl_elittag_reszletek', r, 'elsohazassagev', 'Első házasság éve', evF),
    mezo('tbl_elittag_reszletek', r, 'hazaskor', 'Életkor a házasságkötéskor', txt),
    mezo('tbl_elittag_reszletek', r, 'gyerekekszama', 'Gyerekek száma', txt),
    mezo('tbl_elittag_reszletek', r, 'csaladiallapot1928', 'Családi állapot 1928', csallF),
    mezo('tbl_elittag_reszletek', r, 'csaladiallapot1938', 'Családi állapot 1938', csallF),
    mezo('tbl_elittag_reszletek', r, 'csaladiallapot1942', 'Családi állapot 1942', csallF),
    mezo('tbl_elittag_reszletek', r, 'apahalalev', 'Apa halála (kategória)', kod),
    mezo('tbl_elittag_reszletek', r, 'anyahalalev', 'Anya halála (kategória)', kod),
  ]);
  const vallas = tabla(P.vallas, [
    { c: 'Felekezet', f: s => ktF(kt.vallas)(s.jelenlegivallas) },
    { c: 'Áttérés', f: s => s.regivallas === null && s.ujvallas === null ? null : `${ktF(kt.vallas)(s.regivallas) ?? '—'} → ${ktF(kt.vallas)(s.ujvallas) ?? '—'}` },
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
    { c: 'Diploma fajtája', f: s => { const d = kt.diploma.get(Number(s.diplomafajta)); return d ? `${esc(d.nev)}${d.statusz === 'következtetett' ? ' <span class="muted small" title="A kódkönyvben nem szerepel; az adatokból következtetett jelentés">(?)</span>' : ''}` : kod(s.diplomafajta); } },
    { c: 'Tanítási nyelv', f: s => kod(s.tanitasinyelv) },
    { c: 'Végzettség', f: s => kod(s['vegzettségkod']) },
  ]);
  const karrier = P.karrier && P.karrier.length ? `<div class="tbl-wrap"><table id="kar-tbl"><thead><tr><th>Időszak</th><th>Foglalkozás</th><th>Munkahely</th><th>Helyszín</th><th>Forrás</th><th>Harmonizált</th><th>Hivatás1</th><th>Hivatás2</th><th>Specifikáció</th><th>Harm. forrás</th><th>Állapot</th><th></th></tr></thead><tbody>${
    P.karrier.map(k => { const jm = k.javitott_mezok || [], jv = m => jm.includes(m) ? ` <span class="muted small" title="Javított érték; eredetileg: ${esc(k.eredeti?.[m] ?? '—')}">*</span>` : '';
      const evJav = jm.includes('elsoev') || jm.includes('utolsoev');
      return `<tr ${k.harm_id ? `class="click" data-h="${k.harm_id}"` : ''}><td>${idoszak(k.elsoev, k.utolsoev)}${evJav ? jv(jm.includes('elsoev') ? 'elsoev' : 'utolsoev') : (k.leiras && k.leiras.startsWith('? kód') ? ` <span class="badge b-warn">${esc(k.leiras)}</span>` : '')}</td>
      <td>${dash(k.foglalkozas)}${jv('foglalkozas')}</td><td class="small">${dash(k.munkahely)}${jv('munkahely')}</td><td class="small">${dash(k.helyszin)}${jv('helyszin')}</td><td>${forrasBadge(k.forras, k.fazis)}</td>
      ${k.harm_id ? `<td>${harmF(k, 'harmonizalt')}</td><td>${harmF(k, 'hivatas1')}</td><td>${harmF(k, 'hivatas2')}</td><td class="small">${esc(k.specifikacio || '')}</td>
      <td>${forrasBadge(k.harm_forras || 'ElitData2026', 'ElitData2026')}</td><td>${allapotBadge(k.harm_allapot)}</td>` : NEMHARM(6)}<td><button class="btn small" data-kj="${k.karrierid}">${S.szerkEz ? 'Javítás' : 'Besorolás'}</button></td></tr>`; }).join('')}</tbody></table></div>` : '<p class="muted">Nincs karrieradat.</p>';
  const karrierpoz = tabla(P.karrierpoziciok, [{ c: 'Belépés éve', f: s => evF(s.belepesev) }, { c: 'Pozíciókód évenként', f: s => pozkod(s), cls: 'small' }]);
  const csalad = tabla(P.csalad, [
    { c: 'Viszony', f: s => elit ? esc(SZEREP[s.szerep] || (s.szerep || '').toLowerCase().replace('_', ' ') || s.viszony) : esc(s.viszony) + (Number(s.elittage) === 1 ? ' <span class="badge b-info">elittag</span>' : '') },
    { c: 'Név', f: s => `<a href="#szemely=${s.rokonid}" data-szem="${s.rokonid}">${esc(s.nev)}</a>` },
    { c: 'Született', f: s => [s.szuletesiev ? ev(s.szuletesiev) : null, s.szuletesihely].filter(Boolean).map(esc).join(', ') || null },
    { c: 'Házasságból', f: s => s.hazassagbol ? esc(s.hazassagbol) + '.' : null },
    { c: 'Foglalkozás', f: s => (s.foglalkozasok || []).map(f => `${esc(f.foglalkozas)} <span class="muted small">(${esc((f.mikor || '').replace(' foglalkozás', ''))})</span>${javJel(f)}`).join('; ') || null, cls: 'small' },
  ]);
  const kitKulfNev = s => {
    // a „K2”/„K3” jelű sorok kódja nem külföldi kitüntetés, hanem a 2. (1946–49) ill. 3. (1949 utáni) hazai kódlista eleme
    const ln = { K2: 2, K3: 3 }[String(s.lista || '').trim().toUpperCase()];
    if (ln) { const n = kt.kitLista[ln]?.get(Number(s.kituntetekod)); return n ? esc(n) : kod(s.kituntetekod); }
    const orszag = kt.hely.get(Number(s.orszagkod));
    const t = kt.kitKulf.find(k => Number(k.kodertek) === Number(s.kituntetekod) && orszag && (orszag.startsWith(k.orszag) || k.orszag.startsWith(orszag.split(' ')[0])));
    return t ? esc(t.kituntetenev) : `${kod(s.kituntetekod)}`;
  };
  const kituntetes = [
    P.kituntetes_hazai?.length ? '<h4>Hazai kitüntetések</h4>' + tabla(P.kituntetes_hazai, [
      { c: 'Kitüntetés', f: s => kt.kitHazai.get(Number(s.kituntetekod)) ? esc(kt.kitHazai.get(Number(s.kituntetekod))) : kod(s.kituntetekod) }, { c: 'Év', f: s => evF(s.ev) }]) : '',
    ...(() => {
      const K = P.kituntetes_kulfoldi || [], uj = K.filter(s => /^K[23]$/i.test(String(s.lista || '').trim())), kulf = K.filter(s => !uj.includes(s));
      const LN = { K2: '2. lista (1946–1949)', K3: '3. lista (1949 után)' };
      return [
        uj.length ? '<h4>Hazai kitüntetések 1945 után</h4>' + tabla(uj, [
          { c: 'Kitüntetés', f: kitKulfNev }, { c: 'Kódlista', f: s => esc(LN[String(s.lista).trim().toUpperCase()] || s.lista) }, { c: 'Év', f: s => evF(s.ev) }]) : '',
        kulf.length ? '<h4>Külföldi kitüntetések</h4>' + tabla(kulf, [
          { c: 'Ország', f: s => helyF(s.orszagkod) }, { c: 'Kitüntetés', f: kitKulfNev }, { c: 'Év', f: s => evF(s.ev) }]) : ''];
    })(),
    P.csapat_ermek?.length ? '<h4>Címek (állami és egyházi)</h4>' + tabla(P.csapat_ermek, [
      { c: 'Típus', f: s => esc({ CA: 'állami cím', CE: 'egyházi cím' }[s.tipus] || s.tipus) },
      // CA = 4. kódlista (állami címek), CE = 5. kódlista (egyházi címek); a listán túli kódok jelentése a kódkönyvből pótlandó
      { c: 'Cím', f: s => { const n = kt.kitLista[{ CA: 4, CE: 5 }[s.tipus]]?.get(Number(s.kituntetekod)); return n ? esc(n) : kod(s.kituntetekod); } },
      { c: 'Év', f: s => evF(s.ev) }]) : '',
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
  // a belső mezők (_jav, _eredeti: a javítási réteg adatai) nem jelennek meg; a javított mező mellett * jelzi a javítást
  const egyebPol = (P.egyeb_politikai || []).map(s => kvBlokk(Object.entries(s).filter(([k, v]) => v !== null && v !== '' && !k.startsWith('_') && !['azonosító', 'szemelyid', 'forras_id', 'rogzitve', 'elfogadott'].includes(k))
    .map(([k, v]) => kvSor(EGYEBPOL[k] || cimke(k), (/(ev|fr|_tol|_ig|ho)$/.test(k) ? (Number(v) === 0 ? '<span class="muted">nincs adat</span>' : esc(ev(v, szul))) : isNaN(Number(v)) ? esc(v) : kod(v)) + ((s._jav || []).includes(k) ? ` <span class="muted small" title="Javított érték; eredetileg: ${esc(s._eredeti?.[k] ?? '—')}">*</span>` : ''), s.forras_id)))).join('');
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
    P.lakas?.length ? '<h4>Lakás (1942)</h4>' + (P.lakas || []).map(s => kvBlokk(Object.entries(s).filter(([k, v]) => v !== null && v !== 0 && !k.startsWith('_') && !['lakasid', 'szemelyid', 'forras_id', 'rogzitve', 'elfogadott', 'ev'].includes(k)).map(([k, v]) => kvSor(LAKAS[k] || k, esc(v), null)))).join('') : '',
    P.haztartas?.length ? '<h4>Háztartás (1942)</h4>' + tabla(P.haztartas, [{ c: 'Jelenlévők', k: 'jelenlevokszama' }, { c: 'Távollévők', k: 'tavollevokszama' }, { c: 'Háztartási alkalmazott', k: 'haztartasialkalmazottak' }, { c: 'Gyerekek', k: 'gyerekek' }, { c: 'Más rokon', k: 'masrokon' }]) : '',
  ].join('');
  const nyit = P.nyitott || [];
  const db = a => (a && a.length) || 0;
  const foglalk = tabla(P.foglalkozasok, [{ c: 'Mikor', f: s => esc(s.mikor || s.idopontkod) }, { c: 'Foglalkozás', k: 'foglalkozas' }]);
  const tartalom = [
    ['alap', 'Alapadatok', `${S.szerkEz ? '<div class="szerk-gomb"><button class="btn" id="alap-szerk">Szerkesztés</button></div>' : ''}<div id="alap-nezet"><div class="grid2"><div>${alap}</div><div>${halal}</div></div>${javitasLista(P, fb)}</div><div id="alap-urlap"></div>`],
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
  if (!elit || db(P.foglalkozasok)) tartalom.splice(2, 0, ['foglalkozasok', 'Foglalkozások', foglalk, db(P.foglalkozasok)]);
  // családtagoknál csak az alapadatok, a család, a vallás, a foglalkozások és az esetleg kitöltött további blokkok
  const ures = h => !h || /^\s*(<p class="muted">Nincs adat\.<\/p>\s*)*$/.test(h.replace(/<h4>[^<]*<\/h4>/g, ''));
  const tart = elit ? tartalom : tartalom.filter(([k, , h]) => ['alap', 'csalad', 'vallas', 'foglalkozasok'].includes(k) || (k === 'karrier' ? db(P.karrier) > 0 : !ures(h)));
  const nv = m => { const a = allit['tbl_szemelyek.' + m]; return a ? a.ertek : sz[m]; };
  return { szul, nyit, tartalom: tart, elit, nev: `${nv('vezeteknev') || ''} ${nv('keresztnev') || ''}`.trim() };
}


// ---------- Alapadatok javítása ----------
const JAVITHATO = [
  ['tbl_szemelyek', 'vezeteknev', 'Vezetéknév', 'text'], ['tbl_szemelyek', 'keresztnev', 'Keresztnév', 'text'],
  ['tbl_szemelyek', 'szuletesiev', 'Születési év', 'ev'], ['tbl_szemelyek', 'szuletesihely', 'Születési hely', 'text'],
  ['tbl_szemelyek', 'szuletesiorszagkod', 'Születési vármegye / ország', 'hely'], ['tbl_szemelyek', 'nemzetisegkod', 'Nemzetiség (forrás szerint)', 'nemz'],
  ['tbl_szemelyek', 'doktoricim', 'Doktori cím', 'bool'], ['tbl_szemelyek', 'szerzetese', 'Szerzetes', 'bool'],
  ['tbl_elittag_reszletek', 'szerzetesrende', 'Szerzetesrend', 'szerzetes'], ['tbl_elittag_reszletek', 'szerzetesbelepesev', 'Rendbe lépés éve', 'ev'],
  ['tbl_elittag_reszletek', 'szerzeteskilepesev', 'Rendből kilépés éve', 'ev'],
  ['tbl_elittag_reszletek', 'halalev', 'Halálozás éve', 'ev'], ['tbl_elittag_reszletek', 'halalho', 'Halálozás hónapja', 'text'],
  ['tbl_elittag_reszletek', 'halalnap', 'Halálozás napja', 'text'], ['tbl_elittag_reszletek', 'halalhely', 'Halálozás helye', 'text'],
  ['tbl_elittag_reszletek', 'halalhelymegyekod', 'Halálozás vármegye / ország', 'hely'], ['tbl_elittag_reszletek', 'halalmodja', 'Halál módja', 'halalmod'],
  ['tbl_elittag_reszletek', 'halalmodjaegyeb', 'Halál módja (szövegesen)', 'text'],
  ['tbl_elittag_reszletek', 'testverekszama', 'Testvérek száma', 'text'], ['tbl_elittag_reszletek', 'hazassagokszama', 'Házasságok száma', 'text'],
  ['tbl_elittag_reszletek', 'elsohazassagev', 'Első házasság éve', 'ev'], ['tbl_elittag_reszletek', 'hazaskor', 'Életkor a házasságkötéskor', 'text'],
  ['tbl_elittag_reszletek', 'gyerekekszama', 'Gyerekek száma', 'text'],
  ['tbl_elittag_reszletek', 'csaladiallapot1928', 'Családi állapot 1928', 'csall'], ['tbl_elittag_reszletek', 'csaladiallapot1938', 'Családi állapot 1938', 'csall'],
  ['tbl_elittag_reszletek', 'csaladiallapot1942', 'Családi állapot 1942', 'csall'],
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
  return `<details class="jav-elozmeny"><summary class="muted small">Javítások előzménye (${a.length})</summary><div class="tbl-wrap"><table><thead><tr><th>Mező</th><th>Új érték</th><th>Forrás</th><th>Hivatkozás</th><th>Ki, mikor</th><th></th></tr></thead><tbody>${
    a.slice().reverse().map(x => `<tr class="${x.elfogadott === false ? 'visszavont' : ''}"><td>${esc(nev[x.tabla + '.' + x.mezo] || x.mezo)}</td><td>${dash(x.ertek)}</td><td>${fb(x.forras_id)} ${esc((S.kt.forras.get(x.forras_id) || {}).megnevezes || '')}</td>
      <td class="small">${dash(x.hivatkozas)}${x.megjegyzes ? `<br><span class="muted">${esc(x.megjegyzes)}</span>` : ''}</td><td class="small">${esc(x.rogzitette || '')}<br>${new Date(x.rogzitve).toLocaleString('hu-HU')}</td>
      <td>${x.elfogadott === false ? '<span class="badge b-gray">visszavonva</span>' : (S.szerkEz ? `<button class="btn small" data-visszavon="${x.allitas_id}">Visszavonás</button>` : '')}</td></tr>`).join('')}</tbody></table></div></details>`;
}
function forrasValaszto(prefix) {
  const fr = [...S.kt.forras.values()].filter(f => f.fazis !== 'KIG-féle kutatás' && !/^(harmonizációs|kódlista|kódolói|származtatott)/.test(f.tipus || ''))
    .sort((a, b) => (b.tipus === 'belső ellenőrzés') - (a.tipus === 'belső ellenőrzés'));
  return `<fieldset class="forras-box"><legend>Forrás (kötelező${prefix === 'kf' ? ' a karrieradatok javításához; a harmonizált besoroláshoz nem kell' : ''})</legend>
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
  if (v !== 'uj') {
    if ((S.kt.forras.get(Number(v)) || {}).tipus === 'belső ellenőrzés' && !$('#' + prefix + '-megj').value.trim())
      throw new Error('Elírás javításánál a Megjegyzésben röviden írd le, miből látszik az elírás (pl. „a születési év 1905, így 1993 nem lehet; helyesen 1893”).');
    return Number(v);
  }
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
    else if (tip === 'nemz' || tip === 'halalmod' || tip === 'csall') { const mp = tip === 'nemz' ? kt.nemzetiseg : tip === 'halalmod' ? kt.halalmod : new Map([...kt.csaladiallapot].map(([k, c]) => [k, c.nev])); inp = `<select id="${idd}"><option value="">—</option>${[...mp.entries()].map(([k, n]) => `<option value="${k}">${k} – ${esc(n)}</option>`).join('')}${v !== '' && !mp.has(Number(v)) ? `<option value="${esc(v)}">kód ${esc(v)}</option>` : ''}</select>`; }
    else inp = `<input id="${idd}" ${tip === 'ev' ? 'inputmode="numeric" placeholder="éééé"' : ''}>`;
    return `<label data-k="${t}.${m}" data-tip="${tip}" data-eredeti="${esc(v)}">${esc(cim)}${inp}</label>`;
  };
  const box = $('#alap-urlap');
  $('#alap-nezet').classList.add('hidden'); $('#alap-szerk').classList.add('hidden');
  box.innerHTML = `<form id="alap-f" class="form"><p class="muted small">Csak a megváltoztatott mezők mentődnek, új bejegyzésként; az eredeti érték megmarad és visszakereshető.</p>
    <div class="szerk-racs">${JAVITHATO.filter(j => Number(P.szemely.elittage) === 1 || j[0] === 'tbl_szemelyek').map(mezo).join('')}</div>${forrasValaszto('af')}
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

// ---------- Minden blokk szerkesztése ----------
// Listatáblák: kulcs a szemely_osszes válaszában -> [tábla, cím]
const LISTA = {
  vallas: ['tbl_vallas', 'Vallás'], nemesseg: ['tbl_nemesseg', 'Nemesség'], nevvaltoztatasok: ['tbl_nevvaltoztatasok', 'Névváltoztatás'],
  tanulmanyok: ['tbl_tanulmanyok', 'Tanulmányok'], karrier: ['tbl_karrier', 'Karrierállomások'], karrierpoziciok: ['tbl_karrierpoziciok', 'Karrierpozíciók'],
  kituntetes_hazai: ['tbl_kituntetes_hazai', 'Hazai kitüntetések'], kituntetes_kulfoldi: ['tbl_kituntetes_kulfoldi', 'Külföldi kitüntetések'],
  csapat_ermek: ['tbl_csapat_ermek', 'Címek, érmek (CA/CE)'], dijak: ['tbl_dijak', 'Díjak'], diszdoktoratus: ['tbl_diszdoktoratus', 'Díszdoktorátus'],
  akad_kituntetesek: ['tbl_akad_kituntetesek', 'Külföldi akadémiai tagság'], katonai: ['tbl_katonaiszolgalat', 'Katonai szolgálat'],
  kulfold: ['tbl_kulfolditartozkodasok', 'Külföldi tartózkodás'], szervezet_belfold: ['tbl_szervezeti_tagsag_belfold', 'Belföldi szervezetek'],
  szervezet_kulfold: ['tbl_szervezeti_tagsag_kulfold', 'Külföldi szervezetek'], parttagsag: ['tbl_parttagsag_tol_ig', 'Párttagság'],
  part_megfigyeles: ['tbl_part_megfigyelesi_ev', 'Párthovatartozás megfigyelési évenként'], felsohaz_tagsag: ['tbl_felsohaz_tagsag', 'Felsőházi tagság'],
  felsohaz_pozicio: ['tbl_felsohaz_pozicio', 'Felsőházi pozíció'], parl_bizottsag: ['tbl_parl_bizottsag_pozicio', 'Parlamenti bizottság'],
  egyeb_politikai: ['tbl_egyeb_politikai_poz', 'Egyéb politikai adatok'], perek: ['tbl_perek_iteletek', 'Perek, ítéletek'],
  zsidotorvenyek: ['tbl_zsidotorvenyek', 'Zsidótörvények'], vagyon: ['tbl_vagyoni_helyzet', 'Vagyoni helyzet'], lakas: ['tbl_lakas', 'Lakás'],
  haztartas: ['tbl_haztartas_tagok', 'Háztartás'], foglalkozasok: ['tbl_foglalkozasok', 'Foglalkozások'],
};
const PK = { tbl_karrier: 'karrierid', tbl_vallas: 'vallasid', tbl_nemesseg: 'nemessegid', tbl_nevvaltoztatasok: 'nevvaltoztatasid', tbl_tanulmanyok: 'tanulmanyid',
  tbl_csaladi_kapcsolatok_kodolt: 'kapcsolatid', tbl_foglalkozasok: 'foglalkozasid', tbl_katonaiszolgalat: 'katonaiid', tbl_kulfolditartozkodasok: 'tartoskodasid',
  tbl_vagyoni_helyzet: 'vagyonid', tbl_lakas: 'lakasid', tbl_haztartas_tagok: 'haztartasid' };
const pk = t => PK[t] || 'azonosító';
// a profil szakaszai és a bennük szerkeszthető adatok
const SZAKASZ_SZERK = {
  csalad: { kv: [['testverekszama', 'Testvérek száma'], ['hazassagokszama', 'Házasságok száma'], ['elsohazassagev', 'Első házasság éve', 'ev'], ['hazaskor', 'Életkor a házasságkötéskor'],
    ['gyerekekszama', 'Gyerekek száma'], ['csaladiallapot1928', 'Családi állapot 1928 (kód)'], ['csaladiallapot1938', 'Családi állapot 1938 (kód)'], ['csaladiallapot1942', 'Családi állapot 1942 (kód)'],
    ['apahalalev', 'Apa halála (kategória, kód)'], ['anyahalalev', 'Anya halála (kategória, kód)']], rokon: true, listak: [] },
  vallas: { listak: ['vallas'] }, nemesseg: { listak: ['nemesseg', 'nevvaltoztatasok'] }, tanulmanyok: { listak: ['tanulmanyok'] },
  karrier: { listak: ['karrier', 'karrierpoziciok'] },
  kituntetes: { listak: ['kituntetes_hazai', 'kituntetes_kulfoldi', 'csapat_ermek', 'dijak', 'diszdoktoratus', 'akad_kituntetesek'] },
  szervezet: { listak: ['szervezet_belfold', 'szervezet_kulfold'] },
  politika: { listak: ['parttagsag', 'part_megfigyeles', 'felsohaz_tagsag', 'felsohaz_pozicio', 'parl_bizottsag', 'egyeb_politikai', 'perek', 'zsidotorvenyek'] },
  katonai: { listak: ['katonai'] }, kulfold: { listak: ['kulfold'] }, vagyon: { listak: ['vagyon', 'lakas', 'haztartas'] },
  foglalkozasok: { listak: ['foglalkozasok'] },
};
const KARRIER_OSZL = ['elsoev', 'utolsoev', 'foglalkozas', 'munkahely', 'helyszin'];
const CIMKE = { ev: 'Év', sorszam: 'Sorszám', kituntetekod: 'Kitüntetés (kód)', orszagkod: 'Ország', helyszinkod: 'Helyszín', lista: 'Lista', tipus: 'Típus',
  dijakkod: 'Adományozó', dijaknev: 'Díj neve', egyetemkod: 'Egyetem', szervezetnev: 'Szervezet', belepesev: 'Belépés éve', alhelyszin: 'Alhelyszín (kód)',
  partkod: 'Párt', tol: 'Tól', ig: 'Ig', thb_yn: 'Tag', jelkod: 'Pozíció (kód)', bizottsagkod: 'Bizottság (kód)', szerep: 'Szerep', ertek: 'Érték',
  tipuskod: 'Eljárás típusa', ugycod: 'Ügy (kód)', ho: 'Hónap', jelenlegivallas: 'Felekezet', vallasvaltoztatassorszam: 'Áttérés sorszáma',
  vallasvaltoztataseve: 'Áttérés éve', regivallas: 'Régi vallás', ujvallas: 'Új vallás', nemese: 'Nemes', nemessegeve: 'Nemesség éve', fonemese: 'Főnemesi rang (kód)',
  fonemessegeve: 'Főnemesség éve', nevvaltoztatassorszam: 'Sorszám', nevvaltoztataseve: 'Névváltoztatás éve', reginev: 'Régi név (kód)',
  velelmezetettnemzetiseg: 'Vélelmezett nemzetiség', iskolatipus: 'Szint', iskolaid: 'Iskola (kód)', egyetemid: 'Egyetem', 'vegzettségkod': 'Végzettség (kód)',
  munkatipuskod: 'Munkatípus (kód)', kezdoev: 'Kezdés éve', befejezesev: 'Befejezés éve', tanitasinyelv: 'Tanítási nyelv (kód)', szak: 'Szak',
  diplomaev: 'Diploma éve', diplomafajta: 'Diploma fajtája (kód)', vegev: 'Vége', vilaghaborukod: 'Világháború', kategoria: 'Kategória (kód)',
  rendfokozat: 'Rendfokozat (kód)', frontzaszlo1: 'Front 1', frontzaszlo1honap: 'Front 1 (hónap)', frontzaszlo2: 'Front 2', frontzaszlo2honap: 'Front 2 (hónap)',
  sebesulesekszama: 'Sebesülések', viteze: 'Vitéz', munkaszolgalate: 'Munkaszolgálat', hadifoge: 'Hadifogság', fizetes: 'Fizetés', orokles: 'Öröklés',
  haztartas: 'Háztartás', igazgatosagitag: 'Igazgatósági tagság', forgotokkorhaz: 'Forgalmi adó (kórház)', forgotokakademia: 'Forgalmi adó (akadémia)',
  adoalap: 'Adóalap', jelenlevokszama: 'Jelenlévők', tavollevokszama: 'Távollévők', haztartasialkalmazottak: 'Háztartási alkalmazottak', gyerekek: 'Gyerekek',
  masrokon: 'Más rokon', hazastars: 'Házastárs', apa: 'Apa', anya: 'Anya', apos: 'Após', anyos: 'Anyós', nagyapa: 'Nagyapa', nagyanya: 'Nagyanya',
  elsoev: 'Első év', utolsoev: 'Utolsó év', foglalkozas: 'Foglalkozás', munkahely: 'Munkahely', helyszin: 'Helyszín', idopontkod: 'Mikor', leiras: 'Leírás',
  kezdeteve: 'Kapcsolat kezdete', vegeeve: 'Kapcsolat vége', gyermekmelyikhazassagbol: 'Melyik házasságból',
  ...Object.fromEntries(['1914', '1922', '1928', '1933', '1938', '1942', '1947'].map(y => ['pozkod_' + y, 'Pozíció ' + y + ' (kód)'])),
};
function cimke(m) { return CIMKE[m] || LAKAS[m] || ZST[m] || m; }
function mezoTipus(tabla, m) {
  if (['orszagkod', 'helyszinkod', 'halalhelymegyekod', 'szuletesiorszagkod'].includes(m)) return 'hely';
  if (m === 'partkod') return 'part';
  if (['jelenlegivallas', 'regivallas', 'ujvallas'].includes(m)) return 'vallas';
  if (tabla === 'tbl_kituntetes_hazai' && m === 'kituntetekod') return 'kithazai';
  if (tabla === 'tbl_tanulmanyok' && m === 'diplomafajta') return 'diploma';
  if (m === 'iskolatipus') return 'iskolatipus';
  if (m === 'egyetemid') return 'egyetem';
  if (m === 'idopontkod') return 'idopont';
  if (['nemese', 'viteze', 'munkaszolgalate', 'thb_yn', 'doktoricim', 'szerzetese'].includes(m)) return 'bool';
  if (!/nev$/.test(m) && (/(ev|eve|_tol|_ig)$/.test(m) || ['tol', 'ig'].includes(m))) return 'ev';
  return 'text';
}
// a sorjavítások alkalmazása a megjelenített adatokra (az eredeti érték a sor _eredeti mezőjében marad)
function utolsoJavitasok(J) {
  const m = new Map();
  for (const j of J) { if (j.elfogadott === false || j.mezo === '_uj') continue; m.set(`${j.tabla}|${j.rekord_id}|${j.mezo}`, j); }
  return m;
}
function sorAlkalmaz(row, tabla, L) {
  const id = row[pk(tabla)];
  if (L.has(`${tabla}|${id}|_torles`)) return null;
  const out = { ...row, _jav: [], _eredeti: {} };
  for (const k of Object.keys(row)) {
    const j = L.get(`${tabla}|${id}|${k}`);
    if (j) { out._eredeti[k] = row[k]; out[k] = j.ertek; out._jav.push(k); }
  }
  for (const [key, j] of L) { const [t, r, m] = key.split('|'); if (t === tabla && Number(r) === Number(id) && !(m in row) && !m.startsWith('_')) { out[m] = j.ertek; out._jav.push(m); } }
  return out;
}
function sorJavitasokAlkalmaz(P) {
  const L = utolsoJavitasok(P.sorjavitasok || []);
  for (const [key, [tabla]] of Object.entries(LISTA)) {
    if (key === 'karrier' || !P[key]) continue;
    P[key] = P[key].map(r => sorAlkalmaz(r, tabla, L)).filter(Boolean);
  }
  (P.foglalkozasok || []).forEach(f => { f.mikor = (S.kt.idopont.find(i => i.idopontkod === f.idopontkod) || {}).idopontnev || f.idopontkod; });
  (P.tanulmanyok || []).forEach(t => { if (t._jav.includes('egyetemid')) t.egyetem = S.kt.egyetem.get(Number(t.egyetemid)) || (t.egyetemid ? 'egyetem ' + t.egyetemid : null); });
  // rokonok: a kapcsolat törlése, a rokon alapadatainak javítása, foglalkozásaik
  const RA = new Map();
  (P.rokon_allitasok || []).filter(a => a.elfogadott !== false && a.tabla === 'tbl_szemelyek').forEach(a => RA.set(`${a.szemelyid}|${a.mezo}`, a.ertek));
  P.csalad = (P.csalad || []).filter(c => !L.has(`tbl_csaladi_kapcsolatok_kodolt|${c.kapcsolatid}|_torles`)).map(c => {
    const o = { ...c, _jav: [] };
    for (const m of ['vezeteknev', 'keresztnev', 'szuletesiev', 'szuletesihely']) if (RA.has(`${c.rokonid}|${m}`)) { o[m] = RA.get(`${c.rokonid}|${m}`); o._jav.push(m); }
    for (const [m, k] of [['gyermekmelyikhazassagbol', 'hazassagbol'], ['kezdeteve', 'kezdeteve'], ['vegeeve', 'vegeeve']]) {
      const j = L.get(`tbl_csaladi_kapcsolatok_kodolt|${c.kapcsolatid}|${m}`); if (j) { o[k] = j.ertek; o._jav.push(k); }
    }
    o.nev = `${o.vezeteknev || ''} ${o.keresztnev || ''}`.trim();
    o.foglalkozasok = (c.foglalkozasok || []).map(f => sorAlkalmaz(f, 'tbl_foglalkozasok', L)).filter(Boolean)
      .map(f => ({ ...f, mikor: (S.kt.idopont.find(i => i.idopontkod === f.idopontkod) || {}).idopontnev || f.idopontkod }));
    return o;
  });
}
function javJel(s) {
  if (!s || !s._jav || !s._jav.length) return '';
  return ` <span class="muted small" title="${esc('Javítva: ' + s._jav.map(m => `${cimke(m)} (eredetileg: ${s._eredeti?.[m] ?? '—'})`).join('; '))}">*</span>`;
}

// egy mező beviteli eleme
function bevitel(tip, v, szul) {
  const kt = S.kt, ertek = v === null || v === undefined ? '' : String(v);
  const opt = (pairs) => `<select><option value="">—</option>${pairs.map(([k, n]) => `<option value="${esc(k)}" ${String(k) === ertek ? 'selected' : ''}>${esc(n)}</option>`).join('')}${ertek && !pairs.some(([k]) => String(k) === ertek) ? `<option value="${esc(ertek)}" selected>kód ${esc(ertek)}</option>` : ''}</select>`;
  if (tip === 'hely') return opt([...kt.hely.entries()].sort((a, b) => a[1].localeCompare(b[1], 'hu')));
  if (tip === 'part') return opt([...kt.part.entries()]);
  if (tip === 'kithazai') return opt([...kt.kitHazai.entries()]);
  if (tip === 'diploma') return opt([...kt.diploma.values()].map(d => [d.kodertek, `${d.kodertek} – ${d.nev}`]));
  if (tip === 'vallas') return opt([...kt.vallas.values()].map(c => [c.kodertek, c.nev + (c.statusz === 'következtetett' ? ' (?)' : '')]));
  if (tip === 'iskolatipus') return opt([['altalanos', 'alapfok'], ['kozep', 'középfok'], ['felso', 'felsőfok']]);
  if (tip === 'egyetem') return opt([...kt.egyetem.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'hu')));
  if (tip === 'idopont') return opt(kt.idopont.map(i => [i.idopontkod, i.idopontnev]));
  if (tip === 'bool') return opt([['1', 'igen'], ['0', 'nem']]);
  if (tip === 'viszony') return opt([['apa', 'apa'], ['anya', 'anya'], ['házastárs', 'házastárs'], ['gyermek', 'gyermek']]);
  if (tip === 'ev') return `<input inputmode="numeric" placeholder="éééé" value="${esc(ertek === '' ? '' : ev(ertek, szul))}">`;
  return `<input value="${esc(ertek)}">`;
}
function mezoHtml(m, cim, tip, v, szul) {
  const eredeti = v === null || v === undefined ? '' : String(tip === 'ev' && v !== '' ? ev(v, szul) : v);
  return `<label data-m="${esc(m)}" data-tip="${tip}" data-eredeti="${esc(eredeti)}">${esc(cim)}${bevitel(tip, v, szul)}</label>`;
}
// egy sor kártyája: a kitöltött mezők látszanak, az üresek lenyithatók
function sorKartya(tabla, oszl, row, szul, opts = {}) {
  const uj = !row;
  const mezok = oszl.map(m => ({ m, tip: mezoTipus(tabla, m), v: row ? row[m] : null }));
  const tele = mezok.filter(x => x.v !== null && x.v !== undefined && x.v !== ''), ures = mezok.filter(x => !tele.includes(x));
  const html = a => a.map(x => mezoHtml(x.m, cimke(x.m), x.tip, x.v, szul)).join('');
  const J = (opts.javitasok || []);
  return `<div class="sor-kartya ${uj ? 'uj' : ''}" data-tabla="${tabla}" data-id="${uj ? '' : esc(row[pk(tabla)])}" data-szemely="${opts.szemely || ''}">
    ${opts.fejlec ? `<div class="sor-fej">${opts.fejlec}</div>` : ''}
    <div class="szerk-racs">${uj && mezok.length <= 14 ? html(mezok) : html(tele)}</div>
    ${!(uj && mezok.length <= 14) && ures.length ? `<details ${uj ? 'open' : ''}><summary class="small muted">${uj ? 'Mezők' : `Üres mezők (${ures.length})`}</summary><div class="szerk-racs">${html(ures)}</div></details>` : ''}
    ${J.length ? `<div class="small muted">Javítások: ${J.map(j => `${esc(cimke(j.mezo === '_torles' ? 'törlés' : j.mezo))}${j.mezo === '_torles' ? '' : ' → ' + esc(j.ertek ?? '—')} <span>(${esc(j.rogzitette || '')})</span>${j.elfogadott === false ? ' <i>visszavonva</i>' : ` <button type="button" class="btn small" data-sv="${j.javitas_id}">Visszavonás</button>`}`).join(' · ')}</div>` : ''}
    <div class="sor-lab">${uj ? '<button type="button" class="btn small" data-elvet>Mégse</button>' : '<label class="torles"><input type="checkbox" data-torles> Sor törlése</label>'}</div>
  </div>`;
}
function oszlopok(tabla) {
  if (tabla === 'tbl_karrier') return KARRIER_OSZL;
  return (S.kt.oszlopok[tabla] || []).map(o => o.oszlop);
}
async function szakaszSzerk(P, id, k) {
  const def = SZAKASZ_SZERK[k], szul = ev(P.szemely.szuletesiev), r = P.reszletek || {};
  const J = (P.sorjavitasok || []);
  const jOf = (t, rid) => J.filter(j => j.tabla === t && Number(j.rekord_id) === Number(rid) && j.mezo !== '_uj');
  const allit = {}; (P.allitasok || []).filter(a => a.elfogadott !== false).forEach(a => { allit[a.tabla + '.' + a.mezo] = a.ertek; });
  const box = $('#urlap-' + k);
  $('#nezet-' + k).classList.add('hidden'); box.parentElement.querySelector('[data-szakasz]').classList.add('hidden');
  let h = '<p class="muted small">Csak a megváltoztatott mezők mentődnek, új bejegyzésként; az eredeti érték megmarad, és minden javítás visszavonható. Törlésnél a sor nem vész el, csak érvénytelennek jelöljük.</p>';
  if (def.kv) h += `<h4>Adatok</h4><div class="szerk-racs" data-kv>${def.kv.map(([m, c, tip]) => {
    const v = ('tbl_elittag_reszletek.' + m) in allit ? allit['tbl_elittag_reszletek.' + m] : r[m];
    return mezoHtml('tbl_elittag_reszletek.' + m, c, tip || 'text', v, szul); }).join('')}</div>`;
  if (def.rokon) {
    h += '<h4>Rokonok</h4><div data-rokonok>' + (P.csalad || []).map(c => `<div class="sor-kartya rokon" data-kapcsolat="${c.kapcsolatid}" data-rokon="${c.rokonid}">
      <div class="sor-fej"><b>${esc(SZEREP[c.szerep] || (c.szerep || '').toLowerCase().replace('_', ' ') || c.viszony)}</b></div>
      <div class="szerk-racs" data-szemelymezok>${mezoHtml('vezeteknev', 'Vezetéknév', 'text', c.vezeteknev, szul)}${mezoHtml('keresztnev', 'Keresztnév', 'text', c.keresztnev, szul)}
        ${mezoHtml('szuletesiev', 'Születési év', 'ev', c.szuletesiev, szul)}${mezoHtml('szuletesihely', 'Születési hely', 'text', c.szuletesihely, szul)}</div>
      <div class="szerk-racs" data-kapcsolatmezok>${c.viszony === 'gyermek' ? mezoHtml('gyermekmelyikhazassagbol', 'Melyik házasságból', 'text', c.hazassagbol, szul) : ''}
        ${c.viszony === 'házastárs' ? mezoHtml('kezdeteve', 'Házasság kezdete', 'ev', c.kezdeteve, szul) + mezoHtml('vegeeve', 'Házasság vége', 'ev', c.vegeeve, szul) : ''}</div>
      <div class="small muted" style="margin-top:6px">Foglalkozásai</div>
      <div data-fogl-lista>${(c.foglalkozasok || []).map(f => sorKartya('tbl_foglalkozasok', ['idopontkod', 'foglalkozas'], f, szul, { szemely: c.rokonid, javitasok: jOf('tbl_foglalkozasok', f.foglalkozasid) })).join('')}</div>
      <button type="button" class="btn small" data-uj-fogl="${c.rokonid}">+ Foglalkozás</button>
      ${jOf('tbl_csaladi_kapcsolatok_kodolt', c.kapcsolatid).length ? `<div class="small muted">Javítások: ${jOf('tbl_csaladi_kapcsolatok_kodolt', c.kapcsolatid).map(j => `${esc(j.mezo === '_torles' ? 'törlés' : cimke(j.mezo))} ${j.elfogadott === false ? '<i>visszavonva</i>' : `<button type="button" class="btn small" data-sv="${j.javitas_id}">Visszavonás</button>`}`).join(' · ')}</div>` : ''}
      <div class="sor-lab"><label class="torles"><input type="checkbox" data-torles> Rokoni kapcsolat törlése</label></div></div>`).join('') + '</div>'
      + '<button type="button" class="btn" data-uj-rokon>+ Új rokon</button>';
  }
  for (const key of def.listak) {
    const [tabla, cim] = LISTA[key], oszl = oszlopok(tabla);
    h += `<h4>${esc(cim)}</h4><div data-lista="${key}">${(P[key] || []).map(row => sorKartya(tabla, oszl, row, szul, { szemely: id, javitasok: jOf(tabla, row[pk(tabla)]) })).join('') || '<p class="muted small">Nincs sor.</p>'}</div>
      <button type="button" class="btn small" data-uj-sor="${key}">+ Új sor: ${esc(cim.toLowerCase())}</button>`;
  }
  box.innerHTML = `<form class="form" id="szf-${k}">${h}${forrasValaszto('sf' + k)}
    <div class="toolbar"><button class="btn primary" type="submit">Mentés</button><button class="btn" type="button" data-megse>Mégse</button></div><div id="szmsg-${k}"></div></form>`;
  const f = $('#szf-' + k);
  $('#sf' + k + '-fs').addEventListener('change', e => $('#sf' + k + '-uj').classList.toggle('hidden', e.target.value !== 'uj'));
  f.querySelector('[data-megse]').addEventListener('click', () => { box.innerHTML = ''; $('#nezet-' + k).classList.remove('hidden'); box.parentElement.querySelector('[data-szakasz]').classList.remove('hidden'); });
  f.addEventListener('click', async e => {
    const t = e.target;
    if (t.dataset.ujSor !== undefined && t.dataset.ujSor) {
      const [tabla] = LISTA[t.dataset.ujSor]; const lista = f.querySelector(`[data-lista="${t.dataset.ujSor}"]`);
      lista.querySelector('p.muted')?.remove(); lista.insertAdjacentHTML('beforeend', sorKartya(tabla, oszlopok(tabla), null, szul, { szemely: id }));
    } else if (t.dataset.ujFogl) {
      t.previousElementSibling.insertAdjacentHTML('beforeend', sorKartya('tbl_foglalkozasok', ['idopontkod', 'foglalkozas'], null, szul, { szemely: t.dataset.ujFogl }));
    } else if (t.dataset.ujRokon !== undefined) {
      f.querySelector('[data-rokonok]').insertAdjacentHTML('beforeend', `<div class="sor-kartya uj rokon-uj"><div class="sor-fej"><b>Új rokon</b></div><div class="szerk-racs">
        ${mezoHtml('viszony', 'Viszony', 'viszony', '', szul)}${mezoHtml('vezeteknev', 'Vezetéknév', 'text', '', szul)}${mezoHtml('keresztnev', 'Keresztnév', 'text', '', szul)}
        ${mezoHtml('szuletesiev', 'Születési év', 'ev', '', szul)}${mezoHtml('szuletesihely', 'Születési hely', 'text', '', szul)}${mezoHtml('hazassagbol', 'Melyik házasságból (gyermeknél)', 'text', '', szul)}
        ${mezoHtml('foglalkozas', 'Foglalkozás (alapfoglalkozás)', 'text', '', szul)}</div><div class="sor-lab"><button type="button" class="btn small" data-elvet>Mégse</button></div></div>`);
    } else if (t.dataset.elvet !== undefined) {
      t.closest('.sor-kartya').remove();
    } else if (t.dataset.sv) {
      if (!confirm('Visszavonod ezt a javítást?')) return;
      try { await q(sb.rpc('sorjavitas_visszavon', { p_javitas_id: Number(t.dataset.sv) })); szemelyLap(id).then(() => $('#sz-' + k)?.scrollIntoView()); } catch (err) { alert('Hiba: ' + hibaSzoveg(err)); }
    }
  });
  f.addEventListener('change', e => { const c = e.target.closest('.sor-kartya'); if (c && e.target.dataset.torles !== undefined) c.classList.toggle('torolve', e.target.checked); });
  const ertekek = (root, csakValtozott) => {
    const o = {};
    root.querySelectorAll(':scope > .szerk-racs > label[data-m], :scope > details > .szerk-racs > label[data-m]').forEach(l => {
      const v = l.querySelector('input,select').value.trim();
      if (csakValtozott && v === l.dataset.eredeti) return;
      if (l.dataset.tip === 'ev' && v && !/^\d{4}$/.test(v)) throw new Error(`${l.firstChild.textContent}: négyjegyű évszámot adj meg.`);
      o[l.dataset.m] = v;
    });
    return o;
  };
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = f.querySelector('button[type=submit]'), uz = $('#szmsg-' + k);
    const muveletek = [];
    try {
      // személyszintű mezők
      const kvb = f.querySelector('[data-kv]');
      if (kvb) { const o = {}; kvb.querySelectorAll('label[data-m]').forEach(l => { const v = l.querySelector('input,select').value.trim(); if (v !== l.dataset.eredeti) { if (l.dataset.tip === 'ev' && v && !/^\d{4}$/.test(v)) throw new Error(`${l.firstChild.textContent}: négyjegyű évszámot adj meg.`); o[l.dataset.m] = v; } });
        if (Object.keys(o).length) muveletek.push(['javit_mezok', { p_szemelyid: id, p_valtozasok: o }]); }
      // rokonok
      f.querySelectorAll('.sor-kartya.rokon').forEach(c => {
        if (c.querySelector(':scope > .sor-lab [data-torles]')?.checked) { muveletek.push(['javit_sor', { p_tabla: 'tbl_csaladi_kapcsolatok_kodolt', p_rekord_id: Number(c.dataset.kapcsolat), p_valtozasok: { _torles: '1' } }]); return; }
        const sz = {}; c.querySelectorAll('[data-szemelymezok] label[data-m]').forEach(l => { const v = l.querySelector('input,select').value.trim(); if (v !== l.dataset.eredeti) { if (l.dataset.tip === 'ev' && v && !/^\d{4}$/.test(v)) throw new Error('Születési év: négyjegyű évszámot adj meg.'); sz['tbl_szemelyek.' + l.dataset.m] = v; } });
        if (Object.keys(sz).length) muveletek.push(['javit_mezok', { p_szemelyid: Number(c.dataset.rokon), p_valtozasok: sz }]);
        const ka = {}; c.querySelectorAll('[data-kapcsolatmezok] label[data-m]').forEach(l => { const v = l.querySelector('input,select').value.trim(); if (v !== l.dataset.eredeti) ka[l.dataset.m] = v; });
        if (Object.keys(ka).length) muveletek.push(['javit_sor', { p_tabla: 'tbl_csaladi_kapcsolatok_kodolt', p_rekord_id: Number(c.dataset.kapcsolat), p_valtozasok: ka }]);
      });
      f.querySelectorAll('.sor-kartya.rokon-uj').forEach(c => {
        const o = ertekek(c, false);
        if (!o.viszony) throw new Error('Új rokon: válaszd ki a rokoni viszonyt.');
        muveletek.push(['rokon_uj', { p_szemelyid: id, p_viszony: o.viszony, p_vezeteknev: o.vezeteknev || null, p_keresztnev: o.keresztnev || null,
          p_szuletesiev: o.szuletesiev ? Number(o.szuletesiev) : null, p_szuletesihely: o.szuletesihely || null, p_hazassagbol: o.hazassagbol ? Number(o.hazassagbol) : null }, o.foglalkozas]);
      });
      // listasorok (a rokonok foglalkozásai is)
      f.querySelectorAll('.sor-kartya[data-tabla]').forEach(c => {
        const tabla = c.dataset.tabla;
        if (c.classList.contains('uj')) {
          const o = ertekek(c, false); Object.keys(o).forEach(m => { if (!o[m]) delete o[m]; });
          if (tabla === 'tbl_foglalkozasok' && o.foglalkozas && !o.idopontkod) o.idopontkod = 'alap';
          if (Object.keys(o).length) muveletek.push(['sor_uj', { p_tabla: tabla, p_szemelyid: Number(c.dataset.szemely), p_ertekek: o }]);
          return;
        }
        if (c.querySelector(':scope > .sor-lab [data-torles]')?.checked) { muveletek.push(['javit_sor', { p_tabla: tabla, p_rekord_id: Number(c.dataset.id), p_valtozasok: { _torles: '1' } }]); return; }
        const o = ertekek(c, true);
        if (Object.keys(o).length) muveletek.push(['javit_sor', { p_tabla: tabla, p_rekord_id: Number(c.dataset.id), p_valtozasok: o }]);
      });
      if (!muveletek.length) { msg(uz, 'Nem változott semmi.', 'info'); return; }
      btn.disabled = true;
      const fid = await forrasAzonosito('sf' + k), hiv = $('#sf' + k + '-hiv').value || null, megj = $('#sf' + k + '-megj').value || null;
      let n = 0;
      for (const [fn, args, fogl] of muveletek) {
        const a = { ...args, p_forras_id: fid };
        a.p_hivatkozas = hiv; a.p_megjegyzes = megj;
        const { data } = await q(sb.rpc(fn, a));
        if (fn === 'rokon_uj' && fogl) await q(sb.rpc('sor_uj', { p_tabla: 'tbl_foglalkozasok', p_szemelyid: data, p_ertekek: { idopontkod: 'alap', foglalkozas: fogl }, p_forras_id: fid, p_hivatkozas: hiv, p_megjegyzes: megj }));
        n++;
      }
      msg(uz, `${n} módosítás rögzítve.`, 'ok');
      setTimeout(() => szemelyLap(id).then(() => $('#sz-' + k)?.scrollIntoView()), 700);
    } catch (err) { btn.disabled = false; hibaKiir(uz, err); }
  });
}

async function szemelyLap(id) {
  location.hash = 'szemely=' + id;
  app.innerHTML = '<div class="empty">Betöltés…</div>';
  try {
    await kodtablak();
    const { data: P } = await q(sb.rpc('szemely_osszes', { p_id: id }));
    if (!P || !P.szemely) { app.innerHTML = '<div class="empty">Nincs ilyen személy.</div>'; return; }
    S.szerkCache.delete(id);
    S.szerkEz = await szerkHet(id);
    const [{ data: csop }, { data: tagsag }] = await Promise.all([
      q(sb.from('tbl_csoportok').select('csoport_id,nev').order('nev')),
      q(sb.from('tbl_csoport_tagok').select('csoport_id,elfogadott').eq('szemelyid', id)),
    ]);
    const tagja = new Set((tagsag || []).filter(t => t.elfogadott !== false).map(t => t.csoport_id));
    sorJavitasokAlkalmaz(P);
    const R = profilRender(P, id);
    const sz = P.szemely;
    app.innerHTML = `<p><a href="#" id="vissza">‹ Vissza a listához</a></p>
      <div class="fejlec"><div><h2>${esc(R.nev)}</h2>
        ${R.elit ? '' : `<p><span class="badge b-gray">családtag</span> ${P.elittag ? `${esc(szerepNev((sz.eredetiazon2 || '').toLowerCase().replace(/_(\d+)$/, ' $1').replace(/_/g, ' ')))} – elittag: <a href="#szemely=${P.elittag.szemelyid}" data-szem="${P.elittag.szemelyid}">${esc(P.elittag.nev)}</a>` : ''}</p>`}
        <p class="muted">${R.szul ? esc(R.szul) : '?'}${P.reszletek && P.reszletek.halalev ? '–' + esc(ev(P.reszletek.halalev, R.szul)) : ''} · ${esc(sz.szuletesihely || '')} · SzemélyID: ${id}</p>
        <p class="small">Csoport: ${(csop || []).map(c => S.szerkEz
          ? `<label class="csop-tag"><input type="checkbox" data-csop="${c.csoport_id}" ${tagja.has(c.csoport_id) ? 'checked' : ''}> ${esc(c.nev)}</label>`
          : (tagja.has(c.csoport_id) ? `<span class="badge b-info">${esc(c.nev)}</span>` : '')).join(' ') || '<span class="muted">—</span>'}
          ${S.szerkEz ? '' : ' <span class="badge b-gray">csak olvasható számodra</span>'}</p></div>
        <nav class="ugro">${R.tartalom.map(t => `<a href="#" data-ugro="${t[0]}">${esc(t[1])}</a>`).join('')}</nav></div>
      <div class="legend"><span>${forrasBadge('KIG-féle kutatás', 'KIG-féle kutatás')} KIG-féle kutatás</span><span>${forrasBadge('x', 'ElitData2026')} ElitData2026</span><span><span class="kod">kód N</span> a jelentése a KIG-kódkönyvből pótlandó</span></div>
      ${csoportSav(id)}
      ${R.nyit.length ? `<div class="msg info">${R.nyit.length} nyitott kérdés: ${R.nyit.map(n => esc(n.tipus)).join(', ')}.</div>` : ''}
      ${R.tartalom.map(([k, cim, html, n]) => `<div id="sz-${k}"><section class="card szakasz"><h3>${esc(cim)}${n ? ` <span class="muted small">(${n})</span>` : ''}</h3>${
        S.szerkEz && SZAKASZ_SZERK[k] ? `<div class="szerk-gomb"><button class="btn" data-szakasz="${k}">Szerkesztés</button></div><div id="nezet-${k}">${html}</div><div id="urlap-${k}"></div>` : html}</section></div>`).join('')}`;
    $('#vissza').addEventListener('click', e => { e.preventDefault(); if (S.csoportNav && S.csoportNav.ids.includes(id)) { valt('csoportok', false); csoportLap(S.csoportNav.cs, S.csoportNav.nezet); } else szemelyekLap(); });
    csoportSavKezel(id);
    szemLinkek(app);
    $('#alap-szerk')?.addEventListener('click', () => alapSzerkeszt(P, id));
    app.querySelectorAll('[data-szakasz]').forEach(b => b.addEventListener('click', () => szakaszSzerk(P, id, b.dataset.szakasz)));
    app.querySelectorAll('[data-visszavon]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Biztosan visszavonod ezt a javítást? Az eredeti érték lesz ismét érvényes.')) return;
      try { await q(sb.rpc('javitas_visszavon', { p_allitas_id: Number(b.dataset.visszavon) })); szemelyLap(id); } catch (err) { alert('Hiba: ' + hibaSzoveg(err)); }
    }));
    app.querySelectorAll('[data-ugro]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); $('#sz-' + a.dataset.ugro).scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
    app.querySelectorAll('[data-csop]').forEach(cb => cb.addEventListener('change', async () => {
      try { await q(sb.rpc('csoport_tag', { p_csoport_id: Number(cb.dataset.csop), p_szemelyid: id, p_be: cb.checked })); }
      catch (err) { cb.checked = !cb.checked; alert('Hiba: ' + hibaSzoveg(err)); }
    }));
    $('#kar-tbl tbody')?.addEventListener('click', e => {
      const kb = e.target.closest('[data-kj]');
      if (kb) { karrierSzerk(Number(kb.dataset.kj), $('#detail'), () => szemelyLap(id).then(() => $('#sz-karrier')?.scrollIntoView())).catch(err => hibaKiir($('#detail'), err)); $('#detail').scrollIntoView({ behavior: 'smooth' }); return; }
      const tr = e.target.closest('tr[data-h]'); if (!tr) return;
      harmReszlet(Number(tr.dataset.h), $('#detail'), () => szemelyLap(id)).catch(err => hibaKiir($('#detail'), err));
      $('#detail').scrollIntoView({ behavior: 'smooth' });
    });
  } catch (e) { hibaKiir(app, e); }
}

// ---------- Karrierállomás javítása (évkódok is) ----------
const KMEZO = [['elsoev', 'Első év', 'ev'], ['utolsoev', 'Utolsó év', 'ev'], ['foglalkozas', 'Foglalkozás', 'text'], ['munkahely', 'Munkahely', 'text'], ['helyszin', 'Helyszín', 'text']];
function evkodJeloltek(leiras, szul) {
  const m = /(\d+)/.exec(leiras || ''); if (!m) return [];
  const d = m[1], parok = d.length === 4 ? [[d.slice(0, 2), d.slice(2)]] : d.length === 2 ? [[d, d]] : [];
  const ki = [];
  const probal = (a, b, fordított) => { for (const [sa, sb2] of [['18', '18'], ['19', '19'], ['18', '19']]) {
    const x = Number(sa + a), y = Number(sb2 + b);
    if (y < x || ki.some(k => k[0] === x && k[1] === y)) continue;
    const ok = !szul || (x >= Number(szul) + 10 && y <= Number(szul) + 95 && y <= 1990);
    ki.push([x, y, ok, fordított]);
  } };
  for (const [a, b] of parok) {
    probal(a, b, false);
    // ha a második év kisebb, valószínűleg felcserélődött a két év: a fordított sorrendet is felkínáljuk
    if (Number(b) < Number(a)) probal(b, a, true);
  }
  return ki;
}
async function karrierSzerk(karrierid, d, utana) {
  const [{ data: k }, { data: jav }] = await Promise.all([
    q(sb.from('v_karrier_reszletes').select('*').eq('karrierid', karrierid).single()),
    q(sb.from('tbl_sor_javitasok').select('*').eq('tabla', 'tbl_karrier').eq('rekord_id', karrierid).order('rogzitve', { ascending: false })),
  ]);
  const { data: sz } = await q(sb.from('tbl_szemelyek').select('vezeteknev,keresztnev,szuletesiev').eq('szemelyid', k.szemelyid).single());
  await kodtablak(); const kd = await kodok();
  const szul = ev(sz.szuletesiev), szerk = await szerkHet(k.szemelyid), e0 = k.eredeti || {};
  const HM = [['harmonizalt', 'Harmonizált foglalkozás', kd.harmonizalt], ['hivatas1', 'Hivatás1', ['NINCS', ...kd.hivatas1]], ['hivatas2', 'Hivatás2', ['NINCS', ...kd.hivatas2]], ['specifikacio', 'Specifikáció', null]];
  const hmMezo = ([m, cim, lista]) => { const v = k[m] || '';
    return `<label data-hm="${m}" data-eredeti="${esc(v)}">${cim}${lista ? `<select id="kh-${m}"><option value="">(üres)</option>${(lista.includes(v) || !v ? lista : [v, ...lista]).map(x => `<option ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>` : `<input id="kh-${m}" value="${esc(v)}">`}</label>`; };
  const evkod = k.leiras && k.leiras.startsWith('? kód');
  const jel = evkod ? evkodJeloltek(k.leiras, szul) : [];
  const ertek = m => k[m] === null || k[m] === undefined ? '' : String(m.endsWith('ev') ? ev(k[m], szul) : k[m]);
  d.innerHTML = `<div class="card"><h3 style="margin-top:0">Karrierállomás javítása</h3>
    <div class="kv small">
      <div>Személy</div><div><a href="#szemely=${k.szemelyid}" data-szem="${k.szemelyid}">${esc(sz.vezeteknev + ' ' + sz.keresztnev)}</a> <span class="muted">(szül. ${esc(szul || '?')})</span></div>
      <div>Eredeti adat</div><div>${idoszak(e0.elsoev, e0.utolsoev, szul)} · ${esc(e0.foglalkozas || '—')} · ${esc(e0.munkahely || '')} ${esc(e0.helyszin || '')}</div>
      <div>Forrás</div><div>${forrasBadge(k.forras, k.fazis)} ${esc(k.forras)}</div>
      ${evkod ? `<div>Évkód</div><div><span class="badge b-warn">${esc(k.leiras)}</span> <span class="muted">a forrás kétjegyű évpárja (pl. 2023 = ’20–’23); az évszázad nem dönthető el automatikusan</span></div>` : ''}
    </div>
    ${szerk ? `<form class="form" id="kf-f">
      ${jel.length ? `<div><span class="small muted">Lehetséges feloldások (kattintásra kitölti):</span><div class="chips">${jel.map(([x, y, ok, ford]) => `<button type="button" class="chip ${ok ? '' : 'muted'}" data-jel="${x}-${y}" title="${ford ? 'a két év felcserélésével (feltételezett elírás)' : ok ? '' : 'a születési év alapján valószínűtlen'}">${x === y ? x : x + '–' + y}${ford ? ' ⇄' : ''}</button>`).join('')}</div>
        ${jel.some(j => j[3]) ? '<p class="small muted" style="margin:4px 0 0">A kódban a második év kisebb az elsőnél, ez valószínűleg rögzítési hiba. A ⇄ jelű javaslat a két év felcserélésével készült. Csak akkor válaszd, ha a forrás alátámasztja, és a Megjegyzésben jelezd.</p>' : ''}
        ${!jel.some(j => j[2]) ? '<p class="small muted" style="margin:4px 0 0">Egyik feloldás sem illik a születési évhez: valószínűleg elírás van a forrásban. Nézd meg a forrást, és írd be kézzel a helyes éveket.</p>' : ''}</div>` : ''}
      <div class="szerk-racs">${KMEZO.map(([m, cim, tip]) => `<label data-m="${m}" data-tip="${tip}" data-eredeti="${esc(ertek(m))}">${cim}<input id="kf-${m}" value="${esc(ertek(m))}" ${tip === 'ev' ? 'inputmode="numeric" placeholder="éééé"' : ''}></label>`).join('')}</div>
      <h4 style="margin:14px 0 4px">Harmonizált besorolás</h4>
      <p class="small muted" style="margin:0 0 6px">${k.harm_id ? `Jelenleg: ${allapotBadge(k.harm_allapot)}${k.nyitott_ertekek ? ' ' + esc(k.nyitott_ertekek) : ''}. A módosítás egyedi döntésként kerül be; a kódoló által beírt érték megmarad. Üresre állítva a kódolói érték érvényes újra.` : 'Ez az állomás még nincs harmonizálva; mentéskor új besorolás jön létre (forrás: ElitData2026 – döntés a nézegetőben).'} Ha van harmonizált foglalkozás vagy Hivatás1, az üres Hivatás2 NINCS-et jelent.</p>
      <div class="szerk-racs">${HM.map(hmMezo).join('')}</div>
      <label class="torles"><input type="checkbox" id="kf-torol"> A karrierállomás törlése (téves vagy kettős sor) – a sor nem vész el, csak érvénytelennek jelöljük, és visszavonható</label>
      ${forrasValaszto('kf')}
      <div class="toolbar"><button class="btn primary" type="submit">Mentés</button></div><div id="kf-msg"></div>
      <p class="muted small">A javítás új bejegyzésként kerül be; az eredeti adat megmarad és a javítás visszavonható.</p></form>`
      : `<p class="msg info">A karrierállomás adatait nem javíthatod (a személy a hozzád rendelt csoporton kívül esik), a harmonizált besorolását viszont igen.</p>
        <form class="form" id="kh-f"><h4 style="margin:6px 0 4px">Harmonizált besorolás</h4>
        <p class="small muted" style="margin:0 0 6px">${k.harm_id ? 'A módosítás egyedi döntésként kerül be; a kódoló által beírt érték megmarad.' : 'Ez az állomás még nincs harmonizálva; mentéskor új besorolás jön létre.'} Ha van harmonizált foglalkozás vagy Hivatás1, az üres Hivatás2 NINCS-et jelent.</p>
        <div class="szerk-racs">${HM.map(hmMezo).join('')}</div>
        <label>Megjegyzés (nem kötelező)<input id="kh-megj"></label>
        <div class="toolbar"><button class="btn primary" type="submit">Mentés</button></div><div id="kh-msg"></div></form>`}
    ${jav && jav.length ? `<h4>Korábbi javítások</h4><div class="tbl-wrap"><table><thead><tr><th>Mező</th><th>Új érték</th><th>Forrás</th><th>Hivatkozás</th><th>Ki, mikor</th><th></th></tr></thead><tbody>${
      jav.map(x => `<tr class="${x.elfogadott === false ? 'visszavont' : ''}"><td>${esc((KMEZO.find(m => m[0] === x.mezo) || [, x.mezo])[1])}</td><td>${dash(x.ertek)}</td>
        <td class="small">${esc((S.kt.forras.get(x.forras_id) || {}).megnevezes || '')}</td><td class="small">${dash(x.hivatkozas)}${x.megjegyzes ? `<br><span class="muted">${esc(x.megjegyzes)}</span>` : ''}</td>
        <td class="small">${esc(x.rogzitette || '')}<br>${new Date(x.rogzitve).toLocaleString('hu-HU')}</td>
        <td>${x.elfogadott === false ? '<span class="badge b-gray">visszavonva</span>' : (szerk ? `<button class="btn small" type="button" data-sv="${x.javitas_id}">Visszavonás</button>` : '')}</td></tr>`).join('')}</tbody></table></div>` : ''}
  </div>`;
  szemLinkek(d);
  d.querySelectorAll('[data-sv]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Biztosan visszavonod ezt a javítást?')) return;
    try { await q(sb.rpc('sorjavitas_visszavon', { p_javitas_id: Number(b.dataset.sv) })); karrierSzerk(karrierid, d, utana); } catch (err) { alert('Hiba: ' + hibaSzoveg(err)); }
  }));
  if (!szerk) {
    $('#kh-f', d)?.addEventListener('submit', async e => {
      e.preventDefault(); const btn = e.target.querySelector('button[type=submit]'); const hvalt = {};
      d.querySelectorAll('label[data-hm]').forEach(l => { const uj = l.querySelector('select,input').value.trim(); if (uj !== l.dataset.eredeti) hvalt[l.dataset.hm] = uj; });
      if (!Object.keys(hvalt).length) return msg($('#kh-msg', d), 'Nem változott semmi.', 'info');
      btn.disabled = true;
      try { await q(sb.rpc('karrier_harm_ment', { p_karrierid: karrierid, p_ertekek: hvalt, p_megjegyzes: $('#kh-megj', d).value || null }));
        msg($('#kh-msg', d), 'A besorolás rögzítve.', 'ok'); setTimeout(utana, 900);
      } catch (err) { btn.disabled = false; hibaKiir($('#kh-msg', d), err); }
    });
    return;
  }
  d.querySelectorAll('[data-jel]').forEach(b => b.addEventListener('click', () => { const [x, y] = b.dataset.jel.split('-'); $('#kf-elsoev').value = x; $('#kf-utolsoev').value = y; }));
  $('#kf-fs').addEventListener('change', e => $('#kf-uj').classList.toggle('hidden', e.target.value !== 'uj'));
  $('#kf-f').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]'); let valt = {};
    try {
      if ($('#kf-torol')?.checked) valt = { _torles: '1' };
      else d.querySelectorAll('label[data-m]').forEach(l => {
        const uj = l.querySelector('input').value.trim();
        if (uj !== l.dataset.eredeti) {
          if (l.dataset.tip === 'ev' && uj && !/^\d{4}$/.test(uj)) throw new Error(`${l.firstChild.textContent}: négyjegyű évszámot adj meg.`);
          valt[l.dataset.m] = uj;
        }
      });
      // évkódnál a változatlanul hagyott évet is rögzítjük, így a kérdés lezárul
      if (!valt._torles && evkod && (valt.elsoev !== undefined || valt.utolsoev !== undefined)) {
        for (const m of ['elsoev', 'utolsoev']) if (valt[m] === undefined && $('#kf-' + m).value.trim()) valt[m] = $('#kf-' + m).value.trim();
      }
      const hvalt = {};
      if (!valt._torles) d.querySelectorAll('label[data-hm]').forEach(l => { const uj = l.querySelector('select,input').value.trim(); if (uj !== l.dataset.eredeti) hvalt[l.dataset.hm] = uj; });
      if (!Object.keys(valt).length && !Object.keys(hvalt).length) { msg($('#kf-msg'), 'Nem változott semmi.', 'info'); return; }
      const a = Number(valt.elsoev ?? $('#kf-elsoev').value), b2 = Number(valt.utolsoev ?? $('#kf-utolsoev').value);
      if (a && b2 && b2 < a) throw new Error('Az utolsó év nem lehet korábbi az első évnél.');
      btn.disabled = true;
      const fid = Object.keys(valt).length ? await forrasAzonosito('kf') : null;
      if (Object.keys(valt).length) await q(sb.rpc('javit_sor', { p_tabla: 'tbl_karrier', p_rekord_id: karrierid, p_valtozasok: valt, p_forras_id: fid, p_hivatkozas: $('#kf-hiv').value || null, p_megjegyzes: $('#kf-megj').value || null }));
      if (Object.keys(hvalt).length) await q(sb.rpc('karrier_harm_ment', { p_karrierid: karrierid, p_ertekek: hvalt, p_megjegyzes: $('#kf-megj').value || $('#kf-hiv').value || null }));
      msg($('#kf-msg'), 'A javítás rögzítve.', 'ok');
      setTimeout(utana, 900);
    } catch (err) { btn.disabled = false; hibaKiir($('#kf-msg'), err); }
  });
}

// ---------- Csoportok: egy foglalkozáscsoport egyben történő ellenőrzése ----------
function masCsoportok(lista) {
  return (lista || []).map(m => `<span class="badge ${m.ellenorzes === 'ellenőrizve' ? 'b-ok' : m.ellenorzes === 'kérdéses' ? 'b-bad' : 'b-gray'}" title="${esc(m.ellenorzes ? `${m.ellenorzes}: ${m.ellenorizte || ''}${m.ido ? ', ' + new Date(m.ido).toLocaleDateString('hu-HU') : ''}` : 'még nincs ellenőrizve')}">${esc(m.nev)}${m.ellenorzes === 'ellenőrizve' ? ' ✓' : ''}</span>`).join(' ') || '<span class="muted">—</span>';
}
// a szerver egy kérésre legfeljebb 1000 sort ad: lapozva kérjük le az összeset
async function mindLeker(keres) {
  const out = [];
  for (let i = 0; ; i += 1000) { const { data } = await q(keres().range(i, i + 999)); out.push(...data); if (data.length < 1000) break; }
  return out;
}
const ELL_BADGE = { 'ellenőrizve': '<span class="badge b-ok">ellenőrizve</span>', 'kérdéses': '<span class="badge b-bad">kérdéses</span>' };
async function csoportokLap() {
  location.hash = '';
  app.innerHTML = '<div class="empty">Betöltés…</div>';
  try {
    const { data: csAll } = await q(sb.from('v_csoport_osszesito').select('*').order('nev'));
    const cs = csAll.filter(c => c.tagok > 0);
    const k = await kodok();
    const st = id => { const c = cs.find(x => x.csoport_id === id); return { n: c.tagok, ok: c.ellenorizve, kerd: c.kerdeses }; };
    app.innerHTML = `<h2>Csoportok</h2>
      <p class="muted">Egy foglalkozáscsoport (pl. az orvosok) egyben történő ellenőrzése és javítása: a tagok listája ellenőrzési jelöléssel, a csoport összes karrierállomása egy táblában, és lépkedés a tagok adatlapjai között.</p>
      <div class="csop-racs">${cs.map(c => { const x = st(c.csoport_id), pct = x.n ? Math.round(100 * x.ok / x.n) : 0; return `<div class="card click csop-kartya" data-cs="${c.csoport_id}">
        <h3 style="margin:0 0 4px">${esc(c.nev)}</h3><p class="muted small" style="margin:0 0 8px">${esc(c.leiras || '')}</p>
        <div class="halad"><div style="width:${pct}%"></div></div>
        <p class="small" style="margin:6px 0 0">${x.n} fő · <b>${x.ok}</b> ellenőrizve${x.kerd ? ` · <span class="badge b-bad">${x.kerd} kérdéses</span>` : ''}</p></div>`; }).join('') || '<p class="muted">Még nincs csoport.</p>'}</div>
      ${S.donto ? `<form class="form card" id="ucs-f" style="max-width:560px;margin-top:16px"><h3 style="margin-top:0">Új csoport</h3>
        <label>Név<input id="ucs-n" required placeholder="pl. jogászok"></label>
        <label>Kezdő tagság: akiknek a harmonizált Hivatás1 vagy Hivatás2 értéke<input id="ucs-h" list="dl-hiv" placeholder="pl. JOGÁSZ (üresen: üres csoport, kézzel töltöd fel)"></label>${datalist('dl-hiv', [...new Set([...k.hivatas1, ...k.hivatas2])].sort((a, b) => a.localeCompare(b, 'hu')))}
        <label>Leírás<input id="ucs-l"></label>
        <button class="btn primary" type="submit">Létrehozás</button><div id="ucs-msg"></div></form>` : ''}`;
    app.querySelectorAll('[data-cs]').forEach(el => el.addEventListener('click', () => csoportLap(Number(el.dataset.cs))));
    $('#ucs-f')?.addEventListener('submit', async e => {
      e.preventDefault();
      try { const { data } = await q(sb.rpc('csoport_letrehoz', { p_nev: $('#ucs-n').value, p_leiras: $('#ucs-l').value || null, p_hivatas: $('#ucs-h').value || null })); csoportLap(data); }
      catch (err) { hibaKiir($('#ucs-msg'), err); }
    });
  } catch (e) { hibaKiir(app, e); }
}

async function csoportLap(csId, nezet = 'tagok') {
  location.hash = '';
  app.innerHTML = '<div class="empty">Betöltés…</div>';
  try {
    const { data: c } = await q(sb.from('tbl_csoportok').select('*').eq('csoport_id', csId).single());
    const tagok = await mindLeker(() => sb.from('v_csoport_tagok').select('*').eq('csoport_id', csId).order('nev').order('szemelyid'));
    S.csoportNav = { cs: csId, nev: c.nev, ids: tagok.map(t => t.szemelyid), nezet };
    const ok = tagok.filter(t => t.ellenorzes === 'ellenőrizve').length, pct = tagok.length ? Math.round(100 * ok / tagok.length) : 0;
    const { count: alDb } = await q(sb.from('tbl_csoport_allomasok').select('karrierid', { count: 'exact', head: true }).eq('csoport_id', csId));
    app.innerHTML = `<p><a href="#" id="cs-vissza">‹ Csoportok</a></p>
      <div class="fejlec"><div><h2>${esc(c.nev)}</h2><p class="muted" style="margin:0">${esc(c.leiras || '')}${c.hivatas ? ` · kezdő tagság: harmonizált hivatás = ${esc(c.hivatas)}` : ''}</p></div>
        <div style="min-width:260px"><div class="halad"><div style="width:${pct}%"></div></div><p class="small" style="margin:4px 0 0">${tagok.length} fő · <b>${ok}</b> ellenőrizve (${pct}%)</p></div></div>
      ${alDb ? `<p class="small muted">Ez a csoport karrierállomásokból áll (${alDb} állomás): a „Karrierállomások” nézet csak a csoporthoz tartozó állomásokat mutatja, a Karrier oszlopban „csoportban / összes”. Akinek nincs állomása a csoportban (a tanult kara alapján került ide), annak minden állomása látszik.</p>` : ''}
      <div class="chips" style="margin-top:12px"><button class="chip ${nezet === 'tagok' ? 'on' : ''}" data-nezet="tagok">Tagok</button><button class="chip ${nezet === 'karrier' ? 'on' : ''}" data-nezet="karrier">Karrierállomások egy táblában</button></div>
      <div id="cs-tartalom"></div>`;
    $('#cs-vissza').addEventListener('click', e => { e.preventDefault(); S.csoportNav = null; csoportokLap(); });
    app.querySelectorAll('[data-nezet]').forEach(b => b.addEventListener('click', () => csoportLap(csId, b.dataset.nezet)));
    if (nezet === 'tagok') csoportTagok(c, tagok); else csoportKarrier(c);
  } catch (e) { hibaKiir(app, e); }
}

function csoportTagok(c, tagok) {
  const box = $('#cs-tartalom');
  box.innerHTML = `<div class="toolbar"><input type="search" id="ct-q" placeholder="Név…">
      <select id="ct-f"><option value="">Mind</option><option value="nincs">Még nincs ellenőrizve</option><option value="kérdéses">Kérdéses</option><option value="ellenőrizve">Ellenőrizve</option><option value="teendo">Van nyitott tétel</option></select>
      ${c.hivatas && S.donto ? '<button class="btn" id="ct-frissit" title="Az azóta ezzel a hivatással besorolt személyek felvétele">Kiegészítés a hivatás alapján</button>' : ''}</div>
    <div class="tbl-wrap" id="ct-list"></div>
    ${S.szerkEz !== undefined ? `<form class="form card" id="ct-uj" style="max-width:560px;margin-top:16px"><h3 style="margin-top:0">Személy felvétele a csoportba</h3>
      <label>Név<input id="ct-un" placeholder="Kezdd el írni a nevet…" autocomplete="off"></label><div id="ct-talalat"></div></form>` : ''}`;
  const st = { q: '', f: '' };
  const lista = () => {
    const t = tagok.filter(r => (!st.q || r.nev.toLowerCase().includes(st.q.toLowerCase()))
      && (!st.f || (st.f === 'nincs' ? !r.ellenorzes : st.f === 'teendo' ? (r.evkod_db || r.harm_nyitott || r.nyitott_kerdes || r.besorolatlan) : r.ellenorzes === st.f)));
    $('#ct-list').innerHTML = t.length ? `<table><thead><tr><th>Név</th><th>Élt</th><th>Hivatás1 / Hivatás2</th><th>Karrier</th><th>Nyitott tételek</th><th>Ellenőrzés</th><th>Más csoportban is</th><th></th></tr></thead><tbody>${
      t.map(r => `<tr class="click" data-id="${r.szemelyid}"><td><b>${esc(r.nev)}</b></td><td class="small">${dash(r.szuletesiev)}–${r.halalev ? esc(ev(r.halalev, r.szuletesiev)) : '?'}</td>
        <td class="small">${dash(r.hivatas1)}${r.hivatas2 && r.hivatas2 !== 'NINCS' ? ' / ' + esc(r.hivatas2) : ''}</td><td>${r.csoport_allomas_db ? `${r.csoport_allomas_db} <span class="muted small">/ ${r.karrier_db}</span>` : r.karrier_db}</td>
        <td>${r.evkod_db ? `<span class="badge b-warn">${r.evkod_db} évkód</span> ` : ''}${r.harm_nyitott ? `<span class="badge b-warn">${r.harm_nyitott} besorolás</span> ` : ''}${r.besorolatlan ? `<span class="badge b-gray">${r.besorolatlan} besorolatlan</span> ` : ''}${r.nyitott_kerdes ? `<span class="badge b-bad">${r.nyitott_kerdes} kérdés</span>` : ''}</td>
        <td class="small">${ELL_BADGE[r.ellenorzes] || '<span class="muted">—</span>'}${r.ellenorizte ? `<br><span class="muted">${esc(r.ellenorizte)}</span>` : ''}${r.ellenorzes_megjegyzes ? `<br>${esc(r.ellenorzes_megjegyzes)}` : ''}</td>
        <td class="small">${masCsoportok(r.mas_csoportok)}</td>
        <td><button class="btn small" data-kivesz="${r.szemelyid}" title="Nem tartozik ebbe a csoportba">Kivétel</button></td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Nincs találat.</div>';
    $('#ct-list tbody')?.addEventListener('click', async e => {
      const kb = e.target.closest('[data-kivesz]');
      if (kb) {
        e.stopPropagation();
        if (!confirm('Kiveszed ezt a személyt a csoportból? (A tagság visszavonásként rögzül, később visszavehető.)')) return;
        try { await q(sb.rpc('csoport_tag', { p_csoport_id: c.csoport_id, p_szemelyid: Number(kb.dataset.kivesz), p_be: false })); csoportLap(c.csoport_id, 'tagok'); } catch (err) { alert('Hiba: ' + hibaSzoveg(err)); }
        return;
      }
      const tr = e.target.closest('tr[data-id]'); if (tr) szemelyLap(Number(tr.dataset.id));
    });
  };
  $('#ct-q').addEventListener('input', e => { st.q = e.target.value.trim(); lista(); });
  $('#ct-f').addEventListener('change', e => { st.f = e.target.value; lista(); });
  $('#ct-frissit')?.addEventListener('click', async () => {
    try { const { data } = await q(sb.rpc('csoport_frissit', { p_csoport_id: c.csoport_id })); alert(`${data} új tag került be.`); csoportLap(c.csoport_id, 'tagok'); } catch (err) { alert('Hiba: ' + hibaSzoveg(err)); }
  });
  $('#ct-un')?.addEventListener('input', debounce(async e => {
    const t = tiszta(e.target.value); const box2 = $('#ct-talalat');
    if (t.length < 3) { box2.innerHTML = ''; return; }
    const w = t.split(/\s+/);
    let qq = sb.from('v_szemely_lista').select('szemelyid,vezeteknev,keresztnev,szuletesiev');
    qq = w.length > 1 ? qq.ilike('vezeteknev', `%${w[0]}%`).ilike('keresztnev', `%${w.slice(1).join(' ')}%`) : qq.or(`vezeteknev.ilike.%${w[0]}%,keresztnev.ilike.%${w[0]}%`);
    const { data } = await q(qq.limit(10));
    box2.innerHTML = (data || []).map(r => `<button type="button" class="btn small" data-felvesz="${r.szemelyid}" style="margin:2px">${esc(r.vezeteknev + ' ' + r.keresztnev)} (${dash(r.szuletesiev)})${S.csoportNav.ids.includes(r.szemelyid) ? ' – már tag' : ''}</button>`).join('') || '<span class="muted small">Nincs találat.</span>';
    box2.querySelectorAll('[data-felvesz]').forEach(b => b.addEventListener('click', async () => {
      try { await q(sb.rpc('csoport_tag', { p_csoport_id: c.csoport_id, p_szemelyid: Number(b.dataset.felvesz), p_be: true })); csoportLap(c.csoport_id, 'tagok'); } catch (err) { alert('Hiba: ' + hibaSzoveg(err)); }
    }));
  }));
  lista();
}

// a csoport összes karrierállomása, helyben javítható mezőkkel; egy forrás a teljes mentéshez
const KPAGE = 150;
async function csoportKarrier(c) {
  const box = $('#cs-tartalom');
  await kodtablak();
  box.innerHTML = `<div class="toolbar"><input type="search" id="ck-q" placeholder="Név, foglalkozás vagy munkahely…">
      <select id="ck-f"><option value="">Minden állomás</option><option value="evkod">Feloldatlan évkód</option><option value="nyitott">Nyitott besorolás</option><option value="nincs">Nincs besorolva</option><option value="javitott">Javított</option></select></div>
    <p class="muted small">A szürke mezők közvetlenül átírhatók. A megváltoztatott sorok kiemelődnek; a „Mentés” a lent megadott forrással, új bejegyzésként rögzíti őket (az eredeti adat megmarad). A harmonizált értékek a sorra kattintva, a besorolásnál módosíthatók.</p>
    <div class="tbl-wrap" id="ck-list"></div><div id="ck-pager"></div>
    <div class="card ck-mentes" id="ck-mentes">${forrasValaszto('ck')}
      <div class="toolbar" style="margin:10px 0 0"><button class="btn primary" id="ck-ment" disabled>Mentés (0 sor)</button><button class="btn" id="ck-elvet" disabled>Változások elvetése</button></div><div id="ck-msg"></div></div>
    <div id="detail" style="margin-top:12px"></div>`;
  $('#ck-fs').addEventListener('change', e => $('#ck-uj').classList.toggle('hidden', e.target.value !== 'uj'));
  const st = { page: 0, q: '', f: '' };
  const valtozott = new Map(); // karrierid -> {mezo: érték}
  const gombok = () => { const n = valtozott.size; $('#ck-ment').textContent = `Mentés (${n} sor)`; $('#ck-ment').disabled = !n; $('#ck-elvet').disabled = !n; };
  const lista = async () => {
    if (valtozott.size && !confirm('Vannak mentetlen változások ezen az oldalon. Elveted őket?')) return false;
    valtozott.clear(); gombok();
    const lb = $('#ck-list'); lb.innerHTML = '<div class="empty">Betöltés…</div>';
    let qq = sb.from('v_csoport_karrier').select('*', { count: 'exact' }).eq('csoport_id', c.csoport_id);
    if (st.q) qq = qq.or(`nev.ilike.%${st.q}%,foglalkozas.ilike.%${st.q}%,munkahely.ilike.%${st.q}%`);
    if (st.f === 'evkod') qq = qq.like('leiras', '? kód:%').is('javitott_mezok', null);
    if (st.f === 'nyitott') qq = qq.not('harm_allapot', 'is', null).neq('harm_allapot', 'rendben');
    if (st.f === 'nincs') qq = qq.is('harm_id', null);
    if (st.f === 'javitott') qq = qq.not('javitott_mezok', 'is', null);
    try {
      const { data, count } = await q(qq.order('nev').order('szemelyid').order('elsoev', { nullsFirst: false }).order('sorszam').range(st.page * KPAGE, st.page * KPAGE + KPAGE - 1));
      const cella = (k, m, cls = '') => { const v = k[m] === null || k[m] === undefined ? '' : String(m.endsWith('ev') ? ev(k[m], k.szuletesiev) : k[m]);
        return `<td class="${cls}"><input class="ck-in ${(k.javitott_mezok || []).includes(m) ? 'jav' : ''}" data-k="${k.karrierid}" data-m="${m}" data-eredeti="${esc(v)}" value="${esc(v)}" ${m.endsWith('ev') ? 'inputmode="numeric" size="4"' : ''} title="${(k.javitott_mezok || []).includes(m) ? 'Javított érték; eredetileg: ' + esc(k.eredeti?.[m] ?? '—') : ''}"></td>`; };
      let elozo = null;
      lb.innerHTML = data.length ? `<table class="ck-tbl"><thead><tr><th>Név</th><th>Első év</th><th>Utolsó év</th><th>Foglalkozás</th><th>Munkahely</th><th>Helyszín</th><th>Harmonizált</th><th>Hivatás1</th><th>Hivatás2</th><th>Besorolás</th></tr></thead><tbody>${
        data.map(k => { const uj = k.szemelyid !== elozo; elozo = k.szemelyid;
          return `<tr data-h="${k.harm_id || ''}" data-sz="${k.szemelyid}" class="${uj ? 'uj-szemely' : ''}"><td>${uj ? `<a href="#szemely=${k.szemelyid}" data-szem="${k.szemelyid}"><b>${esc(k.nev)}</b></a> <span class="muted small">${dash(k.szuletesiev)}</span>` : ''}
            ${k.leiras && k.leiras.startsWith('? kód') && !(k.javitott_mezok || []).length ? `<br><span class="badge b-warn">${esc(k.leiras)}</span>` : ''}</td>
            ${cella(k, 'elsoev')}${cella(k, 'utolsoev')}${cella(k, 'foglalkozas', 'w-fogl')}${cella(k, 'munkahely', 'w-mh')}${cella(k, 'helyszin')}
            ${k.harm_id ? `<td class="small">${harmF(k, 'harmonizalt')}</td><td class="small">${harmF(k, 'hivatas1')}</td><td class="small">${harmF(k, 'hivatas2')}</td>
            <td class="small"><a href="#" data-harm="${k.harm_id}">${allapotBadge(k.harm_allapot)}</a></td>` : NEMHARM(4)}</tr>`; }).join('')}</tbody></table>`
        : '<div class="empty">Nincs találat.</div>';
      szemLinkek(lb);
      lb.querySelectorAll('.ck-in').forEach(inp => inp.addEventListener('input', () => {
        const kid = Number(inp.dataset.k), sor = valtozott.get(kid) || {};
        if (inp.value.trim() !== inp.dataset.eredeti) sor[inp.dataset.m] = inp.value.trim(); else delete sor[inp.dataset.m];
        inp.classList.toggle('valt', inp.value.trim() !== inp.dataset.eredeti);
        if (Object.keys(sor).length) valtozott.set(kid, sor); else valtozott.delete(kid);
        gombok();
      }));
      lb.querySelectorAll('[data-harm]').forEach(a => a.addEventListener('click', e => {
        e.preventDefault();
        harmReszlet(Number(a.dataset.harm), $('#detail'), () => { $('#detail').innerHTML = ''; lista(); }).catch(err => hibaKiir($('#detail'), err));
        $('#detail').scrollIntoView({ behavior: 'smooth' });
      }));
      $('#ck-pager').innerHTML = ''; $('#ck-pager').appendChild(pager(count, st.page, p => { const regi = st.page; st.page = p; lista().then(r => { if (r === false) st.page = regi; }); }));
    } catch (e) { hibaKiir(lb, e); }
  };
  $('#ck-q').addEventListener('input', debounce(e => { st.q = tiszta(e.target.value); st.page = 0; lista(); }));
  $('#ck-f').addEventListener('change', e => { st.f = e.target.value; st.page = 0; lista(); });
  $('#ck-elvet').addEventListener('click', () => { valtozott.clear(); lista(); });
  $('#ck-ment').addEventListener('click', async () => {
    const btn = $('#ck-ment');
    try {
      for (const [kid, sor] of valtozott) for (const m of ['elsoev', 'utolsoev']) {
        if (sor[m] && !/^\d{4}$/.test(sor[m])) throw new Error(`Négyjegyű évszámot adj meg (${sor[m]}).`);
        // évkód feloldásakor a másik évet is rögzítjük
        const masik = m === 'elsoev' ? 'utolsoev' : 'elsoev', inp = document.querySelector(`.ck-in[data-k="${kid}"][data-m="${masik}"]`);
        if (sor[m] !== undefined && sor[masik] === undefined && inp && inp.value.trim()) sor[masik] = inp.value.trim();
      }
      btn.disabled = true;
      const fid = await forrasAzonosito('ck');
      let n = 0;
      for (const [kid, sor] of valtozott) {
        await q(sb.rpc('javit_sor', { p_tabla: 'tbl_karrier', p_rekord_id: kid, p_valtozasok: sor, p_forras_id: fid, p_hivatkozas: $('#ck-hiv').value || null, p_megjegyzes: $('#ck-megj').value || null }));
        n++;
      }
      valtozott.clear();
      msg($('#ck-msg'), `${n} karrierállomás javítása rögzítve.`, 'ok');
      lista();
    } catch (err) { btn.disabled = false; hibaKiir($('#ck-msg'), err); }
  });
  lista();
}

// a profil tetején: lépkedés a csoport tagjai között, ellenőrzés jelölése
function csoportSav(id) {
  const N = S.csoportNav; if (!N || !N.ids.includes(id)) return '';
  const i = N.ids.indexOf(id);
  return `<div class="card csop-sav"><div><b>${esc(N.nev)}</b> <span class="muted">· ${i + 1} / ${N.ids.length}</span> <span id="cs-allapot"></span><div class="small" id="cs-mas"></div></div>
    <div class="toolbar" style="margin:0">
      <button class="btn" id="cs-elozo" ${i === 0 ? 'disabled' : ''}>‹ Előző</button>
      ${S.szerkEz ? `<input id="cs-megj" placeholder="Megjegyzés (pl. mit kell még megnézni)">
      <button class="btn" id="cs-kerd">Kérdéses</button><button class="btn primary" id="cs-ok">Ellenőrizve ✓ és tovább</button>` : ''}
      <button class="btn" id="cs-kov" ${i === N.ids.length - 1 ? 'disabled' : ''}>Következő ›</button></div></div>`;
}
async function csoportSavKezel(id) {
  const N = S.csoportNav; if (!N || !N.ids.includes(id)) return;
  const i = N.ids.indexOf(id);
  const { data: t } = await q(sb.from('tbl_csoport_tagok').select('ellenorzes,ellenorzes_megjegyzes,ellenorizte,ellenorzes_ideje').eq('csoport_id', N.cs).eq('szemelyid', id).maybeSingle());
  const { data: vt } = await q(sb.from('v_csoport_tagok').select('mas_csoportok').eq('csoport_id', N.cs).eq('szemelyid', id).maybeSingle());
  if (vt && vt.mas_csoportok && vt.mas_csoportok.length) $('#cs-mas').innerHTML = 'Más csoportban is: ' + masCsoportok(vt.mas_csoportok);
  if (t) {
    $('#cs-allapot').innerHTML = (ELL_BADGE[t.ellenorzes] || '<span class="badge b-gray">még nincs ellenőrizve</span>') + (t.ellenorizte ? ` <span class="muted small">${esc(t.ellenorizte)}, ${new Date(t.ellenorzes_ideje).toLocaleDateString('hu-HU')}</span>` : '');
    if ($('#cs-megj')) $('#cs-megj').value = t.ellenorzes_megjegyzes || '';
  }
  const megy = j => { if (j >= 0 && j < N.ids.length) { szemelyLap(N.ids[j]); window.scrollTo(0, 0); } };
  $('#cs-elozo')?.addEventListener('click', () => megy(i - 1));
  $('#cs-kov')?.addEventListener('click', () => megy(i + 1));
  const jelol = async (allapot, tovabb) => {
    try { await q(sb.rpc('csoport_ellenoriz', { p_csoport_id: N.cs, p_szemelyid: id, p_allapot: allapot, p_megjegyzes: $('#cs-megj').value || null })); tovabb && i < N.ids.length - 1 ? megy(i + 1) : szemelyLap(id); }
    catch (err) { alert('Hiba: ' + hibaSzoveg(err)); }
  };
  $('#cs-ok')?.addEventListener('click', () => jelol('ellenőrizve', true));
  $('#cs-kerd')?.addEventListener('click', () => jelol('kérdéses', false));
}

// ---------- Munkatársak (csak korlátozás nélküli munkatárs) ----------
async function munkatarsakLap() {
  if (!S.donto) { app.innerHTML = '<div class="empty">Ehhez nincs jogosultságod.</div>'; return; }
  app.innerHTML = '<div class="empty">Betöltés…</div>';
  try {
    const { data: mt } = await q(sb.from('tbl_munkatarsak').select('*').order('email'));
    app.innerHTML = `<h2>Munkatársak</h2>
      <p class="muted">Minden munkatárs egyforma jogosultsággal dolgozik: mindent láthat, javíthat és dönthet. Itt lehet új munkatársat felvenni, illetve egy munkatárs hozzáférését kikapcsolni (Aktív).</p>
      <div class="tbl-wrap"><table><thead><tr><th>E-mail</th><th>Név</th><th>Aktív</th></tr></thead><tbody>${
        mt.map(m => `<tr><td>${esc(m.email)}</td><td>${dash(m.nev)}</td><td><input type="checkbox" data-aktiv="${esc(m.email)}" ${m.aktiv ? 'checked' : ''} ${m.email === S.user.email.toLowerCase() ? 'disabled' : ''}></td></tr>`).join('')
      }</tbody></table></div>
      <form class="form card" id="mt-f"><h3 style="margin-top:0">Új munkatárs</h3>
        <label>E-mail-cím<input type="email" id="mt-e" required></label><label>Név<input id="mt-n"></label>
        <button class="btn primary" type="submit">Felvétel</button><div id="mt-msg"></div>
        <p class="muted small">A belépéshez a Supabase-ben is létre kell hozni a felhasználót (Authentication → Users → Add user), ugyanezzel az e-mail-címmel.</p></form>
`;
    app.querySelectorAll('[data-aktiv]').forEach(cb => cb.addEventListener('change', async () => {
      try { await q(sb.rpc('munkatars_beallit', { p_email: cb.dataset.aktiv, p_nev: null, p_aktiv: cb.checked })); } catch (err) { cb.checked = !cb.checked; alert('Hiba: ' + hibaSzoveg(err)); }
    }));
    $('#mt-f').addEventListener('submit', async e => {
      e.preventDefault();
      try { await q(sb.rpc('munkatars_beallit', { p_email: $('#mt-e').value, p_nev: $('#mt-n').value || null, p_aktiv: true })); munkatarsakLap(); }
      catch (err) { hibaKiir($('#mt-msg'), err); }
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
      const cell = (ervenyes, beirt) => ervenyes ? (ervenyes !== beirt && beirt ? `${esc(ervenyes)} <span class="muted small">(${beirt.trim() ? esc(beirt) : 'üres'})</span>` : esc(ervenyes)) : (beirt ? `<span class="badge b-warn" title="Döntésre vár">${esc(beirt)} ?</span>` : '<span class="muted">—</span>');
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


// ---------- Javaslatok (külső forrásból, jóváhagyásra) ----------
const JTABLA = { tbl_szemelyek: 'Alapadatok', tbl_elittag_reszletek: 'Életrajzi részletek', tbl_tanulmanyok: 'Tanulmányok', tbl_karrier: 'Karrier',
  tbl_kituntetes_hazai: 'Kitüntetések', tbl_kituntetes_kulfoldi: 'Kitüntetések (1945 után / külföldi)', tbl_dijak: 'Díjak', tbl_csapat_ermek: 'Címek',
  tbl_szervezeti_tagsag_belfold: 'Szervezeti tagság', tbl_kulfolditartozkodasok: 'Külföldi tartózkodás', tbl_foglalkozasok: 'Foglalkozás' };
const JMUV = { javit: '<span class="badge b-warn">javítás</span>', uj: '<span class="badge b-info">új adat</span>', megerosit: '<span class="badge b-ok">megerősítés</span>' };
function jvErtek(j, v) {
  if (v === null || v === undefined || v === '') return v;
  if (['szuletesiev', 'ev', 'nevvaltoztataseve', 'diplomaev', 'kezdoev', 'befejezesev'].includes(j.mezo)) return String(ev(v));
  if (j.mezo === 'halalev' && Number(v) < 100) return String(1900 + Number(v));
  return String(v);
}
async function javaslatokLap() {
  location.hash = '';
  app.innerHTML = `<h2>Javaslatok</h2>
    <p class="muted">Külső forrásból (pl. Magyar Színházművészeti Lexikon) gyűjtött adatok. Jóváhagyásig semmi sem kerül az adatbázisba; jóváhagyáskor az eredeti adat megmarad, az új érték forrással és hivatkozással rögzül, és visszavonható.</p>
    <div class="toolbar"><input type="search" id="jv-q" placeholder="Név…"><select id="jv-a"><option value="nyitott">Van nyitott javaslat</option><option value="">Mind</option></select><select id="jv-g"><option value="">Minden csoport</option></select><select id="jv-cs"><option value="">Minden csomag</option><option>Lexikon-összevetés 2026-10 (művészek)</option><option>Arcanum-lexikonok 2026-10 (művészek, MEK-ben nem szereplők)</option><option>Újságírók – próbaminta 2026-10 (MÉL, Arcanum, Hungaricana)</option></select></div>
    <div class="grid2"><div><div class="tbl-wrap" id="jv-list"></div></div><div class="sticky" id="jv-detail"><div class="card empty">Válassz egy személyt.</div></div></div>`;
  const st = { kereses: '', allapot: 'nyitott', csomag: '', csoport: '', kivalasztott: null };
  try {
    const [{ data: cs }, { data: sajat }] = await Promise.all([
      q(sb.from('tbl_csoportok').select('csoport_id,nev').order('nev')),
      q(sb.from('tbl_munkatars_csoportok').select('csoport_id').eq('email', (S.user?.email || '').toLowerCase())),
    ]);
    const sj = new Set((sajat || []).map(r => r.csoport_id));
    $('#jv-g').innerHTML = '<option value="">Minden csoport</option>' + cs.map(c => `<option value="${c.csoport_id}">${esc(c.nev)}${sj.has(c.csoport_id) ? ' – saját' : ''}</option>`).join('');
    let mentett = ''; try { mentett = localStorage.getItem('jv-csoport') || ''; } catch (e) { /* nincs tárolás */ }
    if (sj.size === 1 && !mentett) st.csoport = String([...sj][0]); else if (cs.some(c => String(c.csoport_id) === mentett)) st.csoport = mentett;
    $('#jv-g').value = st.csoport;
  } catch (e) { /* a csoportlista nélkül is működik */ }
  const lista = async () => {
    const box = $('#jv-list'); box.innerHTML = '<div class="empty">Betöltés…</div>';
    let qq = st.csoport ? sb.from('v_javaslat_szemelyek_csoport').select('*').eq('csoport_id', Number(st.csoport)) : sb.from('v_javaslat_szemelyek').select('*');
    if (st.allapot === 'nyitott') qq = qq.gt('nyitott', 0);
    if (st.kereses) qq = qq.ilike('nev', `%${st.kereses}%`);
    if (st.csomag) qq = qq.ilike('csomag', `%${st.csomag}%`);
    try {
      const { data } = await q(qq.order('nev').limit(500));
      box.innerHTML = data.length ? `<table><thead><tr><th>Név</th><th>Csoport</th><th>Nyitott</th><th>Javítás / új / megerősítés</th><th>Kész</th></tr></thead><tbody>${
        data.map(r => `<tr class="click ${st.kivalasztott === r.szemelyid ? 'sel' : ''}" data-id="${r.szemelyid}"><td><b>${esc(r.nev)}</b> <span class="muted small">${esc(ev(r.szuletesiev))}</span></td>
          <td class="small muted">${esc((r.csoportok || '').replace(/ \([^)]*\)/g, ''))}</td>
          <td>${r.nyitott ? `<span class="badge b-warn">${r.nyitott}</span>` : ''}</td><td class="small">${r.javitas} / ${r.uj_sor} / ${r.megerosites}</td>
          <td class="small">${r.elfogadva ? `<span class="badge b-ok">${r.elfogadva} elfogadva</span>` : ''} ${r.elutasitva ? `<span class="badge b-gray">${r.elutasitva} elutasítva</span>` : ''}</td></tr>`).join('')}</tbody></table>`
        : '<div class="empty">Nincs javaslat.</div>';
      box.querySelector('tbody')?.addEventListener('click', e => {
        const tr = e.target.closest('tr'); if (!tr) return;
        box.querySelectorAll('tr').forEach(x => x.classList.remove('sel')); tr.classList.add('sel');
        st.kivalasztott = Number(tr.dataset.id); reszlet(st.kivalasztott);
      });
    } catch (e) { hibaKiir(box, e); }
  };
  const reszlet = async (id, uzenet) => {
    const d = $('#jv-detail'); d.innerHTML = '<div class="card empty">Betöltés…</div>';
    try {
      const { data } = await q(sb.from('tbl_javaslatok').select('*').eq('szemelyid', id).order('tabla').order('javaslat_id'));
      const kt = await kodtablak();
      const ny = data.filter(j => j.allapot === 'javaslat'), kesz = data.filter(j => j.allapot !== 'javaslat');
      const csop = new Map(); for (const j of ny) { const k = JTABLA[j.tabla] || j.tabla; if (!csop.has(k)) csop.set(k, []); csop.get(k).push(j); }
      const sor = j => `<div class="jv-sor">
          ${dontHet ? `<input type="checkbox" class="jv-cb" value="${j.javaslat_id}" checked>` : ''}
          <div class="jv-tart"><div>${JMUV[j.muvelet] || ''} ${esc(j.olvashato)}</div>
            ${j.muvelet === 'javit' ? `<div class="small"><span class="muted">jelenleg:</span> ${dash(jvErtek(j, j.jelenlegi))} → <b>${esc(jvErtek(j, j.javasolt) ?? '')}</b></div>` : ''}
            ${j.muvelet === 'uj' && j.ertekek ? `<div class="small muted">${esc(Object.entries(j.ertekek).filter(([, v]) => v !== null && v !== '').map(([k, v]) => `${cimke(k)}: ${jvErtek({ mezo: k }, v)}`).join(' · '))}</div>` : ''}
            ${j.idezet ? `<details class="small"><summary class="muted">idézet a forrásból</summary><blockquote>${esc(j.idezet)}</blockquote></details>` : ''}
            <div class="small muted">${forrasBadge(kt.forras.get(j.forras_id)?.megnevezes, kt.forras.get(j.forras_id)?.fazis)} ${esc(kt.forras.get(j.forras_id)?.megnevezes || '')}${j.hivatkozas ? ` · <a href="${esc(j.hivatkozas)}" target="_blank" rel="noopener">szócikk</a>` : ''}${j.megjegyzes ? ` · <span class="${/ellenőrizendő|ellentmond/i.test(j.megjegyzes) ? 'badge b-warn' : ''}">${esc(j.megjegyzes)}</span>` : ''}</div>
          </div></div>`;
      const nev = (await q(sb.from('tbl_szemelyek').select('vezeteknev,keresztnev').eq('szemelyid', id).single())).data;
      const dontHet = await szerkHet(id);
      d.innerHTML = `<div class="card">
        ${uzenet ? `<div class="msg ok small" style="margin-bottom:10px">${uzenet}</div>` : ''}
        <h3 style="margin-top:0"><a href="#szemely=${id}" data-szem="${id}">${esc(nev.vezeteknev)} ${esc(nev.keresztnev)}</a></h3>
        ${ny.length ? [...csop.entries()].map(([k, js]) => `<h4>${esc(k)}</h4>${js.map(sor).join('')}`).join('') : '<p class="muted">Nincs nyitott javaslat.</p>'}
        ${ny.length && !dontHet ? '<p class="msg info small">Ez a személy nem a te csoportodba tartozik, ezért a javaslatairól nem dönthetsz (látni láthatod őket).</p>' : ''}
        ${ny.length && dontHet ? `<label>Megjegyzés (nem kötelező)<input id="jv-m" placeholder="pl. a lexikon szerint"></label>
          <div class="toolbar"><button class="btn primary" id="jv-el">Kijelöltek elfogadása</button><button class="btn" id="jv-ut">Kijelöltek elutasítása</button>
          <button class="btn small" id="jv-mind">Mind / egyik sem</button></div><div id="jv-msg"></div>` : ''}
        ${kesz.length ? `<details style="margin-top:12px"><summary class="muted">Korábban eldöntött javaslatok (${kesz.length})</summary>${kesz.map(j => `<div class="small" style="margin:4px 0">${j.allapot === 'elfogadva' ? '<span class="badge b-ok">elfogadva</span>' : '<span class="badge b-gray">elutasítva</span>'} ${esc(j.olvashato)}${j.muvelet === 'javit' ? ` → <b>${esc(j.javasolt ?? '')}</b>` : ''}</div>`).join('')}</details>` : ''}
      </div>`;
      szemLinkek(d);
      if (!dontHet || !ny.length) return;
      $('#jv-mind', d).addEventListener('click', () => { const cbs = [...d.querySelectorAll('.jv-cb')]; const all = cbs.every(c => c.checked); cbs.forEach(c => { c.checked = !all; }); });
      const dont = async elfogad => {
        const ids = [...d.querySelectorAll('.jv-cb:checked')].map(c => Number(c.value));
        if (!ids.length) return msg($('#jv-msg', d), 'Nincs kijelölt javaslat.', 'err');
        d.querySelectorAll('button').forEach(b => { b.disabled = true; });
        try {
          const { data: n } = await q(sb.rpc('javaslat_dont', { p_ids: ids, p_elfogad: elfogad, p_megjegyzes: $('#jv-m', d).value || null }));
          await reszlet(id, `${n} javaslat ${elfogad ? 'elfogadva – az adatlapon már az új értékek látszanak' : 'elutasítva'}.`);
          lista();
        } catch (e) { d.querySelectorAll('button').forEach(b => { b.disabled = false; }); hibaKiir($('#jv-msg', d), e); }
      };
      $('#jv-el', d).addEventListener('click', () => dont(true));
      $('#jv-ut', d).addEventListener('click', () => dont(false));
    } catch (e) { hibaKiir(d, e); }
  };
  $('#jv-q').addEventListener('input', debounce(e => { st.kereses = tiszta(e.target.value); lista(); }));
  $('#jv-a').addEventListener('change', e => { st.allapot = e.target.value; lista(); });
  $('#jv-g').addEventListener('change', e => { st.csoport = e.target.value; try { localStorage.setItem('jv-csoport', st.csoport); } catch (e2) { /* nincs tárolás */ } lista(); });
  $('#jv-cs').addEventListener('change', e => { st.csomag = e.target.value; lista(); });
  lista();
}

// ---------- Szabályok ----------
async function szabalyokLap() {
  app.innerHTML = `<h2>Szabályok</h2>
    <p class="muted">Értékszintű döntések: egy beírt értékre vonatkozó döntés minden érintett sorra érvényes. Itt a már elfogadott szabályok is láthatók és módosíthatók.</p>
    <div class="toolbar"><select id="sz-a"><option value="">Minden állapot</option><option>nyitott</option><option>javaslat</option><option>elfogadva</option><option>elutasítva</option><option>összevonva</option></select>
      <select id="sz-o"><option value="">Minden mező</option><option value="harmonizalt">Harmonizált foglalkozás</option><option value="hivatas1">Hivatás1</option><option value="hivatas2">Hivatás2</option></select>
      <input type="search" id="sz-k" placeholder="Beírt érték…"></div>
    <div class="grid2"><div><div class="tbl-wrap" id="r-list"></div><div id="r-pager"></div></div><div class="sticky" id="ny-detail"><div class="card empty">Válassz egy szabályt.</div></div></div>`;
  const st = { page: 0, allapot: '', oszlop: '', kereses: '' };
  const lista = async () => {
    const box = $('#r-list'); box.innerHTML = '<div class="empty">Betöltés…</div>';
    let qq = sb.from('tbl_ertek_szabalyok').select('szabaly_id,oszlop,beirt_ertek,cel_oszlop,cel_ertek,cel2_oszlop,cel2_ertek,allapot,dontotte', { count: 'exact' });
    if (st.allapot) qq = qq.eq('allapot', st.allapot);
    if (st.oszlop) qq = qq.eq('oszlop', st.oszlop);
    if (st.kereses) qq = qq.ilike('beirt_ertek', `%${st.kereses}%`);
    try {
      const { data, count } = await q(qq.order('oszlop').order('beirt_ertek').range(st.page * PAGE, st.page * PAGE + PAGE - 1));
      box.innerHTML = data.length ? `<table><thead><tr><th>Mező</th><th>Beírt</th><th>Cél</th><th>Állapot</th></tr></thead><tbody>${
        data.map(r => `<tr class="click" data-id="${r.szabaly_id}"><td>${esc(MEZONEV[r.oszlop])}</td><td><b>${esc(r.beirt_ertek)}</b></td>
          <td class="small">${celSzoveg(r) || '<span class="muted">—</span>'}</td><td>${allapotBadge(r.allapot)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nincs találat.</div>';
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
