/**
 * Statistics for Origo maps from Matomo.
 *
 * Fetches the events that origo-matomo sends through the Matomo Reporting API and shows
 * them as lists per layer, tool, search etc. Category and action names are taken from
 * the same language files as the plugin, so eventLocale must be the same as in the map.
 */

import { fallbackLocaleId, eventTexts } from '../src/locales';
import {
  createApi, loadEvents, loadMaps, mapSegment
} from './matomo-api';
import * as oidc from './oidc';
import './dashboard.css';

const storageKey = 'origo-matomo-dashboard';
const listLength = 10;
const numberFormat = new Intl.NumberFormat('sv-SE');
const percentFormat = new Intl.NumberFormat('sv-SE', { style: 'percent', maximumFractionDigits: 0 });
const dayFormat = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short' });
const longDayFormat = new Intl.DateTimeFormat('sv-SE', {
  weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
});

const presets = [
  { days: 7, label: '7 dagar' },
  { days: 30, label: '30 dagar' },
  { days: 90, label: '90 dagar' },
  { days: 365, label: 'Ett år' }
];

// The lists on the page. category and action are keys in src/loc/<language>.json.
const groups = [
  {
    title: 'Lager',
    lists: [
      { title: 'Tända lager', category: 'categoryLayer', action: 'actionShow' },
      { title: 'Objektinfo per lager', category: 'categoryFeatureinfo', action: 'actionView' },
      { title: 'Bakgrundskartor', category: 'categoryBackground', action: 'actionChange' },
      { title: 'Släckta bakgrundskartor', category: 'categoryBackground', action: 'actionHide' },
      { title: 'Tillagda lager', category: 'categoryLayer', action: 'actionAdd' },
      { title: 'Lager valda i legendsök', category: 'categoryLegendSearch', action: 'actionSelectLayer' },
      { title: 'Grupper valda i legendsök', category: 'categoryLegendSearch', action: 'actionSelectGroup' }
    ]
  },
  {
    title: 'Verktyg',
    lists: [
      { title: 'Aktiverade verktyg', category: 'categoryTool', action: 'actionActivate' },
      { title: 'Mätningar', category: 'categoryMeasure', action: 'actionMeasure' },
      { title: 'Bokmärken', category: 'categoryBookmark', action: 'actionSelect' },
      { title: 'Importerade filer', category: 'categoryImport', action: 'actionAddFile' },
      { title: 'Koordinater visade för filformat', category: 'categoryImport', action: 'actionShowCoordinates' },
      { title: 'Dela karta', category: 'categoryShare', action: 'actionCreateLink' },
      { title: 'Hjälp öppnad från', category: 'categoryHelp', action: 'actionOpen' },
      { title: 'Lästa hjälpavsnitt', category: 'categoryHelp', action: 'actionRead' },
      { title: 'Byten till språk', category: 'categoryLocale', action: 'actionChange' }
    ]
  },
  {
    title: 'Sök',
    lists: [
      { title: 'Träfftyper i sökningar', category: 'categorySearch', action: 'actionSearch' },
      { title: 'Valda träfftyper', category: 'categorySearch', action: 'actionSelect' }
    ]
  },
  {
    title: 'Utskrift och karta',
    lists: [
      { title: 'Nedladdade utskrifter', category: 'categoryPrint', action: 'actionDownload' },
      { title: 'Utskrifter i skala', category: 'categoryPrint', action: 'actionPrintToScale' },
      {
        title: 'Zoomnivåer', category: 'categoryMap', action: 'actionZoomLevel', sortByLabel: true, showAll: true
      }
    ]
  }
];

const $ = (selector) => document.querySelector(selector);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value === undefined || value === false) return;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  });
  node.append(...children.flat().filter((child) => child !== undefined && child !== null && child !== false));
  return node;
}

const svgNs = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}) {
  const node = document.createElementNS(svgNs, tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}

// localStorage may be missing or blocked; the page must still work
function readStored() {
  try {
    return JSON.parse(localStorage.getItem(storageKey) || sessionStorage.getItem(storageKey) || '{}');
  } catch (err) {
    return {};
  }
}

function writeStored(value, remember) {
  try {
    localStorage.removeItem(storageKey);
    sessionStorage.removeItem(storageKey);
    (remember ? localStorage : sessionStorage).setItem(storageKey, JSON.stringify(value));
  } catch (err) {
    // The settings then only last until the page is reloaded
  }
}

function isoDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return isoDate(date);
}

function parseDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function readHash() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  return {
    site: params.get('site') || undefined,
    map: params.get('map') || '',
    from: params.get('from') || undefined,
    to: params.get('to') || undefined
  };
}

function writeHash({
  site, map, from, to
}) {
  const params = new URLSearchParams({ site, from, to });
  if (map) params.set('map', map);
  window.history.replaceState(null, '', `#${params}`);
}

function niceMax(value) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * magnitude >= value);
  return step * magnitude;
}

function compact(value) {
  return new Intl.NumberFormat('sv-SE', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

const state = {
  config: {},
  settings: readStored()
};

let t = eventTexts(fallbackLocaleId);

// With proxy, requests go through origo-server, which adds a shared token
function api() {
  if (state.config.proxy) return createApi({ url: 'api/', proxy: true, auth: oidc.enabled() ? oidc : null });
  return createApi({ url: state.settings.url || state.config.url, token: state.settings.token });
}

function showError(message) {
  $('#status').replaceChildren(el('div', { class: 'error', role: 'alert' }, message));
}

function showStatus(message) {
  $('#status').replaceChildren(message ? el('div', { class: 'loading' }, message) : '');
}

/* ---------- Settings ---------- */

function openSettings() {
  const dialog = $('#settings');
  const form = dialog.querySelector('form');
  form.url.value = state.settings.url || state.config.url || '';
  form.token.value = state.settings.token || '';
  form.remember.checked = Boolean(state.settings.remember);
  dialog.showModal();
}

function setupSettings() {
  const dialog = $('#settings');
  dialog.querySelector('form').addEventListener('submit', (evt) => {
    const form = evt.target;
    if (evt.submitter && evt.submitter.value === 'cancel') return;
    state.settings = {
      url: form.url.value.trim(),
      token: form.token.value.trim(),
      remember: form.remember.checked
    };
    writeStored(state.settings, state.settings.remember);
    // eslint-disable-next-line no-use-before-define
    loadSites();
  });
  $('#open-settings').addEventListener('click', openSettings);
}

/* ---------- Period and map ---------- */

function renderPeriod() {
  const container = $('#presets');
  const today = isoDate(new Date());
  container.replaceChildren(...presets.map(({ days, label }) => {
    const from = daysAgo(days - 1);
    const active = state.from === from && state.to === today;
    return el('button', {
      type: 'button',
      class: active ? 'preset active' : 'preset',
      'aria-pressed': String(active),
      onclick: () => {
        state.from = from;
        state.to = today;
        // eslint-disable-next-line no-use-before-define
        refresh();
      }
    }, label);
  }));
  $('#from').value = state.from;
  $('#to').value = state.to;
}

function setupControls() {
  const onDateChange = () => {
    const from = $('#from').value;
    const to = $('#to').value;
    if (!from || !to || from > to) return;
    state.from = from;
    state.to = to;
    // eslint-disable-next-line no-use-before-define
    refresh();
  };
  $('#from').addEventListener('change', onDateChange);
  $('#to').addEventListener('change', onDateChange);
  $('#site').addEventListener('change', (evt) => {
    state.site = evt.target.value;
    state.map = '';
    // eslint-disable-next-line no-use-before-define
    loadMapList().then(refresh);
  });
  $('#map').addEventListener('change', (evt) => {
    state.map = evt.target.value;
    // eslint-disable-next-line no-use-before-define
    refresh();
  });
}

// The maps on the website are given in config.json (maps) or derived from the page views of the past year
async function loadMapList() {
  let maps = state.config.maps || [];
  if (!state.config.maps) {
    try {
      maps = await loadMaps(api(), { idSite: state.site, period: 'range', date: `${daysAgo(364)},${isoDate(new Date())}` });
    } catch (err) {
      // Without a list, all maps can still be viewed together
      maps = [];
    }
  }
  // A map from the URL that is not in the list is kept, so that links work
  if (state.map && !maps.some((map) => map.url === state.map)) {
    maps = [...maps, { url: state.map, title: state.map.replace(/^https?:\/\//, '') }];
  }
  $('#map').replaceChildren(
    el('option', { value: '' }, 'Alla kartor'),
    ...maps.map((map) => el('option', { value: map.url, selected: map.url === state.map }, map.title || map.url))
  );
  $('#map').disabled = maps.length === 0;
}

async function loadSites() {
  if (!state.config.proxy && !(state.settings.url || state.config.url)) {
    showError('Ange adressen till Matomo under Inställningar.');
    openSettings();
    return;
  }
  showStatus('Hämtar kartor …');
  let sites;
  try {
    sites = await api().call('SitesManager.getSitesWithAtLeastViewAccess');
  } catch (err) {
    showError(state.config.proxy ? err.message : `${err.message} Om Matomo inte tillåter anonym läsning behövs en token under Inställningar.`);
    return;
  }
  if (!sites.length) {
    showError(state.config.proxy
      ? 'Statistikserverns token har inte läsbehörighet till någon karta i Matomo.'
      : 'Det finns inga kartor som du har läsbehörighet till. Ange en token under Inställningar.');
    return;
  }
  const ids = sites.map((site) => String(site.idsite));
  if (!ids.includes(state.site)) {
    state.site = ids.includes(String(state.config.siteId)) ? String(state.config.siteId) : ids[0];
  }
  $('#site').replaceChildren(...sites.map((site) => el('option', {
    value: site.idsite, selected: String(site.idsite) === state.site
  }, site.name)));
  await loadMapList();
  // eslint-disable-next-line no-use-before-define
  refresh();
}

/* ---------- Charts and lists ---------- */

function statTile(label, value, note) {
  return el(
    'div',
    { class: 'tile' },
    el('div', { class: 'tile-label' }, label),
    el('div', { class: 'tile-value' }, value),
    note ? el('div', { class: 'tile-note' }, note) : null
  );
}

function renderTiles(events, visits) {
  const searches = events.count(t('categorySearch'), t('actionSearch'));
  const noHits = events.count(t('categorySearch'), t('actionNoHits'));
  const prints = events.count(t('categoryPrint'), t('actionDownload')) + events.count(t('categoryPrint'), t('actionPrintToScale'));
  const allSearches = searches + noHits;
  $('#tiles').replaceChildren(
    statTile('Besök', numberFormat.format(visits.nb_visits || 0)),
    statTile('Händelser', numberFormat.format(events.total)),
    statTile('Tända lager', numberFormat.format(events.count(t('categoryLayer'), t('actionShow')))),
    statTile('Objektinfo', numberFormat.format(events.count(t('categoryFeatureinfo'), t('actionView')))),
    statTile(
      'Sökningar',
      numberFormat.format(allSearches),
      allSearches ? `${percentFormat.format(noHits / allSearches)} utan träff` : undefined
    ),
    statTile('Utskrifter', numberFormat.format(prints))
  );
}

// Line chart of events per day with crosshair and tooltip
function renderTrend(perDay) {
  const container = $('#trend');
  const days = Object.keys(perDay).sort();
  const values = days.map((day) => perDay[day]);
  if (!days.length) {
    container.replaceChildren(el('p', { class: 'empty' }, 'Inga händelser under perioden.'));
    return;
  }

  const width = 900;
  const height = 220;
  const pad = {
    top: 12, right: 12, bottom: 28, left: 44
  };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(...values));
  const x = (i) => pad.left + (days.length === 1 ? innerW / 2 : (i / (days.length - 1)) * innerW);
  const y = (v) => pad.top + innerH - (v / max) * innerH;

  const chart = svg('svg', {
    viewBox: `0 0 ${width} ${height}`, class: 'trend-svg', role: 'img', 'aria-label': 'Händelser per dag'
  });

  [0, 0.25, 0.5, 0.75, 1].forEach((f) => {
    const v = max * f;
    chart.append(svg('line', {
      x1: pad.left, x2: width - pad.right, y1: y(v), y2: y(v), class: f === 0 ? 'axis' : 'grid'
    }));
    const label = svg('text', {
      x: pad.left - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'tick'
    });
    label.textContent = compact(v);
    chart.append(label);
  });

  const tickEvery = Math.max(1, Math.ceil(days.length / 8));
  days.forEach((day, i) => {
    if (i % tickEvery !== 0 && i !== days.length - 1) return;
    if (i !== days.length - 1 && days.length - 1 - i < tickEvery / 2) return;
    const label = svg('text', {
      x: x(i), y: height - 8, 'text-anchor': 'middle', class: 'tick'
    });
    label.textContent = dayFormat.format(parseDate(day));
    chart.append(label);
  });

  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  chart.append(svg('polygon', {
    points: `${x(0)},${y(0)} ${points} ${x(days.length - 1)},${y(0)}`, class: 'area'
  }));
  chart.append(svg('polyline', { points, class: 'line' }));
  if (days.length === 1) {
    chart.append(svg('circle', {
      cx: x(0), cy: y(values[0]), r: 4, class: 'dot'
    }));
  }

  const crosshair = svg('line', {
    y1: pad.top, y2: pad.top + innerH, class: 'crosshair', visibility: 'hidden'
  });
  const marker = svg('circle', { r: 4, class: 'dot', visibility: 'hidden' });
  chart.append(crosshair, marker);

  const tooltip = el('div', { class: 'tooltip', hidden: true });
  const hit = svg('rect', {
    x: pad.left, y: pad.top, width: innerW, height: innerH, class: 'hit'
  });
  chart.append(hit);

  const hide = () => {
    crosshair.setAttribute('visibility', 'hidden');
    marker.setAttribute('visibility', 'hidden');
    tooltip.hidden = true;
  };
  hit.addEventListener('pointermove', (evt) => {
    const box = chart.getBoundingClientRect();
    const px = ((evt.clientX - box.left) / box.width) * width;
    const i = days.length === 1 ? 0 : Math.round(((px - pad.left) / innerW) * (days.length - 1));
    const index = Math.min(days.length - 1, Math.max(0, i));
    crosshair.setAttribute('x1', x(index));
    crosshair.setAttribute('x2', x(index));
    crosshair.setAttribute('visibility', 'visible');
    marker.setAttribute('cx', x(index));
    marker.setAttribute('cy', y(values[index]));
    marker.setAttribute('visibility', 'visible');
    tooltip.replaceChildren(
      el('div', { class: 'tooltip-label' }, longDayFormat.format(parseDate(days[index]))),
      el('div', { class: 'tooltip-value' }, `${numberFormat.format(values[index])} händelser`)
    );
    tooltip.hidden = false;
    const left = (x(index) / width) * box.width;
    tooltip.style.left = `${Math.min(Math.max(left, 70), box.width - 70)}px`;
    tooltip.style.top = `${(y(values[index]) / height) * box.height}px`;
  });
  hit.addEventListener('pointerleave', hide);

  container.replaceChildren(el('div', { class: 'trend-wrap' }, chart, tooltip));
}

// Draw tool layers used to be named by their uuid in the events. They are merged with the current name
// into one row. Visits are summed and may then be counted more than once.
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const countHelp = 'Hur många gånger händelsen inträffade under perioden';
const visitsHelp = 'Antal besök där händelsen inträffade minst en gång. Ett besök är en användares '
  + 'session i kartan och avslutas efter 30 minuter utan aktivitet.';

function mergeDrawLayers(rows) {
  const drawLayer = t('drawLayer');
  const merged = rows.filter((row) => row.label === drawLayer || uuidPattern.test(row.label));
  if (!merged.length) return rows;
  return [
    ...rows.filter((row) => !merged.includes(row)),
    merged.reduce((sum, row) => ({
      ...sum, nb_events: sum.nb_events + row.nb_events, nb_visits: sum.nb_visits + row.nb_visits
    }), { label: drawLayer, nb_events: 0, nb_visits: 0 })
  ];
}

function barList(rows, { sortByLabel, showAll }) {
  const sorted = [...rows].sort(sortByLabel
    ? (a, b) => Number(a.label) - Number(b.label) || String(a.label).localeCompare(String(b.label), 'sv')
    : (a, b) => b.nb_events - a.nb_events);
  const max = Math.max(...sorted.map((row) => row.nb_events));
  const total = sorted.reduce((sum, row) => sum + row.nb_events, 0);

  const item = (row) => el(
    'li',
    { title: `${row.label}: ${numberFormat.format(row.nb_events)} gånger under ${numberFormat.format(row.nb_visits)} besök` },
    el(
      'div',
      { class: 'bar-row' },
      el('span', { class: 'bar-label' }, String(row.label)),
      el('span', { class: 'bar-value' }, numberFormat.format(row.nb_events)),
      el('span', { class: 'bar-visits' }, numberFormat.format(row.nb_visits))
    ),
    el('div', { class: 'bar-track' }, el('div', { class: 'bar', style: `width: ${(row.nb_events / max) * 100}%` }))
  );

  const list = el('ol', { class: 'bars' }, sorted.slice(0, showAll ? undefined : listLength).map(item));
  const head = el(
    'div',
    { class: 'bar-head' },
    el('span', {}, ''),
    el('span', { class: 'help', title: countHelp }, 'Antal'),
    el('span', { class: 'help', title: visitsHelp }, 'Besök')
  );
  const footer = [];
  if (!showAll && sorted.length > listLength) {
    const button = el('button', {
      type: 'button',
      class: 'link',
      onclick: () => {
        const expanded = button.getAttribute('aria-expanded') === 'true';
        list.replaceChildren(...sorted.slice(0, expanded ? listLength : undefined).map(item));
        button.setAttribute('aria-expanded', String(!expanded));
        button.textContent = expanded ? `Visa alla ${sorted.length}` : 'Visa färre';
      },
      'aria-expanded': 'false'
    }, `Visa alla ${sorted.length}`);
    footer.push(button);
  }
  footer.push(el('span', { class: 'muted' }, `Totalt ${numberFormat.format(total)}`));
  return [head, list, el('div', { class: 'card-foot' }, footer)];
}

async function renderGroups(events) {
  const container = $('#groups');
  const sections = await Promise.all(groups.map(async (group) => {
    const cards = await Promise.all(group.lists.map(async (list) => {
      const category = t(list.category);
      const action = t(list.action);
      let rows;
      try {
        rows = mergeDrawLayers(await events.names(category, action));
      } catch (err) {
        return el('section', { class: 'card' }, el('h3', {}, list.title), el('p', { class: 'error' }, err.message));
      }
      return el(
        'section',
        { class: 'card' },
        el('h3', {}, list.title),
        el('p', { class: 'card-sub' }, `${category} / ${action}`),
        rows.length ? barList(rows, list) : el('p', { class: 'empty' }, 'Inga händelser under perioden.')
      );
    }));
    return el('section', { class: 'group' }, el('h2', {}, group.title), el('div', { class: 'cards' }, cards));
  }));
  container.replaceChildren(...sections);
}

// All categories and actions in Matomo, including those without their own list above
function renderCategories(events) {
  const rows = [...events.categories].sort((a, b) => b.nb_events - a.nb_events);
  $('#categories').replaceChildren(rows.length ? el(
    'table',
    { class: 'table' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Kategori'), el('th', {}, 'Händelse'), el('th', { class: 'num' }, el('span', { class: 'help', title: countHelp }, 'Antal')), el('th', { class: 'num' }, el('span', { class: 'help', title: visitsHelp }, 'Besök')))),
    el('tbody', {}, rows.flatMap((category) => [...(category.subtable || [])]
      .sort((a, b) => b.nb_events - a.nb_events)
      .map((action, i) => el(
        'tr',
        { class: i === 0 ? 'first' : undefined },
        el('td', {}, i === 0 ? category.label : ''),
        el('td', {}, action.label),
        el('td', { class: 'num' }, numberFormat.format(action.nb_events)),
        el('td', { class: 'num' }, numberFormat.format(action.nb_visits))
      ))))
  ) : el('p', { class: 'empty' }, 'Inga händelser under perioden.'));
}

let refreshId = 0;

async function refresh() {
  if (!state.site) return;
  writeHash(state);
  renderPeriod();
  const id = refreshId + 1;
  refreshId = id;
  const date = `${state.from},${state.to}`;
  const segment = state.map ? mapSegment(state.map) : undefined;
  const params = {
    idSite: state.site, period: 'range', date, ...(segment && { segment })
  };
  const matomo = api();
  showStatus('Hämtar statistik …');
  document.body.classList.add('busy');
  try {
    const [events, visits, eventsPerDay] = await Promise.all([
      loadEvents(matomo, params),
      matomo.call('VisitsSummary.get', params),
      matomo.call('Events.getCategory', { ...params, period: 'day' })
    ]);
    if (id !== refreshId) return;
    const perDay = Object.fromEntries(Object.entries(eventsPerDay)
      .map(([day, rows]) => [day, rows.reduce((sum, row) => sum + row.nb_events, 0)]));
    renderTiles(events, Array.isArray(visits) ? {} : visits);
    renderTrend(perDay);
    renderCategories(events);
    await renderGroups(events);
    if (id === refreshId) showStatus();
  } catch (err) {
    if (id === refreshId) showError(err.message);
  } finally {
    if (id === refreshId) document.body.classList.remove('busy');
  }
}

async function init() {
  try {
    const response = await fetch('config.json', { cache: 'no-cache' });
    if (response.ok) state.config = await response.json();
  } catch (err) {
    // Without config.json, the URL is entered under Settings
  }
  t = eventTexts(state.config.eventLocale || fallbackLocaleId);
  if (state.config.title) {
    $('#title').textContent = state.config.title;
    document.title = state.config.title;
  }
  $('#login').addEventListener('click', () => oidc.login());
  $('#logout').addEventListener('click', () => oidc.logout());
  if (state.config.proxy) $('#open-settings').hidden = true;
  else setupSettings();

  // If origo-server requires login, the user is sent to the login when there is no session
  let session;
  try {
    session = await oidc.init(state.config.proxy ? state.config.auth : null);
  } catch (err) {
    showError(err.message);
    $('#login').hidden = false;
    return;
  }

  // After login, the URL with map and period has been restored
  Object.assign(state, readHash());
  if (!state.from || !state.to) {
    state.from = daysAgo(29);
    state.to = isoDate(new Date());
  }
  setupControls();
  renderPeriod();

  if (session.status === 'signed-out') {
    showStatus('Du är utloggad.');
    $('#login').hidden = false;
    return;
  }
  if (session.status === 'signed-in') {
    $('#user').textContent = session.user.name;
    $('#logout').hidden = false;
  }
  loadSites();
}

init();
