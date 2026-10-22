// i18n1: the API uses the same translation map as the web app (apps/web/opt-i18n.js, one copy).
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

type I18n = { pair(n: string): { es: string; en: string; esBase: string; enBase: string; known: boolean }; label(n: string, l: string): string; spoken(n: string, l: string): string; MAP: Record<string, [string, string]> };
let cached: I18n | null = null;
export function i18n(): I18n | null {
  if (cached) return cached;
  try {
    const file = fileURLToPath(new URL("../../../apps/web/opt-i18n.js", import.meta.url));
    const box: any = {};
    vm.runInNewContext(fs.readFileSync(file, "utf8"), { globalThis: box, window: box });
    cached = box.ElviI18n || null;
  } catch { cached = null; }
  return cached;
}
export const optionLabel = (name: string, lang: string) => i18n()?.label(name, lang) ?? name;
