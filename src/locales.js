/**
 * Event names per language. Shared by the plugin and the statistics page in dashboard/.
 */

export const fallbackLocaleId = 'sv-SE';

// Event names per language from src/loc/<language>.json. The locale id is taken from the file name, e.g. sv_SE.json -> sv-SE,
// so a new language is added by adding a file.
export const locales = Object.fromEntries(Object.entries(import.meta.glob('./loc/*.json', { eager: true, import: 'default' }))
  .map(([path, locale]) => [path.match(/([^/.]+)\.json$/)[1].replace('_', '-'), locale]));

// Picks the given language, otherwise the same language with another region (e.g. en-GB -> en-US), otherwise Swedish.
export function resolveLocaleId(localeId, available = Object.keys(locales)) {
  if (!localeId) return fallbackLocaleId;
  if (available.includes(localeId)) return localeId;
  const language = localeId.split('-')[0];
  return available.find((id) => id.split('-')[0] === language) || fallbackLocaleId;
}

// Returns a function that looks up a name in the chosen language, falling back to Swedish
export function eventTexts(localeId) {
  const texts = locales[resolveLocaleId(localeId)].matomo;
  return (key) => texts[key] || locales[fallbackLocaleId].matomo[key];
}
