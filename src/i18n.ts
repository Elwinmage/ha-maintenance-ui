/**
 * Translations of the maintenance view.
 *
 * Keys reused from ha-reef-card keep their wording, so the reef card renders
 * exactly the same once it consumes this module.
 */

import type { HassLike } from "./types";

import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import it from "./locales/it.json";
import pl from "./locales/pl.json";
import pt from "./locales/pt.json";

export type TranslationKey = keyof typeof en;

const DICTIONARIES: Record<string, Record<string, string>> = {
  de,
  en,
  es,
  fr,
  it,
  pl,
  pt,
};

export const SUPPORTED_LANGUAGES = Object.keys(DICTIONARIES);

/**
 * Pick the dictionary language for a hass object ("fr-CA" -> "fr").
 * @param hass: the hass object, may be null
 * @return a supported language code, "en" as fallback
 */
export function language_of(hass: HassLike | null | undefined): string {
  const raw = hass?.locale?.language || hass?.language || "en";
  const short = String(raw).toLowerCase().split(/[-_]/)[0]!;
  return short in DICTIONARIES ? short : "en";
}

/**
 * Translate a key.
 * @param key: the translation key
 * @param language: a supported language code
 * @return the translation, the English one, or the key itself
 */
export function t(key: string, language: string = "en"): string {
  return DICTIONARIES[language]?.[key] ?? DICTIONARIES.en![key] ?? key;
}

/**
 * Tell whether a key exists (used for the open-ended pump types).
 * @param key: the translation key
 * @param language: a supported language code
 * @return true when the key is translated
 */
export function has_translation(key: string, language: string = "en"): boolean {
  return key in (DICTIONARIES[language] ?? {}) || key in DICTIONARIES.en!;
}
