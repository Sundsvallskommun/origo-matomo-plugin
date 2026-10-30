/**
 * Calls to the Matomo Reporting API.
 *
 * Requests are sent as POST so that token_auth does not end up in the URL or in server logs.
 * A form POST is a "simple request", so the browser does no preflight, but Matomo must still
 * allow the page's origin in cors_domains[] if the page is on another domain.
 *
 * With proxy, requests go to origo-server, which forwards them to Matomo with a shared token.
 * If origo-server requires login, the user's access token from oidc.js is sent with every request.
 */

export class MatomoError extends Error {}

// Matomo sometimes sends numbers as text, e.g. "nb_events": "12" for today's report that is not
// fully archived. Sums then become concatenated strings ("0" + "12" + "7" = "0127").
// All metrics (nb_*, sum_* etc.) are therefore converted to numbers.
const metricPattern = /^(nb_|sum_|max_|min_|avg_)/;

function numbers(data) {
  if (Array.isArray(data)) return data.map(numbers);
  if (!data || typeof data !== 'object') return data;
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [
    key,
    metricPattern.test(key) && typeof value === 'string' && value !== '' && !Number.isNaN(Number(value))
      ? Number(value)
      : numbers(value)
  ]));
}

// auth = { getAccessToken, renewAfterUnauthorized } from oidc.js when origo-server requires login
export function createApi({
  url, token, proxy = false, auth = null
}) {
  const baseUrl = url.endsWith('/') ? url : `${url}/`;

  async function send(body, accessToken) {
    const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
    try {
      return await fetch(`${baseUrl}index.php`, { method: 'POST', body, headers });
    } catch (err) {
      if (proxy) throw new MatomoError('Kunde inte nå statistikservern.');
      throw new MatomoError(`Kunde inte nå Matomo på ${baseUrl}. Kontrollera adressen och att sidans domän finns i cors_domains[] i Matomos config.ini.php.`);
    }
  }

  async function call(method, params = {}) {
    const body = new URLSearchParams({
      module: 'API', method, format: 'JSON', filter_limit: '-1', ...params
    });
    if (token) body.set('token_auth', token);
    let response = await send(body, auth && await auth.getAccessToken());
    // The token may have expired or been revoked; renew it and try once more
    if (response.status === 401 && auth) {
      const renewed = await auth.renewAfterUnauthorized();
      if (renewed) response = await send(body, renewed);
    }
    const data = await response.json().catch(() => undefined);
    if (data && data.result === 'error') throw new MatomoError(data.message);
    if (!response.ok || data === undefined) throw new MatomoError(`Matomo svarade ${response.status} ${response.statusText}`);
    return numbers(data);
  }

  return { call };
}

/**
 * Segment for a map, i.e. page views and events whose URL starts with the map's URL.
 * The URL is given without a trailing slash, so that /map, /map/ and /map?… are all included
 * but not /map2. , is OR in Matomo and binds tighter than ;.
 */
export function mapSegment(url) {
  const value = encodeURIComponent(url);
  return `pageUrl==${value},pageUrl=^${value}%2F,pageUrl=^${value}%3F`;
}

// The map's URL from a page URL: without query, fragment, file name (index.html) and trailing slash
export function mapUrl(pageUrl) {
  let url;
  try {
    url = new URL(pageUrl);
  } catch {
    return null;
  }
  if (!url.protocol.startsWith('http')) return null;
  return `${url.origin}${url.pathname.replace(/\/[^/]*\.[^/]*$/, '').replace(/\/+$/, '')}`;
}

/**
 * The maps on a website in Matomo, based on the pages that have been viewed. Several maps can share
 * a website, e.g. karta.sundsvall.se/sundsvall and karta.sundsvall.se/bxkarta.
 * Returns [{ url, title, visits }] sorted by number of visits.
 */
export async function loadMaps(api, params) {
  const pages = await api.call('Actions.getPageUrls', { ...params, flat: '1' });
  const maps = new Map();
  pages.forEach((page) => {
    const url = page.url && mapUrl(page.url);
    if (!url) return;
    const map = maps.get(url) || { url, title: url.replace(/^https?:\/\//, ''), visits: 0 };
    map.visits += page.nb_visits || 0;
    maps.set(url, map);
  });
  return [...maps.values()].sort((x, y) => y.visits - x.visits);
}

/**
 * Fetches the events for a period and gives the names for a combination of category and action.
 *
 * Matomo's event reports only have two levels (category -> action, category -> name,
 * action -> name), so the names for e.g. Layer / show cannot be fetched directly. They are taken from
 * - category -> name if the category has only one action,
 * - otherwise action -> name, limited to the names that exist in the category.
 *
 * Action -> name counts all categories that have the action (e.g. open in both Help and
 * Print). A name that does not exist in any of the other categories can only come from this
 * one, so the count is exact. If the name also exists in another of them it cannot be split,
 * and the smaller of the two counts is shown, which is the highest possible.
 *
 * Segments on category and action cannot be used, since Matomo then selects the visits
 * that have such an event and shows all events in those visits.
 */
export async function loadEvents(api, params) {
  const expanded = { ...params, expanded: '1' };
  const [categoryActions, categoryNames, actionNames] = await Promise.all([
    api.call('Events.getCategory', { ...expanded, secondaryDimension: 'eventAction' }),
    api.call('Events.getCategory', { ...expanded, secondaryDimension: 'eventName' }),
    api.call('Events.getAction', { ...expanded, secondaryDimension: 'eventName' })
  ]);

  const byLabel = (rows) => new Map(rows.map((row) => [row.label, row.subtable || []]));
  const actionsByCategory = byLabel(categoryActions);
  const namesByCategory = byLabel(categoryNames);
  const namesByAction = byLabel(actionNames);

  const categoriesWithAction = (action) => categoryActions
    .filter((row) => (row.subtable || []).some((sub) => sub.label === action));

  function actions(category) {
    return actionsByCategory.get(category) || [];
  }

  const labels = (rows) => new Set(rows.map((row) => row.label));

  async function names(category, action) {
    const actionsInCategory = actions(category);
    if (!actionsInCategory.some((row) => row.label === action)) return [];
    const inCategory = namesByCategory.get(category) || [];
    if (actionsInCategory.length === 1) return inCategory;
    const byName = new Map(inCategory.map((row) => [row.label, row]));
    const inOtherCategories = labels(categoriesWithAction(action)
      .filter((row) => row.label !== category)
      .flatMap((row) => namesByCategory.get(row.label) || []));
    return (namesByAction.get(action) || [])
      .filter((row) => byName.has(row.label))
      .map((row) => {
        if (!inOtherCategories.has(row.label)) return row;
        const other = byName.get(row.label);
        return {
          ...row,
          nb_events: Math.min(row.nb_events, other.nb_events),
          nb_visits: Math.min(row.nb_visits, other.nb_visits)
        };
      });
  }

  function count(category, action) {
    const row = actions(category).find((r) => r.label === action);
    return row ? row.nb_events : 0;
  }

  const total = categoryActions.reduce((sum, row) => sum + row.nb_events, 0);

  return {
    categories: categoryActions, actions, names, count, total
  };
}
