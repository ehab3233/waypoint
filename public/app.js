'use strict';

const MAX_CITIES = 8;
const MODE_ICONS = { train: '🚄', bus: '🚌', flight: '✈️', ferry: '⛴️' };
const MODE_COLORS = { train: '#0e7c7b', bus: '#d9952f', flight: '#ff6b5e', ferry: '#4a7fb5' };
const BADGES = { cheapest: '💶', fastest: '⚡', comfy: '🛋️' };

let ALL_CITIES = [];
const state = {
  cities: [], // ordered as entered
  locks: {},  // cityId -> slot index
  roundTrip: false,
  minNights: 2,
};
let map = null;
let mapLayer = null;
let lastResult = null;

const $ = (sel) => document.querySelector(sel);
const flag = (cc) =>
  String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
const cityById = (id) => ALL_CITIES.find((c) => c.id === id);
const fmtDur = (min) => {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
};

/* ---------- chips + autocomplete ---------- */

function lockLabel(id) {
  const pos = state.locks[id];
  if (pos === undefined) return null;
  if (pos === 0) return 'START';
  if (pos === state.cities.length - 1) return 'END';
  return `#${pos + 1}`;
}

function renderChips() {
  const box = $('#chips');
  box.innerHTML = '';
  state.cities.forEach((id) => {
    const c = cityById(id);
    const chip = document.createElement('span');
    chip.className = 'chip' + (state.locks[id] !== undefined ? ' locked' : '');
    const lock = lockLabel(id);
    chip.innerHTML = `
      <span class="flag">${flag(c.cc)}</span>${c.name}
      ${lock ? `<span class="lock-badge">${lock}</span>` : ''}
      <button class="pin" title="Lock position" data-id="${id}">📌</button>
      <button class="rm" title="Remove" data-id="${id}">✕</button>`;
    box.appendChild(chip);
  });
  $('#go').disabled = state.cities.length < 2;
  $('#city-input').placeholder = state.cities.length
    ? state.cities.length >= MAX_CITIES ? 'That’s the limit — 8 keeps the math honest' : 'Add another…'
    : 'Start typing a city… e.g. Amsterdam';
}

function addCity(id) {
  if (state.cities.length >= MAX_CITIES || state.cities.includes(id)) return;
  state.cities.push(id);
  renderChips();
  $('#city-input').value = '';
  hideSuggestions();
  $('#city-input').focus();
}

function removeCity(id) {
  state.cities = state.cities.filter((x) => x !== id);
  delete state.locks[id];
  for (const [cid, pos] of Object.entries(state.locks)) {
    if (pos >= state.cities.length) delete state.locks[cid];
  }
  renderChips();
}

function hideSuggestions() {
  $('#suggestions').hidden = true;
  $('#suggestions').innerHTML = '';
}

function showSuggestions(q) {
  const ul = $('#suggestions');
  const matches = ALL_CITIES.filter(
    (c) =>
      !state.cities.includes(c.id) &&
      (c.name.toLowerCase().startsWith(q) || c.country.toLowerCase().startsWith(q))
  ).slice(0, 8);
  if (!q || !matches.length || state.cities.length >= MAX_CITIES) return hideSuggestions();
  ul.innerHTML = matches
    .map(
      (c) =>
        `<li data-id="${c.id}"><span class="flag">${flag(c.cc)}</span> ${c.name}<span class="sub">${c.country}</span></li>`
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
  btn.classList.add('loading');
  btn.textContent = 'Crunching permutations…';
  $('#error').hidden = true;
  try {
    const res = await fetch('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cities: state.cities,
        locks: state.locks,
        roundTrip: state.roundTrip,
        minNights: state.minNights,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Planning failed');
    lastResult = data;
    renderResults(data);
  } catch (err) {
    $('#error').textContent = err.message;
    $('#error').hidden = false;
  } finally {
    btn.classList.remove('loading');
    btn.textContent = 'Route my trip';
  }
}

function renderResults(data) {
  $('#results').hidden = false;
  $('#empty-state').hidden = true;
  const n = state.cities.length;
  const perms = [1, 1, 2, 6, 24, 120, 720, 5040, 40320][n];
  $('#results-sub').textContent =
    `${n} destinations · ${perms.toLocaleString()} possible orderings evaluated per style · ` +
    (state.roundTrip ? 'round trip' : 'open-jaw') +
    ` · min ${state.minNights} night${state.minNights === 1 ? '' : 's'} per stop`;

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

  const cityRow = (id, i) => {
    const c = cityById(id);
    const lock = state.locks[id] !== undefined ? `<span class="locked-tag">📌 locked</span>` : '';
    return `<li class="tl-city"><span class="n">${i + 1}</span><span class="flag">${flag(c.cc)}</span>${c.name}${lock}</li>`;
  };
  const legRow = (hop) => {
    const pills = hop.segments
      .map(
        (s) =>
          `<span class="leg-pill mode-${s.mode}">${MODE_ICONS[s.mode]} ${s.op}</span>`
      )
      .join('');
    return `<li class="tl-leg">${pills}<span class="leg-meta">€${hop.price} · ${fmtDur(hop.durationMin)}${hop.transfers ? ` · ${hop.transfers} transfer${hop.transfers > 1 ? 's' : ''}` : ' · direct'}</span></li>`;
  };

  const seq = it.roundTrip ? [...it.order, it.order[0]] : it.order;
  let timeline = '';
  seq.forEach((id, i) => {
    timeline += cityRow(id, i);
    if (i < seq.length - 1) timeline += legRow(it.hops[i]);
  });

  card.innerHTML = `
    <div class="itin-head">
      <span class="itin-label">${BADGES[it.profile]} ${it.label}</span>
      <span class="itin-badge badge-${it.profile}">${it.label}</span>
    </div>
    <div class="itin-totals">
      <span class="tot"><b>€${it.totals.price}</b><span>total transport</span></span>
      <span class="tot"><b>${fmtDur(it.totals.durationMin)}</b><span>in transit</span></span>
      <span class="tot"><b>${it.totals.transfers}</b><span>transfers</span></span>
      <span class="tot"><b>~${it.totals.estDays}d</b><span>trip length</span></span>
    </div>
    <ul class="timeline">${timeline}</ul>
    <div class="railpass ${it.railPass.applicable && it.railPass.delta > 0 ? 'win' : ''}">
      🎫 <b>Rail pass check:</b> ${it.railPass.verdict}
    </div>
    <div class="notes">
      <h4>Why this order won</h4>
      <ul>${it.notes.map((s) => `<li>${s}</li>`).join('')}</ul>
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
  if (typeof L === 'undefined') return; // map is progressive enhancement — results still render
  if (map) {
    setTimeout(() => map.invalidateSize(), 50);
    return;
  }
  map = L.map('map', { scrollWheelZoom: false });
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
    pts.push([c.lat, c.lon]);
    L.marker([c.lat, c.lon], {
      icon: L.divIcon({
        className: 'city-marker',
        html: String(i + 1),
        iconSize: [24, 24],
      }),
    })
      .bindTooltip(`${i + 1}. ${c.name}`, { direction: 'top' })
      .addTo(mapLayer);
  });

  it.hops.forEach((hop) => {
    hop.segments.forEach((s) => {
      const a = cityById(s.from) || lastResult.cities[s.from];
      const b = cityById(s.to) || lastResult.cities[s.to];
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
        .bindTooltip(`${MODE_ICONS[s.mode]} ${s.op} · €${s.price} · ${fmtDur(s.effMin)}`, { sticky: true })
        .addTo(mapLayer);
    });
  });

  setTimeout(() => {
    map.invalidateSize();
    map.fitBounds(L.latLngBounds(pts).pad(0.25));
  }, 60);
}

/* ---------- wiring ---------- */

async function init() {
  ALL_CITIES = await (await fetch('/api/cities')).json();

  const input = $('#city-input');
  input.addEventListener('input', () => showSuggestions(input.value.trim().toLowerCase()));
  input.addEventListener('keydown', (e) => {
    const items = [...document.querySelectorAll('.suggestions li')];
    if (e.key === 'Enter' && items.length) {
      e.preventDefault();
      addCity((items.find((li) => li.classList.contains('active')) || items[0]).dataset.id);
    } else if (e.key === 'Backspace' && !input.value && state.cities.length) {
      removeCity(state.cities[state.cities.length - 1]);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const cur = items.findIndex((li) => li.classList.contains('active'));
      const next = e.key === 'ArrowDown' ? Math.min(cur + 1, items.length - 1) : Math.max(cur - 1, 0);
      items.forEach((li, i) => li.classList.toggle('active', i === next));
    } else if (e.key === 'Escape') hideSuggestions();
  });

  $('#suggestions').addEventListener('mousedown', (e) => {
    const li = e.target.closest('li');
    if (li) addCity(li.dataset.id);
  });

  $('#chips').addEventListener('click', (e) => {
    const pin = e.target.closest('.pin');
    const rm = e.target.closest('.rm');
    if (pin) openLockMenu(pin, pin.dataset.id);
    else if (rm) removeCity(rm.dataset.id);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.lock-menu') && !e.target.closest('.pin')) closeLockMenu();
    if (!e.target.closest('.autocomplete')) hideSuggestions();
  });

  document.querySelectorAll('.seg').forEach((btn) =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('.seg').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.roundTrip = btn.dataset.trip === 'round';
    })
  );

  $('#nights').addEventListener('input', (e) => {
    state.minNights = Number(e.target.value);
    $('#nights-label').textContent = `${state.minNights} night${state.minNights === 1 ? '' : 's'}`;
  });

  $('#go').addEventListener('click', planTrip);

  document.querySelectorAll('.example').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.cities = [];
      state.locks = {};
      btn.dataset.cities.split(',').forEach((id) => state.cities.push(id));
      renderChips();
      planTrip();
    })
  );

  renderChips();
}

init();
