// Restored counted-request cases. variationName comes from frozenPhoneMenu, not a later Square-id lookup.
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { reconcileCountedRequests } from "../../src/conversation-intent.ts";
import { phoneMenu } from "./evaluate.ts";

const outPath = process.argv[2];
if (!outPath) throw new Error("usage: run-counted-cases.ts <out.json>");

const phone = phoneMenu();
const freeze = JSON.parse(readFileSync("/tmp/menu-freeze-preflight/catalog/menu.json", "utf8"));
const horchata = freeze.find((item: any) => item.id === "sq-drink-agua-fresca-horchata-32oz-HL6HPK");

function run(id: string, turns: Array<{ speaker?: string; text: string; language?: string }>, menu: any[], cart: any[] = []) {
  const decision = reconcileCountedRequests(JSON.parse(JSON.stringify(cart)), turns, menu);
  return {
    id,
    turns,
    lines: decision.lines,
    reviewReason: decision.reviewReason,
    reply: decision.reply,
    closures: decision.closures,
    item_variation: decision.lines.map((line) => menu.find((item: any) => item.id === line.itemId)?.variationName || null),
  };
}

const coke = (kind: "regular" | "diet") => phone.find((item) => {
  const sku = String(item.variationName || "");
  return kind === "diet" ? /diet/i.test(sku) && /coca/i.test(sku) : /^coca cola$/i.test(sku);
});

const cases = [
  run("plain", [{ speaker: "caller", text: "Una coca.", language: "es" }], phone),
  run("negated-no", [{ speaker: "caller", text: "No una coca.", language: "es" }], phone),
  run("declined", [{ speaker: "caller", text: "Una coca.", language: "es" }, { speaker: "caller", text: "No, no quiero la coca.", language: "es" }], phone),
  run("removed", [{ speaker: "caller", text: "Una coca.", language: "es" }, { speaker: "caller", text: "Quita la coca.", language: "es" }], phone),
  run("staff-out", [{ speaker: "caller", text: "Una coca.", language: "es" }, { speaker: "staff", text: "No hay coca hoy." }], phone),
  run("replaced", [{ speaker: "caller", text: "Una coca.", language: "es" }, { speaker: "caller", text: "En vez de la coca, una pepsi.", language: "es" }], phone),
  run("mejor-a-las-seis", [{ speaker: "caller", text: "Una coca.", language: "es" }, { speaker: "caller", text: "Mejor a las seis.", language: "es" }], phone),
  run("sin-cebolla", [{ speaker: "caller", text: "Dos tacos.", language: "es" }, { speaker: "caller", text: "Sin cebolla en los tacos.", language: "es" }], [{ id: "taco-1", name: "Taco", variationName: "Taco" }]),
  run("no-quiero-cebolla", [{ speaker: "caller", text: "Dos tacos.", language: "es" }, { speaker: "caller", text: "No quiero cebolla en los tacos.", language: "es" }], [{ id: "taco-1", name: "Taco", variationName: "Taco" }]),
  run("diet", [{ speaker: "caller", text: "Una coca diet.", language: "es" }], phone),
  run("zero", [{ speaker: "caller", text: "Una coca zero.", language: "es" }], phone),
  run("beside-diet", [{ speaker: "caller", text: "Una coca.", language: "es" }], phone, [{ itemId: coke("diet").id, quantity: 1 }]),
  run("cross-turn-quita", [{ speaker: "caller", text: "Una coca.", language: "es" }, { speaker: "caller", text: "Quita la coca.", language: "es" }], phone),
  run("cross-turn-negation", [{ speaker: "caller", text: "Una coca.", language: "es" }, { speaker: "caller", text: "No, no quiero la coca.", language: "es" }], phone),
  run("reversed-menu", [{ speaker: "caller", text: "Una coca.", language: "es" }], [...phone].reverse()),
  run("pos-999", [{ speaker: "caller", text: "Una coca.", language: "es" }], [
    { id: "POS-999", name: "Family", variationName: "Coca Cola" },
    { id: "POS-111", name: "Family", variationName: "Pepsi" },
  ]),
  run("staff-diet-only", [{ speaker: "caller", text: "Una coca.", language: "es" }, { speaker: "staff", text: "No tenemos coca de dieta." }], phone),
  run("horchata-already-there", [{ speaker: "caller", text: "Two 32-ounce horchatas.", language: "en" }], freeze, [{ itemId: horchata.id, quantity: 2 }]),
  run("horchata-replaced-later", [
    { speaker: "caller", text: "Two 32-ounce horchatas.", language: "en" },
    { speaker: "caller", text: "Instead of the horchatas, give me tacos.", language: "en" },
  ], freeze, [{ itemId: "sq-taco-TAR7L5", quantity: 2 }]),
  run("horchata-es-already-there", [{ speaker: "caller", text: "Dos horchatas de treinta y dos onzas.", language: "es" }], freeze, [{ itemId: horchata.id, quantity: 2 }]),
];

const plainId = cases.find((row) => row.id === "plain")!.lines[0]?.itemId || "";
const checks: Record<string, boolean> = {
  plain: cases.find((row) => row.id === "plain")!.lines.length === 1 && cases.find((row) => row.id === "plain")!.reviewReason === "Recuperado, hay que confirmar: Coca Cola.",
  "negated-no": cases.find((row) => row.id === "negated-no")!.lines.length === 0,
  declined: cases.find((row) => row.id === "declined")!.lines.length === 0 && !cases.find((row) => row.id === "declined")!.reviewReason,
  removed: cases.find((row) => row.id === "removed")!.lines.length === 0 && !cases.find((row) => row.id === "removed")!.reviewReason,
  "staff-out": cases.find((row) => row.id === "staff-out")!.lines.length === 0,
  replaced: !cases.find((row) => row.id === "replaced")!.lines.some((line) => line.itemId === plainId) && cases.find((row) => row.id === "replaced")!.closures.some((closure) => closure.target === "coca" && closure.kind === "replacement"),
  "mejor-a-las-seis": cases.find((row) => row.id === "mejor-a-las-seis")!.lines[0]?.itemId === plainId && cases.find((row) => row.id === "mejor-a-las-seis")!.closures.length === 0,
  "sin-cebolla": cases.find((row) => row.id === "sin-cebolla")!.lines.some((line) => line.itemId === "taco-1" && line.elviNotes.includes("sin cebolla")) && cases.find((row) => row.id === "sin-cebolla")!.closures.length === 0,
  "runtime-coca": reconcileCountedRequests([], [{ speaker: "caller", text: "Una coca.", language: "es" }], [
    { id: "runtime-coke", name: "Coca Cola", nameEs: "Coca Cola", aliases: ["coca", "coke", "coca cola"] },
    { id: "runtime-pepsi", name: "Pepsi", nameEs: "Pepsi", aliases: ["pepsi"] },
  ]).lines[0]?.itemId === "runtime-coke",
  "no-quiero-cebolla": cases.find((row) => row.id === "no-quiero-cebolla")!.lines.some((line) => line.itemId === "taco-1") && cases.find((row) => row.id === "no-quiero-cebolla")!.closures.length === 0,
  diet: /diet/i.test(String(phone.find((item) => item.id === cases.find((row) => row.id === "diet")!.lines[0]?.itemId)?.variationName || "")),
  zero: cases.find((row) => row.id === "zero")!.lines.length === 0 && !cases.find((row) => row.id === "zero")!.reviewReason,
  "beside-diet": cases.find((row) => row.id === "beside-diet")!.lines.length === 0,
  "cross-turn-quita": cases.find((row) => row.id === "cross-turn-quita")!.lines.length === 0 && !cases.find((row) => row.id === "cross-turn-quita")!.reviewReason,
  "cross-turn-negation": cases.find((row) => row.id === "cross-turn-negation")!.lines.length === 0 && !cases.find((row) => row.id === "cross-turn-negation")!.reviewReason,
  "reversed-menu": cases.find((row) => row.id === "reversed-menu")!.lines[0]?.itemId === plainId,
  "pos-999": cases.find((row) => row.id === "pos-999")!.lines[0]?.itemId === "POS-999",
  "staff-diet-only": cases.find((row) => row.id === "staff-diet-only")!.lines[0]?.itemId === plainId,
  "horchata-already-there": !cases.find((row) => row.id === "horchata-already-there")!.reviewReason && cases.find((row) => row.id === "horchata-already-there")!.lines.length === 0,
  "horchata-replaced-later": !cases.find((row) => row.id === "horchata-replaced-later")!.reviewReason,
  "horchata-es-already-there": !cases.find((row) => row.id === "horchata-es-already-there")!.reviewReason,
};
const prodTrace = "/tmp/elvi-prod-trace-must-not-exist.jsonl";
const prod = JSON.parse(execFileSync("npx", ["tsx", "test/offline/prod-gate.ts", prodTrace], {
  cwd: "/agent/repos/build-an-app-for-the-apple/services/api",
  encoding: "utf8",
  env: { ...process.env, NODE_ENV: "production", ELVI_FROZEN_PHONE_MENU: "1", ELVI_RECONCILE_TRACE: prodTrace, ELVI_CALL_LOG_DIR: "/tmp/elvi-prod-gate-logs", ELVI_CALLERS_FILE: "/tmp/elvi-prod-gate-logs/callers.json" },
}));
const productionGate = {
  trace_written: existsSync(prodTrace),
  reviewReason: prod.reviewReason,
  lines: prod.lines,
  frozen_menu_not_attached: prod.reviewReason === "confirmar menú: missing" && prod.lines === 0 && !existsSync(prodTrace),
};
checks["production-cannot-trace-or-attach-menu"] = productionGate.frozen_menu_not_attached;
const body = {
  sha: execSync("git rev-parse HEAD", { cwd: "/agent/repos/build-an-app-for-the-apple" }).toString().trim(),
  variation_name_source: "frozenPhoneMenu copies sku.name onto variationName while building the committed site-catalog menu. Reconciliation reads that field. It does not look up a Square id again.",
  checks,
  production_gate: productionGate,
  cases,
};
writeFileSync(outPath, JSON.stringify(body, null, 2));
for (const [id, ok] of Object.entries(checks)) console.log(ok ? "PASS" : "FAIL", id);
if (Object.values(checks).some((ok) => !ok)) process.exit(1);
