/* Kartenbinder: Pokémon-Karten scannen, sammeln und bewerten.
   Kartendaten und Preise: TCGdex (https://tcgdex.dev), Preise von Cardmarket (EUR) und TCGplayer (USD). */
'use strict';

const API = 'https://api.tcgdex.net/v2';
const STORE_KEY = 'kartenbinder.collection.v1';
const LANG_KEY = 'kartenbinder.lang';
const LANG_LABEL = { de: 'DE', en: 'EN', ja: 'JA' };
const VARIANT_LABEL = { normal: 'Normal', reverse: 'Reverse Holo', holo: 'Holo', firstEdition: '1. Edition' };
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const usd = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'USD' });
const dateFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

/* ---------- Speicher ---------- */
let collection = load();
let searchLang = (() => { try { return localStorage.getItem(LANG_KEY) || 'de'; } catch { return 'de'; } })();

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(collection)); }
  catch { toast('Speichern hat nicht geklappt. Ist der Speicher voll?'); }
}

/* ---------- API ---------- */
const memo = new Map();
async function api(path) {
  if (memo.has(path)) return memo.get(path);
  const p = fetch(API + path).then(async (res) => {
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  });
  memo.set(path, p);
  p.catch(() => memo.delete(path));
  return p;
}
async function fresh(path) {
  memo.delete(path);
  return api(path);
}
const getSets = (lang) => api(`/${lang}/sets`).then((s) => s || []);
const getCard = (lang, id) => api(`/${lang}/cards/${encodeURIComponent(id)}`);
const setIdOf = (cardId) => cardId.slice(0, cardId.lastIndexOf('-'));

function img(url, quality) {
  return url ? `${url}/${quality}.webp` : '';
}
function artHTML(url, quality, alt) {
  return url
    ? `<img src="${esc(img(url, quality))}" alt="${esc(alt)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'noimg',textContent:'Kein Bild'}))">`
    : `<div class="noimg">Kein Bild</div>`;
}

/* ---------- Preise ---------- */
function eurPrice(cm, variant) {
  if (!cm) return null;
  const pick = (...keys) => { for (const k of keys) if (typeof cm[k] === 'number' && cm[k] > 0) return cm[k]; return null; };
  return variant === 'reverse'
    ? pick('trend-holo', 'avg30-holo', 'avg-holo', 'trend', 'avg')
    : pick('trend', 'avg30', 'avg', 'avg7');
}
function usdPrice(tp, variant) {
  if (!tp) return null;
  const keys = Object.keys(tp).filter((k) => tp[k] && typeof tp[k] === 'object');
  const want = variant === 'reverse' ? ['reverse', 'reverse-holofoil'] : variant === 'holo' ? ['holo', 'holofoil'] : variant === 'firstEdition' ? ['1st-edition-holofoil', '1st-edition', '1st-edition-normal'] : ['normal'];
  const key = want.find((k) => keys.includes(k)) || keys[0];
  if (!key) return null;
  const v = tp[key];
  return v.marketPrice || v.midPrice || v.lowPrice || null;
}
function itemValue(it) { return eurPrice(it.cm, it.variant); }

/* ---------- Ansichten ---------- */
function show(view) {
  for (const v of ['collection', 'add']) $(`#view-${v}`).hidden = v !== view;
  document.querySelectorAll('.tab').forEach((t) => {
    if (t.dataset.view === view) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => show(t.dataset.view)));

/* ---------- Sammlung ---------- */
const RARITY_ORDER = [
  [/special illustration|sonder-illustration|spezielle illustration|sar/i, 10],
  [/hyper|gold|secret|geheim|ur\b/i, 9],
  [/illustration|ir\b/i, 8],
  [/ultra|vmax|vstar|\bex\b|\bgx\b|\bv\b|sr\b|rr\b/i, 7],
  [/double|doppel/i, 6],
  [/holo/i, 5],
  [/rare|selten|\br\b/i, 4],
  [/uncommon|nicht häufig|nicht so häufig|\bu\b/i, 2],
  [/common|häufig|\bc\b/i, 1],
];
const rarityRank = (r) => { for (const [re, n] of RARITY_ORDER) if (re.test(r || '')) return n; return 3; };

function renderCollection() {
  const q = $('#colFilter').value.trim().toLowerCase();
  const lang = $('#colLang').value;
  const sort = $('#colSort').value;
  let list = collection.filter((it) => (!lang || it.lang === lang) &&
    (!q || `${it.name} ${it.setName} ${it.localId}`.toLowerCase().includes(q)));

  const cmp = {
    value: (a, b) => (itemValue(b) ?? -1) - (itemValue(a) ?? -1),
    name: (a, b) => a.name.localeCompare(b.name, 'de'),
    set: (a, b) => (a.setName || '').localeCompare(b.setName || '', 'de') || String(a.localId).localeCompare(String(b.localId), 'de', { numeric: true }),
    added: (a, b) => (b.added || 0) - (a.added || 0),
    rarity: (a, b) => rarityRank(b.rarity) - rarityRank(a.rarity) || (itemValue(b) ?? -1) - (itemValue(a) ?? -1),
  }[sort];
  list = list.slice().sort(cmp);

  const box = $('#colList');
  if (!collection.length) {
    box.innerHTML = `<div class="empty">
      <h2>Dein Binder ist noch leer</h2>
      <p>Fotografiere deine erste Karte oder suche sie nach Name. Der Wert wird automatisch von Cardmarket geholt.</p>
      <button class="btn primary" type="button" id="emptyAdd">Erste Karte hinzufügen</button>
    </div>`;
    $('#emptyAdd').onclick = () => show('add');
  } else if (!list.length) {
    box.innerHTML = `<div class="empty"><p>Keine Karte passt zu deiner Suche.</p></div>`;
  } else {
    box.innerHTML = list.map((it) => {
      const v = itemValue(it);
      return `<button class="slot" type="button" data-key="${esc(it.key)}">
        <div class="art">${artHTML(it.image, 'low', it.name)}</div>
        ${it.qty > 1 ? `<span class="qty">${it.qty}×</span>` : ''}
        <span class="name">${esc(it.name)}</span>
        <span class="meta"><span class="flag">${LANG_LABEL[it.lang] || it.lang}</span>${esc(it.setName)} · ${esc(it.localId)}${it.variant && it.variant !== 'normal' ? ' · ' + esc(VARIANT_LABEL[it.variant] || it.variant) : ''}</span>
        ${v != null ? `<span class="price">${eur.format(v)}${it.qty > 1 ? ` <small class="meta">je</small>` : ''}</span>` : `<span class="price none">Kein Preis</span>`}
      </button>`;
    }).join('');
  }
  box.querySelectorAll('.slot').forEach((el) => el.addEventListener('click', () => {
    const it = collection.find((x) => x.key === el.dataset.key);
    if (it) openCard(it.lang, it.id, it);
  }));
  renderTotals();
}

function renderTotals() {
  let total = 0, count = 0, priced = 0, best = null;
  for (const it of collection) {
    count += it.qty;
    const v = itemValue(it);
    if (v != null) { total += v * it.qty; priced += it.qty; if (!best || v > itemValue(best)) best = it; }
  }
  $('#totalValue').textContent = eur.format(total);
  $('#stats').innerHTML = `
    <div class="stat"><b>${count}</b><span>Karten</span></div>
    <div class="stat"><b>${collection.length}</b><span>verschiedene</span></div>
    <div class="stat"><b>${best ? eur.format(itemValue(best)) : '–'}</b><span>${best ? 'teuerste: ' + esc(best.name) : 'teuerste Karte'}</span></div>`;
  const unpriced = count - priced;
  const oldest = collection.reduce((m, it) => (it.priceAt && (!m || it.priceAt < m) ? it.priceAt : m), null);
  $('#refreshInfo').textContent = [
    oldest ? `Preise vom ${dateFmt.format(new Date(oldest))} oder neuer.` : '',
    unpriced > 0 ? `${unpriced} ${unpriced === 1 ? 'Karte hat' : 'Karten haben'} keinen Cardmarket-Preis und ${unpriced === 1 ? 'zählt' : 'zählen'} nicht zum Gesamtwert.` : '',
  ].filter(Boolean).join(' ');
}

['#colFilter', '#colSort', '#colLang'].forEach((s) => $(s).addEventListener('input', renderCollection));

/* Preise aktualisieren */
$('#btnRefresh').addEventListener('click', async () => {
  if (!collection.length) return;
  const btn = $('#btnRefresh');
  btn.disabled = true;
  const unique = [...new Map(collection.map((it) => [it.lang + ':' + it.id, it])).values()];
  let done = 0, failed = 0;
  const queue = unique.slice();
  async function worker() {
    while (queue.length) {
      const it = queue.shift();
      try {
        const card = await fresh(`/${it.lang}/cards/${encodeURIComponent(it.id)}`);
        if (card) for (const x of collection) if (x.lang === it.lang && x.id === it.id) applyCard(x, card);
      } catch { failed++; }
      done++;
      btn.textContent = `Aktualisiere… ${done}/${unique.length}`;
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  save();
  btn.disabled = false;
  btn.textContent = 'Preise aktualisieren';
  renderCollection();
  toast(failed ? `${failed} Karten konnten nicht geladen werden. Bist du online?` : 'Preise aktualisiert');
});

/* Sicherung */
$('#btnExport').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ app: 'kartenbinder', version: 1, saved: new Date().toISOString(), cards: collection }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kartenbinder-sicherung-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
});
$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const cards = Array.isArray(data) ? data : data.cards;
    if (!Array.isArray(cards)) throw new Error();
    let added = 0;
    for (const c of cards) {
      if (!c || !c.key || !c.id) continue;
      const have = collection.find((x) => x.key === c.key);
      if (have) have.qty = Math.max(have.qty, c.qty || 1);
      else { collection.push(c); added++; }
    }
    save();
    renderCollection();
    toast(`Sicherung geladen: ${added} neue Karten`);
  } catch {
    toast('Diese Datei ist keine Kartenbinder-Sicherung.');
  }
});

/* ---------- Karte zur Sammlung ---------- */
function applyCard(it, card) {
  it.name = card.name;
  it.image = card.image || it.image || '';
  it.setId = card.set?.id || it.setId;
  it.setName = card.set?.name || it.setName || '';
  it.localId = card.localId;
  it.official = card.set?.cardCount?.official || it.official;
  it.rarity = card.rarity || it.rarity || '';
  it.cm = card.pricing?.cardmarket || null;
  it.tp = card.pricing?.tcgplayer || null;
  it.priceAt = Date.now();
}

/* ---------- Detailansicht ---------- */
let sheetToken = 0;
function openSheet(html) {
  $('#sheetBody').innerHTML = html;
  $('#sheet').hidden = false;
  $('#sheetBackdrop').hidden = false;
  document.body.style.overflow = 'hidden';
  $('#sheet').scrollTop = 0;
}
function closeSheet() {
  sheetToken++;
  $('#sheet').hidden = true;
  $('#sheetBackdrop').hidden = true;
  document.body.style.overflow = '';
}
$('#sheetClose').addEventListener('click', closeSheet);
$('#sheetBackdrop').addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

async function openCard(lang, id, existing) {
  const token = ++sheetToken;
  openSheet(`<div class="scan-status"><span class="spinner"></span><span class="msg">Karte wird geladen…</span></div>`);
  let card;
  try { card = await getCard(lang, id); } catch { card = undefined; }
  if (token !== sheetToken) return;
  if (!card) {
    if (existing) return renderDetail(lang, cardFromItem(existing), existing, true);
    openSheet(`<p>Die Karte konnte nicht geladen werden. Prüfe deine Internetverbindung und versuche es noch einmal.</p>`);
    return;
  }
  renderDetail(lang, card, existing, false);
}
function cardFromItem(it) {
  return { id: it.id, name: it.name, image: it.image, localId: it.localId, rarity: it.rarity,
    set: { id: it.setId, name: it.setName, cardCount: { official: it.official } },
    pricing: { cardmarket: it.cm, tcgplayer: it.tp }, variants: { [it.variant]: true } };
}

function renderDetail(lang, card, existing, offline) {
  const variants = Object.entries(card.variants || {}).filter(([, on]) => on).map(([k]) => k);
  if (!variants.length) variants.push('normal');
  const state = {
    variant: existing?.variant || (variants.includes('normal') ? 'normal' : variants[0]),
    qty: existing?.qty || 1,
  };
  const cm = card.pricing?.cardmarket;
  const tp = card.pricing?.tcgplayer;
  const num = card.set?.cardCount?.official ? `${card.localId}/${card.set.cardCount.official}` : card.localId;
  const cmLink = `https://www.cardmarket.com/de/Pokemon/Products/Search?searchString=${encodeURIComponent(card.name)}`;

  const rows = (obj, fields, fmt) => fields.filter(([k]) => typeof obj?.[k] === 'number' && obj[k] > 0)
    .map(([k, label]) => `<tr><th scope="row">${label}</th><td class="num">${fmt.format(obj[k])}</td></tr>`).join('');
  const cmRows = rows(cm, [['trend', 'Preistrend'], ['avg30', 'Ø 30 Tage'], ['avg7', 'Ø 7 Tage'], ['low', 'Ab-Preis'],
    ['trend-holo', 'Reverse Holo: Trend'], ['avg30-holo', 'Reverse Holo: Ø 30 Tage'], ['low-holo', 'Reverse Holo: Ab-Preis']], eur);
  const tpRows = tp ? Object.entries(tp).filter(([, v]) => v && typeof v === 'object' && (v.marketPrice || v.midPrice))
    .map(([k, v]) => `<tr><th scope="row">${esc(k.replace(/-/g, ' '))}</th><td class="num">${usd.format(v.marketPrice || v.midPrice)}</td></tr>`).join('') : '';

  function body() {
    const v = eurPrice(cm, state.variant);
    const u = usdPrice(tp, state.variant);
    return `
    <div class="detail-head">
      <div class="art">${artHTML(card.image, 'high', card.name)}</div>
      <div class="detail-info">
        <h2 id="sheetTitle">${esc(card.name)}</h2>
        <div class="sub"><span class="flag">${LANG_LABEL[lang]}</span>${esc(card.set?.name || '')}</div>
        <div class="sub">Nr. ${esc(num)}${card.rarity ? ' · ' + esc(card.rarity) : ''}</div>
        ${card.illustrator ? `<div class="sub">Illustration: ${esc(card.illustrator)}</div>` : ''}
        <div class="big-price">${v != null ? eur.format(v) : u != null ? usd.format(u) : '–'}
          <small>${v != null ? 'Cardmarket-Preistrend' + (state.variant === 'reverse' ? ' (Reverse Holo)' : '') : u != null ? 'TCGplayer (USA), kein Cardmarket-Preis' : 'Für diese Karte gibt es noch keinen Preis in der Datenbank.'}</small>
        </div>
      </div>
    </div>
    ${offline ? `<p class="hint">Du bist offline. Angezeigt werden die zuletzt gespeicherten Daten.</p>` : ''}
    <div class="field"><span>Variante</span>
      <div class="chips">${variants.map((k) => `<button type="button" class="chip" data-variant="${k}" aria-pressed="${k === state.variant}">${VARIANT_LABEL[k] || esc(k)}</button>`).join('')}</div>
    </div>
    <div class="field"><span>Anzahl</span>
      <div class="stepper"><button type="button" data-step="-1" aria-label="Eine weniger">−</button><output id="qtyOut">${state.qty}</output><button type="button" data-step="1" aria-label="Eine mehr">+</button></div>
    </div>
    <div class="sheet-actions">
      <button type="button" class="btn primary" id="btnSave">${existing ? 'Änderungen speichern' : 'In den Binder legen'}</button>
      ${existing ? `<button type="button" class="btn danger" id="btnRemove">Entfernen</button>` : ''}
    </div>
    ${cmRows ? `<div class="table-wrap"><table class="prices"><caption>Cardmarket (Euro)</caption><tbody>${cmRows}</tbody></table></div>` : ''}
    ${tpRows ? `<div class="table-wrap"><table class="prices"><caption>TCGplayer (US-Dollar)</caption><tbody>${tpRows}</tbody></table></div>` : ''}
    <p class="source">Preise: Cardmarket${cm?.updated ? ', Stand ' + dateFmt.format(new Date(cm.updated)) : ''}, über TCGdex. <a href="${cmLink}" target="_blank" rel="noopener">Auf Cardmarket ansehen</a></p>`;
  }
  function paint() {
    openSheet(body());
    $('#sheetBody').querySelectorAll('[data-variant]').forEach((b) => b.onclick = () => { state.variant = b.dataset.variant; paint(); });
    $('#sheetBody').querySelectorAll('[data-step]').forEach((b) => b.onclick = () => {
      state.qty = Math.max(1, Math.min(999, state.qty + Number(b.dataset.step)));
      $('#qtyOut').textContent = state.qty;
    });
    $('#btnSave').onclick = () => {
      const key = `${lang}:${card.id}:${state.variant}`;
      if (existing && existing.key !== key) collection = collection.filter((x) => x.key !== existing.key);
      let it = collection.find((x) => x.key === key);
      if (it && !existing) it.qty += state.qty;
      else if (it) it.qty = state.qty;
      else {
        it = { key, id: card.id, lang, variant: state.variant, qty: state.qty, added: Date.now() };
        collection.push(it);
      }
      if (!offline) applyCard(it, card);
      save();
      closeSheet();
      renderCollection();
      toast(existing ? 'Gespeichert' : `${card.name} liegt jetzt im Binder`);
    };
    const rm = $('#btnRemove');
    if (rm) rm.onclick = () => {
      if (rm.dataset.confirm) {
        collection = collection.filter((x) => x.key !== existing.key);
        save(); closeSheet(); renderCollection(); toast('Karte entfernt');
      } else { rm.dataset.confirm = '1'; rm.textContent = 'Wirklich entfernen?'; }
    };
  }
  paint();
}

/* ---------- Suche ---------- */
function setLang(l) {
  searchLang = l;
  try { localStorage.setItem(LANG_KEY, l); } catch {}
  document.querySelectorAll('.lang-switch button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.lang === l)));
}
document.querySelectorAll('.lang-switch button').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));
setLang(searchLang);

const NUM_RE = /\b(?:([A-Z]{1,3})(?=\d))?(\d{1,3})\s*[\/|]\s*([A-Z]{1,3})?(\d{2,3})(?!\d)/;
const numLabel = (m) => (m[1] && m[3] ? m[1] : '') + m[2] + '/' + (m[1] && m[3] ? m[3] : '') + m[4];

$('#searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#searchInput').value.trim();
  if (!q) return;
  $('#searchInput').blur();
  const m = q.toUpperCase().match(NUM_RE);
  const name = m ? (q.slice(0, m.index) + ' ' + q.slice(m.index + m[0].length)).trim() : q;
  if (m) searchByNumber(searchLang, m, name);
  else searchByName(searchLang, q);
});

function resultsLoading(text) {
  $('#results').innerHTML = `<p class="note"><span class="spinner" style="display:inline-block;vertical-align:middle;margin-right:8px"></span>${esc(text)}</p>`;
}
function resultsNote(text) { $('#results').innerHTML = `<p class="note">${esc(text)}</p>`; }

async function renderHits(lang, hits, intro) {
  const sets = await getSets(lang).catch(() => []);
  const setName = new Map(sets.map((s, i) => [s.id, { name: s.name, idx: i, official: s.cardCount?.official }]));
  const box = $('#results');
  box.innerHTML = (intro ? `<p class="note">${esc(intro)}</p>` : '') + hits.map((h) => {
    const sid = h.set?.id || setIdOf(h.id);
    const s = setName.get(sid);
    const sname = h.set?.name || s?.name || sid;
    const official = h.set?.cardCount?.official || s?.official;
    return `<button type="button" class="hit" data-id="${esc(h.id)}">
      <div class="art">${artHTML(h.image, 'low', h.name)}</div>
      <span class="t">${esc(h.name)}</span>
      <span class="s">${esc(sname)} · ${esc(h.localId)}${official ? '/' + official : ''}</span>
    </button>`;
  }).join('');
  box.querySelectorAll('.hit').forEach((b) => b.addEventListener('click', () => {
    const existing = collection.find((x) => x.lang === lang && x.id === b.dataset.id);
    openCard(lang, b.dataset.id, existing);
  }));
}

async function searchByName(lang, q, intro) {
  resultsLoading('Suche läuft…');
  try {
    const [hits, sets] = await Promise.all([
      api(`/${lang}/cards?name=${encodeURIComponent(q)}`),
      getSets(lang).catch(() => []),
    ]);
    if (!hits || !hits.length) return resultsNote(`Keine Karte mit „${q}“ gefunden. Tipp: Prüfe die Sprache oben (gerade: ${LANG_LABEL[lang]}).`);
    const order = new Map(sets.map((s, i) => [s.id, i]));
    hits.sort((a, b) => (order.get(setIdOf(b.id)) ?? -1) - (order.get(setIdOf(a.id)) ?? -1));
    const shown = hits.slice(0, 120);
    await renderHits(lang, shown, intro || (hits.length > shown.length ? `${hits.length} Treffer, die neuesten ${shown.length} werden gezeigt. Gib die Nummer dazu ein, z. B. „${q} 025/165“.` : `${hits.length} Treffer. Tippe auf deine Karte.`));
  } catch {
    resultsNote('Die Kartendatenbank ist gerade nicht erreichbar. Bist du online?');
  }
}

/* Sucht über die Kartennummer, z. B. 025/165: alle Sets mit 165 Karten, darin Karte 25. */
async function findByNumber(lang, m) {
  const [, p1 = '', digits, p2 = '', totalStr] = m;
  const prefixed = Boolean(p1 && p2); // z. B. TG05/TG30
  const pre1 = prefixed ? p1 : '', pre2 = prefixed ? p2 : '';
  const total = Number(totalStr);
  const sets = await getSets(lang);
  const cand = sets.filter((s) => s.cardCount?.official === total || (pre2 && s.cardCount?.total === total));
  const plain = String(Number(digits));
  const ids = new Set();
  const localIds = pre1 ? [pre1 + digits, pre1 + plain, pre1 + plain.padStart(2, '0')] : [digits, plain, plain.padStart(3, '0')];
  for (const s of cand.slice(-15)) for (const l of localIds) ids.add(`${s.id}-${l}`);
  const cards = await Promise.all([...ids].map((id) => getCard(lang, id).catch(() => null)));
  const seen = new Set();
  return cards.filter((c) => c && !seen.has(c.id) && seen.add(c.id));
}

function normName(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9぀-ヿ一-鿿]/g, '');
}
function nameScore(cardName, text) {
  const a = normName(cardName), b = normName(text);
  if (!a || !b) return 0;
  if (b.includes(a)) return 10;
  // Anteil gemeinsamer Buchstabenpaare
  const pairs = (s) => { const p = new Set(); for (let i = 0; i < s.length - 1; i++) p.add(s.slice(i, i + 2)); return p; };
  const pa = pairs(a), pb = pairs(b);
  let hit = 0; pa.forEach((x) => { if (pb.has(x)) hit++; });
  return pa.size ? (hit / pa.size) * 8 : 0;
}

async function searchByNumber(lang, m, nameHint) {
  resultsLoading('Suche nach Kartennummer…');
  try {
    let cards = await findByNumber(lang, m);
    if (nameHint) cards.sort((a, b) => nameScore(b.name, nameHint) - nameScore(a.name, nameHint));
    if (!cards.length) {
      if (nameHint) return searchByName(lang, nameHint, `Keine Karte mit Nummer ${numLabel(m)} gefunden, hier die Treffer für „${nameHint}“.`);
      return resultsNote(`Keine Karte mit der Nummer ${numLabel(m)} gefunden. Prüfe die Sprache oben (gerade: ${LANG_LABEL[lang]}) oder suche nach dem Namen.`);
    }
    await renderHits(lang, cards, cards.length === 1 ? 'Gefunden:' : `${cards.length} Karten haben diese Nummer. Tippe auf deine.`);
    if (cards.length === 1 || (nameHint && nameScore(cards[0].name, nameHint) >= 6 && nameScore(cards[1]?.name, nameHint) < 6)) {
      openCard(lang, cards[0].id, collection.find((x) => x.lang === lang && x.id === cards[0].id));
    }
  } catch {
    resultsNote('Die Kartendatenbank ist gerade nicht erreichbar. Bist du online?');
  }
}

/* ---------- Scannen (Texterkennung im Browser) ---------- */
let tesseractLoad = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  if (!tesseractLoad) tesseractLoad = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESSERACT_URL;
    s.onload = resolve;
    s.onerror = () => { tesseractLoad = null; reject(new Error('Texterkennung konnte nicht geladen werden')); };
    document.head.appendChild(s);
  });
  return tesseractLoad;
}
const workers = {};
async function getWorker(lang, onProgress) {
  const langs = lang === 'ja' ? 'jpn+eng' : lang === 'de' ? 'deu+eng' : 'eng';
  if (!workers[langs]) {
    await loadTesseract();
    workers[langs] = window.Tesseract.createWorker(langs, 1, {
      logger: (m) => workers[langs]._progress && workers[langs]._progress(m),
    });
  }
  const w = await workers[langs];
  workers[langs]._progress = onProgress;
  return w;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => resolve({ im, url });
    im.onerror = () => reject(new Error('Bild konnte nicht gelesen werden'));
    im.src = url;
  });
}
/* Bild verkleinern, in Graustufen und mit mehr Kontrast, optional nur ein Ausschnitt (y0..y1 als Anteil) */
function prep(im, y0 = 0, y1 = 1, maxW = 1400) {
  const sh = Math.round(im.naturalHeight * (y1 - y0));
  const scale = Math.min(1, maxW / im.naturalWidth) * (y1 - y0 < 1 ? 1.6 : 1);
  const c = document.createElement('canvas');
  c.width = Math.round(im.naturalWidth * scale);
  c.height = Math.round(sh * scale);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(im, 0, Math.round(im.naturalHeight * y0), im.naturalWidth, sh, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height);
  const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    let v = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
    v = Math.max(0, Math.min(255, (v - 128) * 1.5 + 128));
    p[i] = p[i + 1] = p[i + 2] = v;
  }
  g.putImageData(d, 0, 0);
  return c;
}

const STOP = /^(basis|basic|phase|stage|stufe|entwickelt|evolves|kp|hp|trainer|item|energie|energy|supporter|unterstützer|pokemon|pokémon|ex|gx|v|vmax|vstar|たね|進化|ポケモン)$/i;
function guessName(text, lang) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 4);
  for (const line of lines) {
    const words = lang === 'ja'
      ? (line.match(/[゠-ヿー一-鿿]{2,}/g) || [])
      : (line.match(/[A-Za-zÄÖÜäöüßéÉ\-']{3,}/g) || []);
    const good = words.filter((w) => !STOP.test(w));
    if (good.length) return good.sort((a, b) => b.length - a.length)[0];
  }
  return '';
}

$('#scanFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const lang = searchLang;
  const status = $('#scanStatus');
  let url;
  const say = (msg, pct) => {
    status.hidden = false;
    status.innerHTML = `${url ? `<img src="${url}" alt="Dein Foto">` : '<span class="spinner"></span>'}<div class="msg">${esc(msg)}${pct != null ? `<div class="bar"><i style="width:${Math.round(pct * 100)}%"></i></div>` : ''}</div>`;
  };
  $('#results').innerHTML = '';
  try {
    let im;
    ({ im, url } = await loadImage(file));
    say('Texterkennung wird vorbereitet… (beim ersten Mal dauert das etwas)', 0.05);
    const w = await getWorker(lang, (m) => {
      if (m.status === 'recognizing text') say('Lese die Karte…', 0.3 + m.progress * 0.7);
      else if (/load|initializ/.test(m.status)) say('Texterkennung wird geladen…', 0.05 + (m.progress || 0) * 0.25);
    });
    // 1. Unteres Viertel: dort steht die Kartennummer
    const bottom = await w.recognize(prep(im, 0.78, 1));
    let num = (bottom.data.text || '').toUpperCase().replace(/[O]/g, '0').match(NUM_RE);
    // 2. Ganze Karte: Name oben, notfalls auch die Nummer
    const whole = await w.recognize(prep(im));
    const wholeText = whole.data.text || '';
    if (!num) num = wholeText.toUpperCase().match(NUM_RE);
    const name = guessName(wholeText, lang);
    const found = [name && `Name „${name}“`, num && `Nummer ${numLabel(num)}`].filter(Boolean).join(' und ');
    say(found ? `Erkannt: ${found}` : 'Ich konnte auf dem Foto leider nichts lesen. Versuch es mit mehr Licht und ohne Spiegelung, oder suche unten nach dem Namen.');
    if (name) $('#searchInput').value = name + (num ? ' ' + numLabel(num) : '');
    if (num) await searchByNumber(lang, num, name);
    else if (name) await searchByName(lang, name);
  } catch (err) {
    say((err && err.message) || 'Beim Scannen ist etwas schiefgelaufen.');
  }
});

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ---------- Start ---------- */
renderCollection();
show('collection');
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
