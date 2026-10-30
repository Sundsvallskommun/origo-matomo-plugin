# Matomo plugin

Plugin for [Origo](https://github.com/origo-map/origo) that sends usage statistics to [Matomo](https://matomo.org/) as events.

The plugin has no user interface. It listens to events that already exist in Origo (layers, feature info, tools, zoom) and sends them to Matomo with `trackEvent`. Origo needs some new events for everything to be tracked.

The plugin never logs search strings, coordinates or feature attributes. By default Matomo runs without cookies (`disableCookies`).

## What is tracked

Event names are sent in Swedish by default (`eventLocale: 'sv-SE'`). The table shows the English names with the Swedish names in parentheses. With `eventLocale: 'en-US'` the English names are sent, see [Language](#language).

| Category                  | Action                                                                            | Name                                                                                                            | Option             |
| ------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------ |
| Layer (Lager)             | `show` / `hide` / `added` (`tänd` / `släck` / `lagt till`)                        | the layer's `name`                                                                                              | `trackLayers`      |
| Background (Bakgrund)     | `change` (`byt`)                                                                  | the background layer's `name`                                                                                   | `trackLayers`      |
| Background (Bakgrund)     | `hide` (`släck`)                                                                  | `name` of the background that was hidden, when no background is visible anymore                                 | `trackLayers`      |
| Feature info (Objektinfo) | `view` (`visa`)                                                                   | the layer's `name`                                                                                              | `trackFeatureinfo` |
| Tool (Verktyg)            | `activate` (`aktivera`)                                                           | e.g. `measure`, `draw`                                                                                          | `trackTools`       |
| Map (Karta)               | `zoom level` (`zoomnivå`)                                                         | rounded zoom level                                                                                              | `trackZoom`        |
| Search (Sök)              | `search` / `no hits` (`sökning` / `ingen träff`)                                  | hit types, e.g. `Fastighet, Adress`; value = number of hits                                                     | `trackSearch`      |
| Search (Sök)              | `select` / `error` (`välj` / `fel`)                                               | type of the selected hit                                                                                        | `trackSearch`      |
| Legend search (Legendsök) | `search` / `no hits` (`sökning` / `ingen träff`)                                  | –; value = number of hits                                                                                       | `trackSearch`      |
| Legend search (Legendsök) | `select layer` / `select group` (`välj lager` / `välj grupp`)                     | the layer's or group's `name`                                                                                   | `trackSearch`      |
| Print (Utskrift)          | `open` (`öppna`)                                                                  | –                                                                                                               | `trackPrint`       |
| Print (Utskrift)          | `download` / `print to scale` (`ladda ner` / `skriv ut i skala`)                  | format, size, orientation and resolution, e.g. `PDF A4 landscape 150 dpi`; value = scale when printing to scale | `trackPrint`       |
| Share map (Dela karta)    | `create link` (`skapa länk`)                                                      | the control's `title`, e.g. `API länk`                                                                          | `trackShare`       |
| Bookmark (Bokmärke)       | `select` (`välj`)                                                                 | the bookmark's name                                                                                             | `trackBookmarks`   |
| Import (Import)           | `add file` (`lägg till fil`)                                                      | file format, e.g. `kml`; value = number of features                                                            | `trackImport`      |
| Import (Import)           | `show coordinates` / `hide coordinates` (`visa koordinater` / `dölj koordinater`) | file format; the coordinates are turned on or off in the layer's menu                                           | `trackImport`      |
| Measure (Mätning)         | `measure` (`mät`)                                                                 | `length`, `area`, `elevation` or `buffer` (`längd`, `area`, `höjd`, `buffert`)                                   | `trackMeasure`     |
| Help (Hjälp)              | `open` (`öppna`)                                                                  | `map menu` or `toolbar` (`kartmeny`, `verktygsfält`)                                                            | `trackHelp`        |
| Help (Hjälp)              | `read section` (`läs avsnitt`)                                                    | the section's id in the help, e.g. `measure`                                                                    | `trackHelp`        |
| Language (Språk)          | `change` (`byt`)                                                                  | the id of the new language, e.g. `en-US`                                                                        | `trackLocale`      |
| Estate (Fastighet)        | `look up` / `no hits` (`slå upp` / `ingen träff`)                                 | –; a click in the map with the property lookup in lmsearch turned on                                            | `trackEstate`      |
| Estate (Fastighet)        | `show owners` (`visa ägare`)                                                      | –; the owner report is opened                                                                                   | `trackEstate`      |

- Layers with `group: 'none'` are internal (draw, measure and highlight layers) and are not tracked.
- Layers from drag & drop are not tracked as layers, since they get their name from the user's file. The import is tracked under the Import category instead, without the file name.
- When the background map is switched, only the background that is shown is counted.
- Feature info sends one event per layer and click, even if several features are hit. The same layers as above are tracked, so internal layers and layers from drag & drop are left out.
- The zoom level is sent only when the map has been still for `zoomDebounce` ms and the level has changed.
- Searches run while the user types. Only the last result is counted, when the user has stopped typing for `searchDebounce` ms or selects a hit. The search string is never sent.

### Events from searches

Search tracking relies on events dispatched on the viewer. A search that does not dispatch them is not tracked.

| Event                   | Data                | Dispatched by                                                     |
| ----------------------- | ------------------- | ----------------------------------------------------------------- |
| `lmsearch:result`       | `{ hits, types }`   | [lmsearch-plugin](https://github.com/origo-map/lmsearch-plugin)   |
| `lmsearch:select`       | `{ type }`          | lmsearch-plugin                                                   |
| `lmsearch:error`        | –                   | lmsearch-plugin                                                   |
| `lmsearch:estatelookup` | `{ hit }`           | lmsearch-plugin, when a click in the map has looked up a property |
| `lmsearch:estatereport` | –                   | lmsearch-plugin, when the owner report is opened                  |
| `legend:searchresult`   | `{ hits }`          | the legend's layer search (`searchLayersControl`) in Origo        |
| `legend:searchselect`   | `{ name, isGroup }` | the legend's layer search in Origo                                |

### Events from tools in Origo

| Event                     | Data                                               | Dispatched by                                                                                                    |
| ------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `print:open`              | –                                                  | print (`print`)                                                                                                  |
| `print:download`          | `{ format, size, orientation, resolution, scale }` | print; `scale` only when printing to scale                                                                       |
| `sharemap:open`           | `{ title }`                                        | share map (`sharemap`)                                                                                           |
| `bookmarks:select`        | `{ name }`                                         | bookmarks (`bookmarks`)                                                                                          |
| `draganddrop:addfile`     | `{ format, features }`                             | drag & drop and open file (`draganddrop`)                                                                        |
| `draganddrop:coordinates` | `{ show, format }`                                 | the coordinates are turned on or off in the layer's menu (`draganddrop`)                                         |
| `measure:end`             | `{ tool }`                                         | the measure tool (`measure`) when a measurement is finished; `tool` is `length`, `area`, `elevation` or `buffer` |
| `help:open`               | `{ placement }`                                    | the help plugin when the help is opened; `placement` is `menu` or `screen`                                       |
| `help:section`            | `{ section }`                                      | the help plugin when a section in the help is expanded; `section` is the section's id, e.g. `measure`            |

File names, the map's title and description when printing, and the link itself when sharing are never sent.

## Options

| Option             | Default   | Description                                                                                                                                       |
| ------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`              | –         | URL of the Matomo server, e.g. `https://matomo.example.com/`. If omitted, no tracker is loaded. Ignored if the page already loads Matomo.          |
| `siteId`           | –         | Matomo site id.                                                                                                                                   |
| `disableCookies`   | `true`    | Run Matomo without cookies.                                                                                                                       |
| `trackPageView`    | `true`    | Send a page view when the tracker is loaded.                                                                                                      |
| `trackLayers`      | `true`    | Track showing/hiding layers and switching background.                                                                                             |
| `trackFeatureinfo` | `true`    | Track clicks that show feature info.                                                                                                              |
| `trackTools`       | `true`    | Track activation of tools (measure, draw, multiselect etc.).                                                                                      |
| `trackZoom`        | `true`    | Track zoom level.                                                                                                                                 |
| `trackSearch`      | `true`    | Track searches in lmsearch and the legend's layer search.                                                                                         |
| `trackPrint`       | `true`    | Track printing.                                                                                                                                   |
| `trackShare`       | `true`    | Track share map.                                                                                                                                  |
| `trackBookmarks`   | `true`    | Track selected bookmarks.                                                                                                                         |
| `trackImport`      | `true`    | Track files added with drag & drop or open file, and showing coordinates.                                                                         |
| `trackMeasure`     | `true`    | Track completed measurements per measure type.                                                                                                    |
| `trackHelp`        | `true`    | Track when the help is opened and which sections are read (help plugin).                                                                          |
| `trackLocale`      | `true`    | Track language changes. The language is stored in `localStorage` (`origoMatomoLocale`) and the change is sent on the first load after the change. |
| `trackEstate`      | `true`    | Track property lookups and owner reports in lmsearch.                                                                                             |
| `zoomDebounce`     | `2000`    | How long the map must be still (ms) before the zoom level is sent.                                                                                |
| `searchDebounce`   | `2000`    | How long the user must have stopped typing (ms) before a search is counted.                                                                       |
| `eventLocale`      | `'sv-SE'` | Language of the event names in Matomo: `'sv-SE'` or `'en-US'`, see [Language](#language).                                                         |
| `debug`            | `false`   | Write all events to the console as `[matomo] …`.                                                                                                  |

## Language

The event categories and names, e.g. `Layer / show` or `Measure / measure / elevation`, are available in Swedish and English. The texts are in `src/loc/sv_SE.json` and `src/loc/en_US.json`, in the same way as in report-plugin. A new language is added by adding a file to `src/loc/`.

The language is chosen with `eventLocale` and does not follow the map's language. Otherwise the same event would end up under different names in Matomo depending on the language the user has chosen, e.g. both `Lager` and `Layer`. Swedish is the default. If a language is given that does not exist, the same language with another region is used (e.g. `en-GB` → `en-US`), otherwise Swedish.

Do not change `eventLocale` for a map that already has statistics in Matomo, since the old and new events will then have different names.

Names that come from the map are not translated: the names of layers and bookmarks, tool names (e.g. `measure`), hit types from the search and control titles.

## If the page already loads Matomo

If the page itself loads Matomo, for example with Matomo's standard JavaScript snippet, the plugin uses that tracker. `url`, `siteId`, `disableCookies` and `trackPageView` are then ignored, and those settings are controlled by the snippet. The plugin never loads the tracker a second time, since a second load creates a new Matomo instance without a tracker. Every event would then give the error `_paq.push() was used but Matomo tracker was not initialized`.

The plugin is exposed as `OrigoMatomo` and not `Matomo`, since the Matomo tracker uses the global variable `window.Matomo`.

## Custom events from other plugins

The component has a `track` method that other plugins can call:

```js
matomo.track("Search", "no hits", "estate");
```

## Usage example

**index.html:**

```html
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
  <meta http-equiv="X-UA-Compatible" content="IE=Edge;chrome=1" />
  <title>Origo example</title>
  <link href="css/style.css" rel="stylesheet" />
</head>
<body>
  <div id="app-wrapper"></div>
  <script src="js/origo.js"></script>
  <script src="plugins/origo-matomo.min.js"></script>

  <script type="text/javascript">
    //Init origo
    var origo = Origo("index.json");
    origo.on("load", function (viewer) {
      var matomo = OrigoMatomo({
        url: "https://matomo.example.com/",
        siteId: 1,
      });
      viewer.addComponent(matomo);
    });
  </script>
</body>
```

## Statistics dashboard

`dashboard/` contains a standalone page that fetches the events from the Matomo Reporting API and shows them per map and period: which layers are shown, feature info per layer, background maps, tools, measurements, searches, prints, zoom levels and more. It can be hosted in origo-server, which holds a shared token for Matomo, or on any web server where each user enters their own token. The page's user interface is in Swedish.

```
npm run dashboard         # development server for the page
npm run build:dashboard   # builds to build/dashboard
```

The page reads `config.json` from the same folder. It is copied from `dashboard/public/config.json` during the build and can be changed afterwards without rebuilding.

| Option        | Description                                                                                                                                                                                                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`         | URL of the Matomo server. Can also be entered on the page under Inställningar (Settings).                                                                                                                                                                                              |
| `siteId`      | The Matomo website shown first. All websites the user has view access to can be selected on the page.                                                                                                                                                                                   |
| `eventLocale` | The same language as the plugin uses in the map, so that the page looks for the right categories and actions.                                                                                                                                                                           |
| `title`       | The page heading.                                                                                                                                                                                                                                                                       |
| `maps`        | The maps that can be selected when several maps share a website in Matomo, e.g. `[{ "title": "Sundsvall", "url": "https://karta.sundsvall.se/sundsvall" }]`. A map covers the pages whose URL starts with `url`. If omitted, the maps are found among the page views of the past year. |

The selected website, map and period are stored in the URL, so a view can be shared as a link.

### Through origo-server

The page can be hosted in [origo-server](https://github.com/Sundsvallskommun/gis-origoserver) under `/origoserver/matomo/`. The server then forwards the page's requests to Matomo with a shared token, so users do not need their own token and Matomo needs no CORS setting. Only the API methods used by the page are forwarded.

1. Create a user in Matomo with view access only to the maps and create a token for it.
2. Build the page with `npm run build:dashboard` and copy the contents of `build/dashboard` to `kod/matomo-dashboard` in origo-server.
3. Add `matomoDashboard` to origo-server's `conf/config.js`, see CONFIG.md in origo-server.
4. Add the page to `auth.clients` in origo-server's configuration, e.g. `matomoDashboard: "https://internalmap.example.com/origoserver/matomo/"`.

The options in `config.json` are then set in origo-server's configuration instead, and the Settings button is not shown.

The statistics require login with OpenID Connect through origo-server, in the same way as report-issues-frontend, and only users in the same AD group as report-issues (`reportIssues.ad_group`) can see them. The page sends the user to the login and then back to the same map and period. The login is stored in `sessionStorage` and is gone when the tab is closed. Login is turned off with `require_login: false` in `matomoDashboard`.

### With your own token

Without origo-server, the page calls Matomo directly with the user's own token (`token_auth`), which is entered under Settings and stored in the browser. The token is sent as POST and never ends up in the URL or in `config.json`. If anonymous users have view access to the maps in Matomo, no token is needed.

If the page is on another domain than Matomo, the domain must be added to Matomo's `config/config.ini.php`:

```ini
[General]
cors_domains[] = "https://map.example.com"
```

### How names are fetched

Matomo's event reports only have two levels: category → action, category → name and action → name. The names for e.g. `Layer / show` are therefore taken from

- category → name if the category has only one action, e.g. `Feature info / view`,
- otherwise action → name, limited to the names that exist in the category.

Action → name counts all categories that have the action, e.g. `open` in both Help and Print. A name that does not exist in any of the other categories can only come from this one, so the count is exact. If the same name also exists in another of them, the smaller of the two counts is shown, which is the highest possible.

Segments on category and action are not used, since Matomo then selects the visits that have such an event and shows all events in those visits.

The reports are archived separately. For today's date they may therefore temporarily be at different stages, so that a category appears in the table of all events but has no names yet.

## Development

The plugin is built with [Vite](https://vite.dev/) in library mode to an IIFE that exposes the global `OrigoMatomo`. `Origo` is external and taken from the global variable created by `origo.js`. The configuration is in `vite.config.js`.

The code is in `src/origo-matomo.js` and the texts in `src/loc/`. `origo-matomo.js` in the root is the build entry point.

The repository is expected to sit next to an Origo clone in `../origo`. The development build writes to `../origo/plugins/origo-matomo.js`.

```
npm install
npm start       # unminified build that watches for changes, writes to ../origo/plugins/origo-matomo.js
npm run build   # production build to build/js/origo-matomo.min.js
npm run lint
```

Requires Node `^20.19.0` or `>=22.12.0`.

Run Origo at the same time (`npm start` in `../origo`) and test with `debug: true`.
