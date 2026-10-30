/**
 * Matomo event tracking for Origo.
 *
 * Listens to existing events on the viewer/map and sends them as Matomo events.
 * Never logs search strings, coordinates or feature attributes.
 *
 * Example:
 *   viewer.addComponent(OrigoMatomo({ url: 'https://matomo.example.com/', siteId: 5 }));
 *
 * If the page already loads Matomo, that tracker is used and url and siteId are ignored.
 *
 * The plugin is called OrigoMatomo and not Matomo, since the Matomo tracker itself
 * uses the global variable window.Matomo.
 */

import Origo from 'Origo';
import { fallbackLocaleId, eventTexts } from './locales';

const OrigoMatomo = function OrigoMatomo(options = {}) {
  const {
    url,
    siteId,
    disableCookies = true,
    trackPageView = true,
    trackLayers = true,
    trackFeatureinfo = true,
    trackTools = true,
    trackZoom = true,
    trackSearch = true,
    trackPrint = true,
    trackShare = true,
    trackBookmarks = true,
    trackImport = true,
    trackMeasure = true,
    trackHelp = true,
    trackLocale = true,
    trackEstate = true,
    zoomDebounce = 2000,
    searchDebounce = 2000,
    eventLocale = fallbackLocaleId,
    debug = false
  } = options;

  let viewer;
  let map;

  // Event names follow eventLocale and not the map's language, so that the same event
  // always gets the same name in Matomo regardless of the language the user has chosen.
  const t = eventTexts(eventLocale);

  window._paq = window._paq || [];

  function track(category, action, name, value) {
    if (debug) {
      // eslint-disable-next-line no-console
      console.log('[matomo]', category, action, name, value);
    }
    // trackEvent reads the arguments by position, so name must be included when value is given
    const event = ['trackEvent', category, action];
    if (name !== undefined || value !== undefined) event.push(name === undefined ? undefined : String(name));
    if (value !== undefined) event.push(value);
    window._paq.push(event);
  }

  // Matomo replaces _paq with its own object once the tracker has loaded. Before that,
  // setSiteId in _paq shows that the page itself has configured a tracker that is loading.
  function trackerOnPage() {
    const paq = window._paq;
    if (!Array.isArray(paq)) return true;
    return paq.some((command) => Array.isArray(command) && command[0] === 'setSiteId');
  }

  function loadTracker() {
    if (!url || !siteId) return;
    // Loading the tracker again would create a new Matomo instance without a tracker
    if (trackerOnPage()) {
      // eslint-disable-next-line no-console
      if (debug) console.log('[matomo] Matomo laddas redan av sidan, url och siteId ignoreras');
      return;
    }
    const baseUrl = url.endsWith('/') ? url : `${url}/`;
    if (disableCookies) window._paq.push(['disableCookies']);
    if (trackPageView) window._paq.push(['trackPageView']);
    window._paq.push(['enableLinkTracking']);
    window._paq.push(['setTrackerUrl', `${baseUrl}matomo.php`]);
    window._paq.push(['setSiteId', String(siteId)]);
    const script = document.createElement('script');
    script.async = true;
    script.src = `${baseUrl}matomo.js`;
    document.head.appendChild(script);
  }

  // Draw tool layers are named with a uuid and the user can change the title,
  // so they all get the same name
  function layerName(layer) {
    if (layer.get('drawlayer')) return t('drawLayer');
    return layer.get('name') || layer.get('title');
  }

  // Layers with group 'none' are internal (draw, measure, highlight layers etc.) and are not tracked
  // Layers with source 'none' are created by drag & drop and get their name from the user's file.
  // Origo stores source as sourceName on the layer. These layers are not tracked; the import is
  // tracked through draganddrop:addfile instead, without the file name.
  function isUserFile(layer) {
    return layer.get('sourceName') === 'none';
  }

  function isTrackable(layer) {
    return layer.get('group') !== 'none' && !isUserFile(layer) && layerName(layer);
  }

  function hasVisibleBackground() {
    return viewer.getLayers().some((layer) => layer.get('group') === 'background' && layer.getVisible());
  }

  function watchLayer(layer) {
    if (!isTrackable(layer)) return;
    const isBackground = layer.get('group') === 'background';
    layer.on('change:visible', () => {
      const visible = layer.getVisible();
      if (isBackground) {
        // Switching background hides one and shows another; only track the one being shown.
        // The order is not fixed, so whether all backgrounds are hidden is checked after the switch.
        if (visible) {
          track(t('categoryBackground'), t('actionChange'), layerName(layer));
        } else {
          setTimeout(() => {
            if (!hasVisibleBackground()) track(t('categoryBackground'), t('actionHide'), layerName(layer));
          });
        }
      } else {
        track(t('categoryLayer'), visible ? t('actionShow') : t('actionHide'), layerName(layer));
      }
    });
    if (layer.get('type') === 'GROUP' && layer.getLayers) {
      layer.getLayers().getArray().forEach(watchLayer);
    }
  }

  function setupLayerTracking() {
    viewer.getLayers().forEach(watchLayer);
    map.getLayers().on('add', (evt) => {
      const layer = evt.element;
      if (!isTrackable(layer)) return;
      track(t('categoryLayer'), t('actionAdd'), layerName(layer));
      watchLayer(layer);
    });
  }

  // A click can hit several layers and several features per layer.
  // Collect them and send one event per layer and click. The same layers as for show/hide are tracked,
  // so that e.g. the measure tool's layer and layers from the user's files are left out.
  function setupFeatureinfoTracking() {
    const featureinfo = viewer.getFeatureinfo();
    if (!featureinfo) return;
    let pending = null;
    featureinfo.on('itemadded', (item) => {
      const layer = item.getLayer && item.getLayer();
      if (!layer || typeof layer.get !== 'function' || !isTrackable(layer)) return;
      if (!pending) {
        pending = new Set();
        setTimeout(() => {
          pending.forEach((name) => track(t('categoryFeatureinfo'), t('actionView'), name));
          pending = null;
        }, 0);
      }
      pending.add(layerName(layer));
    });
  }

  function setupToolTracking() {
    viewer.on('toggleClickInteraction', (detail) => {
      // featureinfo is the map's default click mode and not a tool the user picks
      if (detail && detail.active && detail.name && detail.name.toLowerCase() !== 'featureinfo') {
        track(t('categoryTool'), t('actionActivate'), detail.name);
      }
    });
  }

  function setupZoomTracking() {
    let lastZoom = Math.round(map.getView().getZoom());
    let timer;
    map.on('moveend', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const zoom = Math.round(map.getView().getZoom());
        if (zoom !== lastZoom) {
          lastZoom = zoom;
          track(t('categoryMap'), t('actionZoomLevel'), zoom);
        }
      }, zoomDebounce);
    });
  }

  /**
   * Searches run while the user types. Only the last result after the user has stopped
   * typing counts as a search. When a hit is selected, it is sent immediately.
   */
  function createSearchTracker(category) {
    let timer;
    let pending;
    const flush = () => {
      clearTimeout(timer);
      if (pending) {
        const { hits, types } = pending;
        track(category, hits ? t('actionSearch') : t('actionNoHits'), types, hits);
        pending = null;
      }
    };
    return {
      result(hits, types) {
        clearTimeout(timer);
        pending = { hits, types };
        timer = setTimeout(flush, searchDebounce);
      },
      flush
    };
  }

  // The events are sent by the lmsearch plugin and the legend's layer search in Origo
  function setupSearchTracking() {
    const lmsearch = createSearchTracker(t('categorySearch'));
    viewer.on('lmsearch:result', ({ hits, types = [] } = {}) => {
      lmsearch.result(hits, types.length ? types.join(', ') : undefined);
    });
    viewer.on('lmsearch:select', ({ type } = {}) => {
      lmsearch.flush();
      track(t('categorySearch'), t('actionSelect'), type);
    });
    viewer.on('lmsearch:error', () => track(t('categorySearch'), t('actionError')));

    const legend = createSearchTracker(t('categoryLegendSearch'));
    viewer.on('legend:searchresult', ({ hits } = {}) => legend.result(hits));
    viewer.on('legend:searchselect', ({ name, isGroup } = {}) => {
      legend.flush();
      track(t('categoryLegendSearch'), isGroup ? t('actionSelectGroup') : t('actionSelectLayer'), name);
    });
  }

  // The events are sent by Origo's print, share map, bookmarks and drag & drop controls
  function setupPrintTracking() {
    viewer.on('print:open', () => track(t('categoryPrint'), t('actionOpen')));
    viewer.on('print:download', ({
      format = '', size = '', orientation = '', resolution, scale
    } = {}) => {
      const settings = [format.toUpperCase(), size.toUpperCase(), orientation, resolution && `${resolution} dpi`].filter(Boolean).join(' ');
      track(t('categoryPrint'), scale ? t('actionPrintToScale') : t('actionDownload'), settings, scale || undefined);
    });
  }

  function setupShareTracking() {
    viewer.on('sharemap:open', ({ title } = {}) => track(t('categoryShare'), t('actionCreateLink'), title));
  }

  function setupBookmarkTracking() {
    viewer.on('bookmarks:select', ({ name } = {}) => track(t('categoryBookmark'), t('actionSelect'), name));
  }

  function setupImportTracking() {
    viewer.on('draganddrop:addfile', ({ format, features } = {}) => track(t('categoryImport'), t('actionAddFile'), format, features));
    viewer.on('draganddrop:coordinates', ({ show, format } = {}) => track(t('categoryImport'), show ? t('actionShowCoordinates') : t('actionHideCoordinates'), format));
  }

  const measureToolNames = {
    length: t('measureLength'),
    area: t('measureArea'),
    elevation: t('measureElevation'),
    buffer: t('measureBuffer')
  };

  // Sent by the measure tool when a measurement is finished
  function setupMeasureTracking() {
    viewer.on('measure:end', ({ tool } = {}) => track(t('categoryMeasure'), t('actionMeasure'), measureToolNames[tool] || tool));
  }

  const helpPlacementNames = {
    menu: t('helpMenu'),
    screen: t('helpScreen')
  };

  // Sent by the lmsearch plugin when a click in the map has looked up a property and when the owner report is opened.
  // The property designation is never sent.
  function setupEstateTracking() {
    viewer.on('lmsearch:estatelookup', ({ hit } = {}) => track(t('categoryEstate'), hit ? t('actionLookup') : t('actionNoHits')));
    viewer.on('lmsearch:estatereport', () => track(t('categoryEstate'), t('actionShowOwners')));
  }

  // Sent by the help plugin when the help is opened and when a section is expanded.
  // section is the section's id in the help, e.g. measure, and is the same in all languages.
  function setupHelpTracking() {
    viewer.on('help:open', ({ placement } = {}) => track(t('categoryHelp'), t('actionOpen'), helpPlacementNames[placement] || placement));
    viewer.on('help:section', ({ section } = {}) => track(t('categoryHelp'), t('actionRead'), section));
  }

  // Origo reloads the page when the language changes, so the change is only seen on the next load.
  // The language is therefore stored and compared with the previous load. The first visit does not count as a change.
  function trackLocaleChange() {
    const localization = viewer.getControlByName('localization');
    if (!localization) return;
    const localeId = localization.getCurrentLocaleId();
    try {
      const previous = localStorage.getItem('origoMatomoLocale');
      localStorage.setItem('origoMatomoLocale', localeId);
      if (previous && previous !== localeId) track(t('categoryLocale'), t('actionChange'), localeId);
    } catch (e) {
      // localStorage may be blocked; language changes are then not tracked
    }
  }

  return Origo.ui.Component({
    name: 'matomo',
    onAdd(evt) {
      viewer = evt.target;
      map = viewer.getMap();
      loadTracker();
      if (trackLayers) setupLayerTracking();
      if (trackFeatureinfo) setupFeatureinfoTracking();
      if (trackTools) setupToolTracking();
      if (trackZoom) setupZoomTracking();
      if (trackSearch) setupSearchTracking();
      if (trackPrint) setupPrintTracking();
      if (trackShare) setupShareTracking();
      if (trackBookmarks) setupBookmarkTracking();
      if (trackImport) setupImportTracking();
      if (trackMeasure) setupMeasureTracking();
      if (trackHelp) setupHelpTracking();
      if (trackLocale) trackLocaleChange();
      if (trackEstate) setupEstateTracking();
    },
    track,
    render() {
      this.dispatch('render');
    }
  });
};

export default OrigoMatomo;
