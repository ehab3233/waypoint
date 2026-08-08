'use strict';

const MAX_CITIES = 8;
const MAX_NIGHTS = 30;
const MODE_ICONS = { train: '🚄', bus: '🚌', flight: '✈️', ferry: '⛴️' };
const MODE_COLORS = { train: '#0e7c7b', bus: '#d9952f', flight: '#ff6b5e', ferry: '#4a7fb5' };
const MODE_NAMES = { train: 'Rail', bus: 'Coach', flight: 'Flight', ferry: 'Ferry' };
const BADGES = { cheapest: '💶', fastest: '⚡', comfy: '🛋️' };

let ALL_CITIES = [];
const state = {
  cities: [],        // ordered as entered
  locks: {},         // cityId -> slot index
  nights: {},        // cityId -> nights
  defaultNights: 2,
  modes: ['train', 'bus', 'flight', 'ferry'],
  roundTrip: false,
  armed: null,       // chip queued for backspace deletion — never removed on the first press
};
let map = null;
let mapLayer = null;

const $ = (sel) => document.querySelector(sel);
const flag = (cc) =>
  String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
const cityById = (id) => ALL_CITIES.find((c) => c.id === id);
const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDur = (min) => {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
};
const nightsFor = (id) =>
  Object.prototype.hasOwnProperty.call(state.nights, id) ? state.nights[id] : state.defaultNights;

/* ---------- chips + autocomplete ---------- */

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
      <span class="flag">${flag(c.cc)}</span>${esc(c.name)}
      ${lock ? `<span class="lock-badge">${lock}</span>` : ''}
      <span class="chip-nights" title="Nights in ${esc(c.name)}">
        <button class="n-minus" data-id="${id}" aria-label="One fewer night in ${esc(c.name)}" ${n === 0 ? 'disabled' : ''}>−</button>
        <span class="n-val">${n}n</span>
        <button class="n-plus" data-id="${id}" aria-label="One more night in ${esc(c.name)}" ${n >= MAX_NIGHTS ? 'disabled' : ''}>+</button>
      </span>
      <button class="pin" title="Lock position" data-id="${id}">📌</button>
      <button class="rm" title="Remove" data-id="${id}">✕</button>`;
    box.appendChild(chip);
  });
  $('#go').disabled = state.cities.length < 2;

  const armedCity = state.armed && cityById(state.armed);
  const hint = $('#backspace-hint');
  if (armedCity) {
    hint.textContent = `⌫ Press backspace again to remove ${armedCity.name}.`;
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

function hideSuggestions() {
  $('#suggestions').hidden = true;
  $('#suggestions').innerHTML = '';
}

function showSuggestions(q) {
  const ul = $('#suggestions');
  if (!q || state.cities.length >= MAX_CITIES) return hideSuggestions();

  // With ~400 cities a prefix-only match hides too much, but a plain substring
  // search buries the city you actually typed — so rank prefixes first.
  const scored = [];
  for (const c of ALL_CITIES) {
    if (state.cities.includes(c.id)) continue;
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
        `<li data-id="${c.id}"><span class="flag">${flag(c.cc)}</span> ${esc(c.name)}<span class="sub">${esc(c.country)}</span></li>`
    )
    .join('');
  ul.hidden = false;
}

function openLockMenu(anchor, id) {
  closeLockMenu();
  const menu = document.createElement('div');
  menu.className = 'lock-menu';
  menu.id = 'lock-menu';
  const n = state.cities.length;
  const cur = state.locks[id];
  const opts = [
    { v: undefined, t: '🔓 Free (optimizer decides)' },
    { v: 0, t: '🛬 Lock as start' },
    { v: n - 1, t: '🛫 Lock as end' },
  ];
  for (let i = 1; i < n - 1; i++) opts.push({ v: i, t: `📍 Lock as stop #${i + 1}` });
  menu.innerHTML = opts
    .map(
      (o) =>
        `<button data-pos="${o.v === undefined ? '' : o.v}" class="${cur === o.v ? 'on' : ''}">${o.t}</button>`
    )
    .join('');
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.left = `${Math.min(r.left + window.scrollX, window.innerWidth - 180)}px`;
  menu.style.top = `${r.bottom + window.scrollY + 6}px`;
  menu.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const pos = btn.dataset.pos;
    // one city per slot: evict whoever held it
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
  state.armed = null;
  btn.classList.add('loading');
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
    btn.classList.remove('loading');
    btn.textContent = 'Route my trip';
    renderChips();
  }
}

function renderResults(data) {
  $('#results').hidden = false;
  $('#empty-state').hidden = true;
  const n = state.cities.length;
  const perms = [1, 1, 2, 6, 24, 120, 720, 5040, 40320][n];
  const modeText =
    state.modes.length === 4
      ? 'all modes'
      : state.modes.map((m) => MODE_NAMES[m].toLowerCase()).join(' + ') + ' only';
  $('#results-sub').textContent =
    `${n} destinations · ${perms.toLocaleString()} possible orderings evaluated per style · ` +
    (state.roundTrip ? 'round trip' : 'open-jaw') +
    ` · ${modeText}`;

  const cards = $('#cards');
  cards.innerHTML = '';
  data.itineraries.forEach((it, idx) => {
    cards.appendChild(renderCard(it, idx === 0));
  });
  initMap();
  drawItinerary(data.itineraries[0]);
  $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderCard(it, active) {
  const card = document.createElement('article');
  card.className = 'card itin' + (active ? ' active' : '');
  card.dataset.profile = it.profile;

  const cityRow = (id, i, isReturn) => {
    const c = cityById(id);
    const lock = state.locks[id] !== undefined ? `<span class="locked-tag">📌 locked</span>` : '';
    const n = it.nights[id];
    const stay =
      !isReturn && n !== undefined
        ? `<span class="stay">🌙 ${n} night${n === 1 ? '' : 's'}</span>`
        : '';
    return `<li class="tl-city"><span class="n">${i + 1}</span><span class="flag">${flag(c.cc)}</span>${esc(c.name)}${lock}${stay}</li>`;
  };
  const legRow = (hop) => {
    const pills = hop.segments
      .map(
        (s) =>
          `<span class="leg-pill mode-${s.mode}">${MODE_ICONS[s.mode]} ${esc(s.op)}${s.estimated ? '<i class="est">EST</i>' : ''}</span>`
      )
      .join('');
    return `<li class="tl-leg">${pills}<span class="leg-meta">€${hop.price} · ${fmtDur(hop.durationMin)}${hop.transfers ? ` · ${hop.transfers} transfer${hop.transfers > 1 ? 's' : ''}` : ' · direct'}</span></li>`;
  };

  const seq = it.roundTrip ? [...it.order, it.order[0]] : it.order;
  let timeline = '';
  seq.forEach((id, i) => {
    timeline += cityRow(id, i, it.roundTrip && i === seq.length - 1);
    if (i < seq.length - 1) timeline += legRow(it.hops[i]);
  });

  card.innerHTML = `
    <div class="itin-head">
      <span class="itin-label">${BADGES[it.profile]} ${it.label}</span>
      <span class="itin-badge badge-${it.profile}">${it.label}</span>
      ${it.totals.estimated ? '<span class="est-flag">includes estimated fares</span>' : ''}
    </div>
    <div class="itin-totals">
      <span class="tot"><b>€${it.totals.price}</b><span>total transport</span></span>
      <span class="tot"><b>${fmtDur(it.totals.durationMin)}</b><span>in transit</span></span>
      <span class="tot"><b>${it.totals.transfers}</b><span>transfers</span></span>
      <span class="tot"><b>~${it.totals.estDays}d</b><span>trip length</span></span>
    </div>
    <ul class="timeline">${timeline}</ul>
    <div class="railpass ${it.railPass.applicable && it.railPass.delta > 0 ? 'win' : ''}">
      🎫 <b>Rail pass check:</b> ${esc(it.railPass.verdict)}
    </div>
    <div class="notes">
      <h4>Why this order won</h4>
      <ul>${it.notes.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
    </div>`;

  card.addEventListener('click', () => {
    document.querySelectorAll('.itin').forEach((el) => el.classList.remove('active'));
    card.classList.add('active');
    drawItinerary(it);
  });
  return card;
}

/* ---------- map ---------- */

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
      icon: L.divIcon({ className: 'city-marker', html: String(i + 1), iconSize: [24, 24] }),
    })
      .bindTooltip(`${i + 1}. ${c.name}`, { direction: 'top' })
      .addTo(mapLayer);
  });

  it.hops.forEach((hop) => {
    hop.segments.forEach((s) => {
      const a = cityById(s.from);
      const b = cityById(s.to);
      if (!a || !b) return;
      L.polyline(
        [
          [a.lat, a.lon],
          [b.lat, b.lon],
        ],
        {
          color: MODE_COLORS[s.mode],
          weight: 3.5,
          opacity: 0.85,
          dashArray: s.mode === 'flight' ? '2 8' : s.mode === 'bus' ? '8 6' : null,
        }
      )
        .bindTooltip(
          `${MODE_ICONS[s.mode]} ${s.op} · €${s.price} · ${fmtDur(s.effMin)}${s.estimated ? ' (est.)' : ''}`,
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
  $('#def-nights-label').textContent = `${state.defaultNights} night${state.defaultNights === 1 ? '' : 's'}`;
  $('#def-minus').disabled = state.defaultNights <= 0;
  $('#def-plus').disabled = state.defaultNights >= MAX_NIGHTS;
  renderChips();
}

async function init() {
  ALL_CITIES = await (await fetch('/api/cities')).json();

  const countries = new Set(ALL_CITIES.map((c) => c.country)).size;
  $('#empty-blurb').textContent =
    `Add at least two destinations above — anywhere across ${ALL_CITIES.length} cities in ${countries} countries — and Waypoint will crunch every possible ordering, all 40,320 of them if you max it out, against real multimodal fares.`;
  try {
    const h = await (await fetch('/api/health')).json();
    const foot = $('#foot-stats');
    if (foot) {
      foot.textContent =
        `${ALL_CITIES.length} cities · ${countries} countries · ${h.curatedLegs} curated legs · ${h.syntheticLegs} modelled air legs`;
    }
  } catch {
    /* stats are decorative; the planner works without them */
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
    if (!e.target.closest('.chip-box')) disarm();
  });

  document.querySelectorAll('.seg').forEach((btn) =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('.seg').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.roundTrip = btn.dataset.trip === 'round';
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
