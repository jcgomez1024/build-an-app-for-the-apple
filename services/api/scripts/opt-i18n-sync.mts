/** i18n1 catalog sync: every option name the live menu serves must have a translation
 * (an "ES / EN" pair or an entry in apps/web/opt-i18n.js MAP). Read-only: reads the local API menu.
 *   npx tsx scripts/opt-i18n-sync.mts [--base http://localhost:4000]   → exit 1 if anything is missing */
import fs from "node:fs";
import { i18n } from "../src/opt-i18n.js";
const base = process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1] : "http://localhost:4000";
const menu: any = await (await fetch(`${base}/api/menu`)).json();
const I = i18n();
if (!I) { console.error("opt-i18n.js did not load"); process.exit(2); }
const names = new Set<string>();
for (const it of menu.items || []) for (const g of it.modifierGroups || []) for (const o of g.options || []) names.add(typeof o === "string" ? o : o.name);
const missing = [...names].filter((n) => !I.pair(n).known).sort();
const out = { at: new Date().toISOString(), options: names.size, translated: names.size - missing.length, missing };
fs.mkdirSync("data/logs", { recursive: true });
fs.writeFileSync("data/logs/opt-i18n-coverage.json", JSON.stringify(out, null, 2));
console.log(`options ${out.options}, translated ${out.translated}, missing ${missing.length}`);
for (const m of missing) console.log("  missing:", m);
process.exit(missing.length ? 1 : 0);
