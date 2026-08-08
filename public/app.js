'use strict';

const MAX_CITIES = 8;
const MAX_NIGHTS = 30;

/* Lucide icons (lucide.dev) — inline SVG on currentColor, per the design system. */
const ICON_PATHS = {
  train:
    '<path d="M8 3.1V7a4 4 0 0 0 8 0V3.1"/><path d="m9 15-1-1"/><path d="m15 15 1-1"/><path d="M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z"/><path d="m8 19-2 3"/><path d="m16 19 2 3"/>',
  bus:
    '<path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/>',
  flight:
    '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  ferry:
    '<path d="M12 10.189V14"/><path d="M12 2v3"/><path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6"/><path d="M19.38 20A11.6 11.6 0 0 0 21 14l-8.188-3.639a2 2 0 0 0-1.624 0L3 14a11.6 11.6 0 0 0 2.81 7.76"/><path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  pin:
    '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  unlock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  landing:
    '<path d="M2 22h20"/><path d="M3.77 10.77 2 9l2-4.5 1.1.55c.55.28.9.84.9 1.45s.35 1.17.9 1.45L8 8.5l3-6 1.05.53a2 2 0 0 1 1.09 1.52l.72 5.4a2 2 0 0 0 1.09 1.52l4.4 2.2c.42.22.78.55 1.01.96l.6 1.03c.49.88-.06 1.98-1.06 2.1l-1.18.15c-.47.06-.95-.02-1.37-.24L4.29 11.15a2 2 0 0 1-.52-.38z"/>',
  takeoff:
    '<path d="M2 22h20"/><path d="M6.36 17.4 4 17l-2-4 1.1-.55a2 2 0 0 1 1.8 0l.17.1a2 2 0 0 0 1.8 0L8 12 5 6l.9-.45a2 2 0 0 1 2.09.2l4.02 3a2 2 0 0 0 2.1.2l4.19-2.06a2.41 2.41 0 0 1 1.73-.17L21 7a1.4 1.4 0 0 1 .87 1.99l-.38.76c-.23.46-.6.84-1.07 1.08L7.58 17.2a2 2 0 0 1-1.22.18z"/>',
  mappin:
    '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  ticket:
    '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/>',
  arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9"/>',
  euro:
    '<path d="M4 10h12"/><path d="M4 14h9"/><path d="M19 6a7.7 7.7 0 0 0-5.2-2A7.9 7.9 0 0 0 6 12c0 4.4 3.5 8 7.8 8 2 0 3.8-.8 5.2-2"/>',
  zap:
    '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  armchair:
    '<path d="M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3"/><path d="M3 11v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v2H7v-2a2 2 0 0 0-4 0Z"/><path d="M5 18v2"/><path d="M19 18v2"/>',
};

const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;

const PROFILE_ICON = { cheapest: 'euro', fastest: 'zap', comfy: 'armchair' };
const MODE_LABEL = { train: 'Rail', bus: 'Coach', flight: 'Flight', ferry: 'Ferry' };

/* Line treatments read from the design tokens at runtime, so the map never
   carries a hard-coded hex and stays in step with the stylesheet. */
const token = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

let MODE_STYLE = {};
function readModeStyles() {
  MODE_STYLE = {
    train: { color: token('--color-text'), weight: 3, dashArray: null },
    bus: { color: token('--color-neutral-600'), weight: 2.5, dashArray: '10 6' },
    flight: { color: token('--color-accent'), weight: 2.5, dashArray: '2 7' },
    ferry: { color: token('--color-neutral-400'), weight: 2.5, dashArray: '12 5 3 5' },
  };
}

let ALL_CITIES = [];
const state = {
  cities: [],
  locks: {},
  nights: {},        // cityId -> nights
  defaultNights: 2,
  modes: ['train', 'bus', 'flight', 'ferry'],
  roundTrip: false,
  armed: null,       // chip queued for backspace deletion — never deleted on the first press
};
let map = null;
let mapLayer = null;

const $ = (sel) => document.querySelector(sel);
const cityById = (id) => ALL_CITIES.find((c) => c.id === id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDur = (min) => {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
};
const nightsFor = (id) =>
  Object.prototype.hasOwnProperty.call(state.nights, id) ? state.nights[id] : state.defaultNights;

/* ---------- chips ---------- */

function lockLabel(id) {
  const pos = state.locks[id];
  if (pos === undefined) return null;
  if (pos === 0) return 'START';
  if (pos === state.cities.length - 1) return 'END';
  return `#${pos + 1}`;
}

function disarm() {
  if (state.armed) {
    state.armed = null;
    renderChips();
  }
}

function renderChips() {
  const box = $('#chips');
  box.innerHTML = '';
  state.cities.forEach((id) => {
    const c = cityById(id);
    if (!c) return;
    const chip = document.createElement('span');
    const classes = ['chip'];
    if (state.locks[id] !== undefined) classes.push('locked');
    if (state.armed === id) classes.push('armed');
    chip.className = classes.join(' ');
    const lock = lockLabel(id);
    const n = nightsFor(id);
    chip.innerHTML = `
      <span class="cc">${esc(c.cc)}</span><span class="chip-name">${esc(c.name)}</span>
      ${lock ? `<span class="lock-badge">${lock}</span>` : ''}
      <span class="chip-nights" title="Nights in ${esc(c.name)}">
        <button class="n-minus" data-id="${id}" aria-label="One fewer night in ${esc(c.name)}" ${n === 0 ? 'disabled' : ''}>−</button>
        <span class="n-val">${n}n</span>
        <button class="n-plus" data-id="${id}" aria-label="One more night in ${esc(c.name)}" ${n >= MAX_NIGHTS ? 'disabled' : ''}>+</button>
      </span>
      <button class="pin" title="Lock position" aria-label="Lock ${esc(c.name)} to a position" data-id="${id}">${icon('pin')}</button>
      <button class="rm" title="Remove" aria-label="Remove ${esc(c.name)}" data-id="${id}">${icon('x')}</button>`;
    box.appendChild(chip);
  });
  $('#go').disabled = state.cities.length < 2;
  const armedCity = state.armed && cityById(state.armed);
  const hint = $('#backspace-hint');
  if (armedCity) {
    hint.textContent = `Press backspace again to remove ${armedCity.name}.`;
    hint.hidden = false;
  } else {
    hint.hidden = true;
  }
  $('#city-input').placeholder = state.cities.length
    ? state.cities.length >= MAX_CITIES
      ? 'That’s the limit — 8 keeps the math honest'
      : 'Add another…'
    : 'Start typing a city… e.g. Amsterdam, Tokyo, Lima';
}

function addCity(id) {
  if (state.cities.length >= MAX_CITIES || state.cities.includes(id)) return;
  state.armed = null;
  state.cities.push(id);
  renderChips();
  $('#city-input').value = '';
  hideSuggestions();
  $('#city-input').focus();
}

function removeCity(id) {
  state.cities = state.cities.filter((x) => x !== id);
  delete state.locks[id];
  delete state.nights[id];
  if (state.armed === id) state.armed = null;
  for (const [cid, pos] of Object.entries(state.locks)) {
    if (pos >= state.cities.length) delete state.locks[cid];
  }
  renderChips();
}

function setNights(id, n) {
  state.nights[id] = Math.max(0, Math.min(MAX_NIGHTS, n));
  renderChips();
}

/* ---------- autocomplete ---------- */

function hideSuggestions() {
  $('#suggestions').hidden = true;
  $('#suggestions').innerHTML = '';
}

function showSuggestions(q) {
  const ul = $('#suggestions');
  if (!q || state.cities.length >= MAX_CITIES) return hideSuggestions();

  // Prefix matches rank above substring matches — with 396 cities, a plain
  // substring search buries the city you actually typed.
  const pool = ALL_CITIES.filter((c) => !state.cities.includes(c.id));
  const scored = [];
  for (const c of pool) {
    const name = c.name.toLowerCase();
    const country = c.country.toLowerCase();
    let rank = -1;
    if (name.startsWith(q)) rank = 0;
    else if (country.startsWith(q)) rank = 1;
    else if (name.includes(q)) rank = 2;
    else if (country.includes(q)) rank = 3;
    if (rank >= 0) scored.push({ c, rank });
  }
  scored.sort((a, b) => a.rank - b.rank || a.c.name.localeCompare(b.c.name));
  const matches = scored.slice(0, 10).map((s) => s.c);
  if (!matches.length) return hideSuggestions();

  ul.innerHTML = matches
    .map(
      (c) =>
        `<li data-id="${c.id}"><span class="cc">${esc(c.cc)}</span><span class="sug-name">${esc(c.name)}</span><span class="sub">${esc(c.country)}${c.region ? ` · ${esc(c.region)}` : ''}</span></li>`
    )
    .join('');
  ul.hidden = false;
}

/* ---------- lock menu ---------- */

function openLockMenu(anchor, id) {
  closeLockMenu();
  const menu = document.createElement('div');
  menu.className = 'lock-menu';
  menu.id = 'lock-menu';
  const n = state.cities.length;
  const cur = state.locks[id];
  const opts = [
    { v: undefined, t: 'Free — optimizer decides', ic: 'unlock' },
    { v: 0, t: 'Lock as start', ic: 'landing' },
    { v: n - 1, t: 'Lock as end', ic: 'takeoff' },
  ];
  for (let i = 1; i < n - 1; i++) opts.push({ v: i, t: `Lock as stop #${i + 1}`, ic: 'mappin' });
  menu.innerHTML = opts
    .map(
      (o) =>
        `<button data-pos="${o.v === undefined ? '' : o.v}" class="${cur === o.v ? 'on' : ''}">${icon(o.ic)}${o.t}</button>`
    )
    .join('');
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.left = `${Math.min(r.left + window.scrollX, window.innerWidth - 200)}px`;
  menu.style.top = `${r.bottom + window.scrollY + 6}px`;
  menu.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const pos = btn.dataset.pos;
    if (pos === '') delete state.locks[id];
    else {
      const p = Number(pos);
      for (const [cid, cpos] of Object.entries(state.locks)) if (cpos === p) delete state.locks[cid];
      state.locks[id] = p;
    }
    closeLockMenu();
    renderChips();
  });
}

function closeLockMenu() {
  const m = $('#lock-menu');
  if (m) m.remove();
}

/* ---------- planning ---------- */

async function planTrip() {
  const btn = $('#go');
  const label = btn.innerHTML;
  state.armed = null;
  btn.disabled = true;
  btn.textContent = 'Crunching permutations…';
  $('#error').hidden = true;
  try {
    const nights = {};
    state.cities.forEach((id) => (nights[id] = nightsFor(id)));
    const res = await fetch('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cities: state.cities,
        locks: state.locks,
        roundTrip: state.roundTrip,
        nights,
        defaultNights: state.defaultNights,
        modes: state.modes,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Planning failed');
    renderResults(data);
  } catch (err) {
    $('#error').textContent = err.message;
    $('#error').hidden = false;
  } finally {
    btn.innerHTML = label;
    btn.disabled = state.cities.length < 2;
    renderChips();
  }
}

function renderResults(data) {
  $('#results').hidden = false;
  $('#empty-state').hidden = true;
  const n = state.cities.length;
  const perms = [1, 1, 2, 6, 24, 120, 720, 5040, 40320][n];
  const modeText =
    state.modes.length === 4 ? 'all modes' : state.modes.map((m) => MODE_LABEL[m].toLowerCase()).join(' + ');
  $('#results-sub').textContent =
    `${n} destinations · ${perms.toLocaleString()} possible orderings evaluated per style · ` +
    (state.roundTrip ? 'round trip' : 'open-jaw') +
    ` · ${modeText}`;

  const cards = $('#cards');
  cards.innerHTML = '';
  data.itineraries.forEach((it, idx) => cards.appendChild(renderCard(it, idx === 0)));
  renderLegend();
  initMap();
  drawItinerary(data.itineraries[0]);
  $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderCard(it, active) {
  const card = document.createElement('article');
  card.className = 'itin' + (active ? ' active' : '');
  card.dataset.profile = it.profile;

  const cityRow = (id, i, isReturn) => {
    const c = cityById(id);
    const lock =
      state.locks[id] !== undefined ? `<span class="locked-tag">${icon('pin')}LOCKED</span>` : '';
    const n = it.nights[id];
    const stay =
      !isReturn && n !== undefined
        ? `<span class="stay">${icon('moon')}${n} night${n === 1 ? '' : 's'}</span>`
        : '';
    return `<li class="tl-city"><span class="n">${i + 1}</span><span class="cc">${esc(c.cc)}</span>${esc(c.name)}${lock}${stay}</li>`;
  };
  const legRow = (hop) => {
    const pills = hop.segments
      .map(
        (s) =>
          `<span class="leg-pill mode-${s.mode}">${icon(s.mode)}${esc(s.op)}${s.estimated ? '<i class="est">EST</i>' : ''}</span>`
      )
      .join('');
    const meta = `€${hop.price} · ${fmtDur(hop.durationMin)}${
      hop.transfers ? ` · ${hop.transfers} transfer${hop.transfers > 1 ? 's' : ''}` : ' · direct'
    }`;
    return `<li class="tl-leg">${pills}<span>${meta}</span></li>`;
  };

  const seq = it.roundTrip ? [...it.order, it.order[0]] : it.order;
  let timeline = '';
  seq.forEach((id, i) => {
    timeline += cityRow(id, i, it.roundTrip && i === seq.length - 1);
    if (i < seq.length - 1) timeline += legRow(it.hops[i]);
  });

  const rpWin = it.railPass.applicable && it.railPass.delta > 0;

  card.innerHTML = `
    <div class="itin-head">
      ${icon(PROFILE_ICON[it.profile])}
      <span class="itin-label">${esc(it.label)}</span>
      ${it.totals.estimated ? '<span class="est-flag">Includes estimated fares</span>' : ''}
    </div>
    <div class="itin-totals">
      <span class="tot"><b>€${it.totals.price}</b><span>Total transport</span></span>
      <span class="tot"><b>${fmtDur(it.totals.durationMin)}</b><span>In transit</span></span>
      <span class="tot"><b>${it.totals.transfers}</b><span>Transfers</span></span>
      <span class="tot"><b>~${it.totals.estDays}d</b><span>Trip length</span></span>
    </div>
    <ul class="timeline">${timeline}</ul>
    <div class="railpass${rpWin ? ' win' : ''}">
      ${icon('ticket')}<span><b>Rail pass check:</b> ${esc(it.railPass.verdict)}</span>
    </div>
    <div class="notes">
      <h4>Why this order won</h4>
      <ul>${it.notes.map((s) => `<li>${icon('arrow')}<span>${esc(s)}</span></li>`).join('')}</ul>
    </div>`;

  card.addEventListener('click', () => {
    document.querySelectorAll('.itin').forEach((el) => el.classList.remove('active'));
    card.classList.add('active');
    drawItinerary(it);
  });
  return card;
}

/* ---------- map ---------- */

function renderLegend() {
  const legend = $('#map-legend');
  legend.innerHTML = state.modes
    .map((mode) => {
      const s = MODE_STYLE[mode];
      return `<span><svg viewBox="0 0 22 6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3"
        stroke="${s.color}" stroke-width="${s.weight}"${s.dashArray ? ` stroke-dasharray="${s.dashArray}"` : ''}/></svg>${MODE_LABEL[mode]}</span>`;
    })
    .join('');
  legend.style.gridTemplateColumns = `repeat(${Math.max(1, state.modes.length)}, minmax(0, 1fr))`;
}

function initMap() {
  if (typeof L === 'undefined') return; // map is progressive enhancement
  if (map) {
    setTimeout(() => map.invalidateSize(), 50);
    return;
  }
  map = L.map('map', { scrollWheelZoom: false, worldCopyJump: true });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 18,
  }).addTo(map);
}

function drawItinerary(it) {
  if (!map) return;
  if (mapLayer) mapLayer.remove();
  mapLayer = L.layerGroup().addTo(map);

  const seq = it.roundTrip ? [...it.order, it.order[0]] : it.order;
  const pts = [];

  seq.forEach((id, i) => {
    if (it.roundTrip && i === seq.length - 1) return;
    const c = cityById(id);
    if (!c) return;
    pts.push([c.lat, c.lon]);
    L.marker([c.lat, c.lon], {
      icon: L.divIcon({ className: 'city-marker', html: String(i + 1), iconSize: [22, 22] }),
    })
      .bindTooltip(`${i + 1}. ${c.name}`, { direction: 'top' })
      .addTo(mapLayer);
  });

  it.hops.forEach((hop) => {
    hop.segments.forEach((s) => {
      const a = cityById(s.from);
      const b = cityById(s.to);
      if (!a || !b) return;
      const style = MODE_STYLE[s.mode] || MODE_STYLE.train;
      L.polyline(
        [
          [a.lat, a.lon],
          [b.lat, b.lon],
        ],
        { ...style, opacity: 0.9, lineCap: 'butt' }
      )
        .bindTooltip(
          `${MODE_LABEL[s.mode]} · ${s.op} · €${s.price} · ${fmtDur(s.effMin)}${s.estimated ? ' (est.)' : ''}`,
          { sticky: true }
        )
        .addTo(mapLayer);
    });
  });

  setTimeout(() => {
    map.invalidateSize();
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.25));
  }, 60);
}

/* ---------- wiring ---------- */

function syncDefaultNights() {
  $('#def-nights').textContent = String(state.defaultNights);
  $('#def-minus').disabled = state.defaultNights <= 0;
  $('#def-plus').disabled = state.defaultNights >= MAX_NIGHTS;
  renderChips();
}

async function init() {
  readModeStyles();
  ALL_CITIES = await (await fetch('/api/cities')).json();

  // Stat row + footer, filled from live data rather than hard-coded numbers.
  const countries = new Set(ALL_CITIES.map((c) => c.country)).size;
  $('#stat-cities').textContent = ALL_CITIES.length.toLocaleString();
  $('#stat-countries').textContent = String(countries);
  try {
    const h = await (await fetch('/api/health')).json();
    const legs = (h.curatedLegs || 0) + (h.syntheticLegs || 0);
    $('#stat-legs').textContent = legs.toLocaleString();
    const foot = $('#foot-stats');
    if (foot) {
      foot.textContent =
        `Waypoint · ${ALL_CITIES.length} cities · ${countries} countries · ${h.curatedLegs} curated legs · ${h.syntheticLegs} modelled air legs`;
    }
  } catch {
    $('#stat-legs').textContent = '—';
  }

  const input = $('#city-input');
  input.addEventListener('input', () => {
    disarm();
    showSuggestions(input.value.trim().toLowerCase());
  });
  input.addEventListener('keydown', (e) => {
    const items = [...document.querySelectorAll('.suggestions li')];
    if (e.key === 'Enter' && items.length) {
      e.preventDefault();
      addCity((items.find((li) => li.classList.contains('active')) || items[0]).dataset.id);
    } else if (e.key === 'Backspace' && !input.value && state.cities.length) {
      // Two-step delete: the first backspace only arms the last chip, so a
      // stray keystroke never silently drops a destination.
      e.preventDefault();
      const last = state.cities[state.cities.length - 1];
      if (state.armed === last) removeCity(last);
      else {
        state.armed = last;
        renderChips();
      }
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const cur = items.findIndex((li) => li.classList.contains('active'));
      const next = e.key === 'ArrowDown' ? Math.min(cur + 1, items.length - 1) : Math.max(cur - 1, 0);
      items.forEach((li, i) => li.classList.toggle('active', i === next));
    } else if (e.key === 'Escape') {
      disarm();
      hideSuggestions();
    } else if (e.key.length === 1) {
      disarm();
    }
  });
  input.addEventListener('blur', () => setTimeout(disarm, 150));

  $('#suggestions').addEventListener('mousedown', (e) => {
    const li = e.target.closest('li');
    if (li) addCity(li.dataset.id);
  });

  $('#chips').addEventListener('click', (e) => {
    const minus = e.target.closest('.n-minus');
    const plus = e.target.closest('.n-plus');
    const pin = e.target.closest('.pin');
    const rm = e.target.closest('.rm');
    if (minus) setNights(minus.dataset.id, nightsFor(minus.dataset.id) - 1);
    else if (plus) setNights(plus.dataset.id, nightsFor(plus.dataset.id) + 1);
    else if (pin) openLockMenu(pin, pin.dataset.id);
    else if (rm) removeCity(rm.dataset.id);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.lock-menu') && !e.target.closest('.pin')) closeLockMenu();
    if (!e.target.closest('.autocomplete')) hideSuggestions();
    if (!e.target.closest('.chipbox')) disarm();
  });

  document.querySelectorAll('input[name="trip"]').forEach((radio) =>
    radio.addEventListener('change', () => {
      state.roundTrip = radio.value === 'round' && radio.checked;
    })
  );

  $('#modes').addEventListener('change', (e) => {
    const boxes = [...document.querySelectorAll('#modes input[type="checkbox"]')];
    const checked = boxes.filter((b) => b.checked);
    if (checked.length === 0) {
      // Never let the user strand themselves with no transport at all.
      e.target.checked = true;
      return;
    }
    state.modes = checked.map((b) => b.value);
  });

  $('#def-minus').addEventListener('click', () => {
    state.defaultNights = Math.max(0, state.defaultNights - 1);
    syncDefaultNights();
  });
  $('#def-plus').addEventListener('click', () => {
    state.defaultNights = Math.min(MAX_NIGHTS, state.defaultNights + 1);
    syncDefaultNights();
  });

  $('#go').addEventListener('click', planTrip);

  document.querySelectorAll('.example').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.cities = [];
      state.locks = {};
      state.nights = {};
      state.armed = null;
      btn.dataset.cities.split(',').forEach((id) => state.cities.push(id));
      renderChips();
      planTrip();
    })
  );

  syncDefaultNights();
}

init();
