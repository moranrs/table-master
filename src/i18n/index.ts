import { en, type Dict } from "./en";
import { zh } from "./zh";
import { zhTW } from "./zh-TW";

export type LangKey = keyof Dict;
export type LangChoice = "auto" | "en" | "zh" | "zh-TW";

let active: Dict = en;

/** True for Traditional Chinese locales (zh-TW / zh-HK / zh-Hant). */
function isTraditionalChinese(lang: string): boolean {
  const l = lang.toLowerCase();
  return l.includes("tw") || l.includes("hk") || l.includes("hant");
}

export function setLanguage(choice: LangChoice): void {
  if (choice === "zh") {
    active = zh;
    return;
  }
  if (choice === "zh-TW") {
    active = zhTW;
    return;
  }
  if (choice === "en") {
    active = en;
    return;
  }
  // auto: detect from window.moment locale or navigator.language
  const lang = detectObsidianLocale();
  if (lang.startsWith("zh")) {
    active = isTraditionalChinese(lang) ? zhTW : zh;
    return;
  }
  active = en;
}

function detectObsidianLocale(): string {
  // Obsidian exposes the locale via activeWindow.moment.locale()
  // (`activeWindow` is the popout-window-aware global Obsidian provides;
  // referencing the bare `window` global would trip obsidianmd's
  // `prefer-active-doc` lint rule).
  // Fall back to browser language.
  const w =
    typeof activeWindow !== "undefined"
      ? (activeWindow as unknown as { moment?: { locale?: () => string } })
      : undefined;
  if (w?.moment?.locale) {
    try {
      return w.moment.locale() ?? "en";
    } catch {
      // ignore
    }
  }
  if (typeof navigator !== "undefined" && navigator.language) return navigator.language.toLowerCase();
  return "en";
}

export function t(key: LangKey, params?: Record<string, string>): string {
  let s = active[key] ?? en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replaceAll(`{${k}}`, v);
    }
  }
  return s;
}
