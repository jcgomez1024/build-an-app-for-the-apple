// Exact-cart runner (Batch 0). Drop into services/api/test/offline/ and run from services/api:
//   NODE_ENV=test npx tsx test/offline/exact-cart-runner.ts <fixtures-dir|fixture.json ...> [--json out.json] [--status V|U|all] [--model empty]
// Feeds each fixture's turns through shadowOrderFromTurns with an EMPTY model stub (no network, no paid calls) on the
// frozen phone menu, then scores the cart EXACTLY: item family/code, quantity, tortilla style (QCO/QHR/QST, TCO/TST,
// GD/QGD, TO/QTO, QD regular/deluxe, burrito size), meats, graded flags (frij, arroz, xqueso, aparte, deluxe, todo),
// plus the order name (first word, accent/case-insensitive). No Square, Twilio, SMS, caller-memory or log writes.
//
// Fixture: { id, status: "V"|"U", turns: [{speaker:"caller"|"staff", text, language?}],
//            expected: { lines: ["QTY CODE meat[/meat] +flag,flag", ...], orderName: string|null|"?" } }
// Expected codes: QCO QHR QST QD-R QD-D TCO TST GD QGD TO QTO BURR-G BURR-R COMBO-QCO COMBO-QHR horchata queso-birrias
// X-<extra slug>, otherwise the Square itemId without "sq-" and the 6-char suffix. Wildcards: Q, T, QD, BURR.
// Meat "?" = any meat. orderName "?" = not graded; null/"None" = no name expected.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";
import { frozenPhoneMenu } from "../../src/phone-menu.ts";

type Unit = { code: string; meats: string; flags: string };
const MEATS: Array<[string, RegExp]> = [
  ["alpastor", /alpastor|al pastor|pastor/], ["bistec", /bistec|steak|asada/], ["buche", /buche/], ["cabeza", /cabeza/],
  ["carnitas", /carnitas/], ["chorizo", /chorizo/], ["costilla", /costilla/], ["deshebrada", /deshebrada/],
  ["duro", /duro|pork rinds/], ["frijoles", /frijoles refritos|frijoles \/ beans|solo frijoles/], ["huevo", /huevo/],
  ["lengua", /lengua/], ["nopales", /nopales/], ["picadillo", /picadillo/], ["milanesa", /milanesa/], ["pollo", /pollo|chicken/],
  ["prensado", /prensado/], ["queso", /queso derretido|queso \/ cheese/], ["tripa", /tripa/], ["birria", /birria/],
  ["rajas", /rajas/], ["papas", /^papas/],
];
const GRADED = new Set(["frij", "arroz", "xqueso", "aparte", "deluxe", "todo"]);
const WILD: Record<string, string[]> = { Q: ["QCO", "QHR", "QST"], T: ["TCO", "TST", "TTA"], QD: ["QD-R", "QD-D"], BURR: ["BURR-G", "BURR-R"], "drink-agua-fresca-horchata-32oz": ["horchata"] }; // unsized "horchata" = 32oz (phone default); "horchata-20oz" is strict (Carlos A2)
function meatOf(opt: string): string | null {
  const o = opt.toLowerCase();
  if (o.includes("extra")) return null;
  for (const [k, re] of MEATS) if (re.test(o)) return k;
  return null;
}
export function normLine(l: any): { unit: Unit; qty: number } {
  const iid = String(l.itemId || "");
  const opts: Array<[string, string]> = (l.modifiers || []).map((m: any) => [String(m.step || ""), String(m.option || "")]);
  let q = Number(l.quantity) || 1;
  const meats = new Set<string>(), flags = new Set<string>();
  const has = (re: RegExp) => opts.some(([, o]) => re.test(o));
  for (const [s, o] of opts) if (/carne|meat|relleno|tipo de chiles/i.test(s)) { const m = meatOf(o); if (m) meats.add(m); }
  if (has(/^\*\*Con Frijoles/i)) flags.add("frij");
  if (has(/^\*\*Con Arroz/i)) flags.add("arroz");
  if (has(/EXTRA Queso Derretido/i)) flags.add("xqueso");
  if (has(/DELUXE \*\*\*APARTE/i)) flags.add("aparte");
  if (has(/^DELUXE \(Lechuga/i)) flags.add("deluxe");
  let code = iid.slice(3);
  const pick = (cs: string[], fallback: string, pre = "") => { for (const c of cs) if (has(new RegExp(`\\(${c}\\)`))) return pre + c; return fallback; };
  if (iid.startsWith("sq-quesadilla-")) code = pick(["QCO", "QHR", "QST"], "Q?");
  else if (iid.startsWith("sq-qd-")) code = iid.includes("deluxe") ? "QD-D" : "QD-R";
  else if (iid.startsWith("sq-taco-")) code = pick(["TCO", "TST", "TTA"], "T?");
  else if (iid.startsWith("sq-gordita-")) code = has(/\(QGD\)/) ? "QGD" : has(/\(GD\)/) ? "GD" : "GD?";
  else if (iid.startsWith("sq-torta-")) code = has(/\(QTO\)/) ? "QTO" : has(/\(TO\)/) ? "TO" : "TO?";
  else if (iid.startsWith("sq-burrito-")) {
    code = has(/Grande/) ? "BURR-G" : "BURR-R";
    const c = opts.filter(([s]) => s.startsWith("(C)")).map(([, o]) => o.toLowerCase());
    if (["crema", "queso"].every((k) => c.some((x) => x.includes(k)))) flags.add("todo");
  } else if (iid.startsWith("sq-combo-quesadillas")) {
    code = pick(["QCO", "QHR", "QST"], "COMBO-Q", "COMBO-");
    for (const [s, o] of opts) if (/COMBO/.test(s) && /carne|meat/i.test(s)) { const m = meatOf(o); if (m) meats.add(m); }
  } else if (iid.startsWith("sq-drink-agua-fresca-horchata")) { const sz = /horchata-(\d+oz)/.exec(iid)?.[1]; code = !sz || sz === "32oz" ? "horchata" : `horchata-${sz}`; }
  else if (iid.startsWith("sq-queso-birrias")) code = "queso-birrias";
  else if (iid.startsWith("sq-extras-cebolla-y-chiles-asados")) code = "X-cebolla-y-chiles-asados";
  else if (iid.startsWith("sq-extras-mild-salsa-asada-2oz") && opts.length) {
    const o = opts[0][1].toLowerCase().replace(/\s*\d+\s*oz/g, "");
    code = "X-" + o.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  } else code = iid.slice(3).replace(/-[A-Z0-9]{6}$/, "");
  const pack = /^sq-(\d+)-pack-meal-(t[a-z]{2})/.exec(iid);
  if (pack) { code = pack[2].toUpperCase(); q *= Number(pack[1]); }
  if (meats.has("frijoles") && meats.size > 1) { meats.delete("frijoles"); flags.add("frij"); }
  return { unit: { code, meats: [...meats].sort().join("/"), flags: [...flags].filter((f) => GRADED.has(f)).sort().join(",") }, qty: q };
}
export function actualUnits(cart: any[]): Unit[] {
  const out: Unit[] = [];
  for (const l of cart || []) {
    if (/delivery-fee/i.test(String(l.itemId || ""))) continue;
    const { unit, qty } = normLine(l);
    for (let i = 0; i < qty; i++) out.push(unit);
  }
  return out;
}
export function expectedUnits(lines: string[]): Unit[] {
  const out: Unit[] = [];
  for (const s of lines) {
    const parts = s.trim().split(/\s+/); const q = Number(parts[0]); const code = parts[1]; let meats = "", flags = "";
    for (const p of parts.slice(2)) {
      if (p.startsWith("+")) flags = p.slice(1).split(",").filter(Boolean).sort().join(",");
      else meats = p.split("/").sort().join("/");
    }
    for (let i = 0; i < q; i++) out.push({ code, meats, flags });
  }
  return out;
}
function match1(e: Unit, a: Unit) {
  if (e.code !== a.code && !(WILD[e.code] || []).includes(a.code)) return false;
  if (e.meats !== "?" && e.meats !== a.meats) return false;
  return e.flags === a.flags;
}
export function compare(exp: Unit[], act: Unit[]) {
  const left = [...act]; const missing: Unit[] = [];
  const order = [...exp].sort((x, y) => (Number(x.code in WILD) - Number(y.code in WILD)) || (Number(x.meats === "?") - Number(y.meats === "?")));
  for (const e of order) { const i = left.findIndex((a) => match1(e, a)); if (i >= 0) left.splice(i, 1); else missing.push(e); }
  return { missing, extra: left };
}
const fmt = (us: Unit[]) => { const m = new Map<string, number>(); for (const u of us) { const k = `${u.code}${u.meats ? " " + u.meats : ""}${u.flags ? " +" + u.flags : ""}`; m.set(k, (m.get(k) || 0) + 1); } return [...m].sort().map(([k, n]) => `${n} ${k}`).join("; "); };
const firstName = (x: any) => String(x || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().split(/\s+/)[0] || "";

function loadFixtures(args: string[]): any[] {
  const files: string[] = [];
  for (const a of args) { if (statSync(a).isDirectory()) for (const f of readdirSync(a).sort()) { if (f.endsWith(".json")) files.push(path.join(a, f)); } else files.push(a); }
  return files.map((f) => ({ ...JSON.parse(readFileSync(f, "utf8")), _file: f }));
}
async function main() {
  const argv = process.argv.slice(2); let jsonOut = "", status = "V"; const inputs: string[] = [];
  for (let i = 0; i < argv.length; i++) { if (argv[i] === "--json") jsonOut = argv[++i]; else if (argv[i] === "--status") status = argv[++i]; else if (argv[i] === "--model") i++; else inputs.push(argv[i]); }
  const menu = frozenPhoneMenu();
  if (!menu?.length) throw new Error("frozen phone menu missing (see ELVI_FROZEN_PHONE_MENU / catalog)");
  const run: any = async () => ({ actions: [], reply: "" }); run.menu = () => menu;
  const fixtures = loadFixtures(inputs).filter((f) => status === "all" || f.status === status);
  const rows: any[] = [];
  for (const f of fixtures) {
    const turns = f.turns.map((t: any, n: number) => ({ speaker: t.speaker, text: t.text, language: t.language || "es", start: n, end: n + 1 }));
    let order: any = null, err = "";
    try { order = await shadowOrderFromTurns(turns as any, run); } catch (e: any) { err = String(e?.message || e).slice(0, 200); }
    let heard: string | null = null; try { heard = (nameFromTranscriptInfo(turns as any) as any)?.name ?? null; } catch {}
    const got = order?.customerName || heard || "";
    const { missing, extra } = compare(expectedUnits(f.expected.lines), actualUnits(order?.cart || []));
    const en = f.expected.orderName;
    const nameOk = en === "?" ? null : firstName(en === "None" ? "" : en) === firstName(got);
    const cartOk = !err && !missing.length && !extra.length;
    rows.push({ id: f.id, status: f.status, cartOk, nameOk, gotName: got, missing: fmt(missing), extra: fmt(extra), error: err || undefined });
    console.log(`${cartOk ? "PASS" : "FAIL"} cart  ${nameOk === false ? "FAIL" : "pass"} name  ${f.id}${cartOk ? "" : `  missing[${fmt(missing)}] extra[${fmt(extra)}]`}${nameOk === false ? `  name[${got}≠${en}]` : ""}${err ? "  ERROR " + err : ""}`);
  }
  const n = rows.length, c = rows.filter((r) => r.cartOk).length, cn = rows.filter((r) => r.cartOk && r.nameOk !== false).length;
  const pct = (x: number) => (n ? ((100 * x) / n).toFixed(1) : "0.0");
  console.log(`\nTOTAL ${n} cases | cart exact ${c}/${n} (${pct(c)}%) | cart+name ${cn}/${n} (${pct(cn)}%)`);
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ total: n, cartExact: c, cartAndName: cn, rows }, null, 1));
}
await main();
