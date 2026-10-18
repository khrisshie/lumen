"use client";

import { useSyncExternalStore } from "react";

export const LANGUAGES = [
  "English",
  "Traditional Chinese (繁體中文)",
  "Simplified Chinese (简体中文)",
  "Japanese (日本語)",
  "Korean (한국어)",
  "Spanish (Español)",
  "French (Français)",
  "German (Deutsch)",
  "Portuguese (Português)",
  "Italian (Italiano)",
  "Russian (Русский)",
  "Vietnamese (Tiếng Việt)",
  "Indonesian (Bahasa Indonesia)",
  "Hindi (हिन्दी)",
  "Arabic (العربية)",
  "Turkish (Türkçe)",
];

const KEY = "lumen.lang";
/** Used when the browser's language isn't one we can map (e.g. English). */
const DEFAULT = LANGUAGES[1];
const listeners = new Set<() => void>();

function fromBrowser(): string {
  const tag = navigator.language.toLowerCase();
  if (tag.startsWith("zh")) return /tw|hk|mo|hant/.test(tag) ? LANGUAGES[1] : LANGUAGES[2];
  const byPrefix: Record<string, number> = { ja: 3, ko: 4, es: 5, fr: 6, de: 7, pt: 8, it: 9, ru: 10, vi: 11, id: 12, hi: 13, ar: 14, tr: 15 };
  const hit = byPrefix[tag.slice(0, 2)];
  return hit === undefined ? DEFAULT : LANGUAGES[hit];
}

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? fromBrowser();
  } catch {
    return fromBrowser();
  }
}

export function setLanguage(lang: string) {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // Storage blocked; the choice just won't persist.
  }
  listeners.forEach((fn) => fn());
}

/** The reader's answer/translation language, persisted per browser. */
export function useLanguage(): string {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    read,
    () => DEFAULT,
  );
}
