// Restored counted-request cases. variationName comes from frozenPhoneMenu, not a later Square-id lookup.
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { reconcileCountedRequests } from "../../src/conversation-intent.ts";
import { frozenPhoneMenu, squareObjectsFromSiteCatalog } from "../../src/phone-menu.ts";
import { buildMenuFromSquareCatalog } from "../../src/square.ts";
import { buildTicketLines } from "../../src/twilio.ts";
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

const taco = { id: "taco-1", name: "Taco", modifierGroups: [{ name: "Toppings", minSelections: 0, maxSelections: 2, options: [{ name: "Cebolla" }, { name: "Crema" }] }] };
const coke = (kind: "regular" | "diet") => phone.find((item) => kind === "diet" ? /diet/i.test(item.name) && /coca/i.test(item.name) : item.name === "Coca Cola");

const cases = [
  run("plain", [{ speaker: "caller", text: "Una coca.", language: "es" }], phone),
  run("negated-no", [{ speaker: "caller", text: "No una coca.", language: "es" }], phone),
  run("declined", [{ speaker: "caller", text: "Una coca.", language: "es" }, { speaker: "caller", text: "No, no quiero la coca.", language: "es" }], phone),
  run("removed", [{ speaker: "caller", text: "Una coca.", language: "es" }, { speaker: "caller", text: "Quita la coca.", language: "es" }], phone),
  run("staff-out", [{ speaker: "caller", text: "Una coca.", language: "es" }, { speaker: "staff", text: "No hay coca hoy." }], phone),
  run("replaced", [{ speaker: "caller", text: "Una coca.", language: "es" }, { speaker: "caller", text: "En vez de la coca, una pepsi.", language: "es" }], phone),
  run("mejor-a-las-seis", [{ speaker: "caller", text: "Una coca.", language: "es" }, { speaker: "caller", text: "Mejor a las seis.", language: "es" }], phone),
  run("sin-cebolla", [{ speaker: "caller", text: "Dos tacos.", language: "es" }, { speaker: "caller", text: "Sin cebolla en los tacos.", language: "es" }], [taco]),
  run("no-quiero-cebolla", [{ speaker: "caller", text: "Dos tacos.", language: "es" }, { speaker: "caller", text: "No quiero cebolla en los tacos.", language: "es" }], [taco]),
  run("sin-problema", [{ speaker: "caller", text: "Dos tacos.", language: "es" }, { speaker: "caller", text: "Sin problema.", language: "es" }], [taco]),
  run("family-already", [{ speaker: "caller", text: "Dos tacos de asada.", language: "es" }], phone, [{ itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ option: "Asada / Steak" }] }]),
  run("hold-lengua", [{ speaker: "caller", text: "Dos tacos de lengua.", language: "es" }], phone, [{ itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ option: "Pastor / Pork" }] }]),
  run("hold-comal", [{ speaker: "caller", text: "Una quesadilla de comal.", language: "es" }], phone, [{ itemId: "sq-quesadilla-HLT6CR", quantity: 1, modifiers: [{ option: "(QHR) Quesadilla Harina / Flour" }] }]),
  run("exact-lengua", [{ speaker: "caller", text: "Dos tacos de lengua.", language: "es" }], phone, [{ itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ option: "Lengua / Beef Tongue" }] }]),
  run("split-lengua", [{ speaker: "caller", text: "Cuatro tacos de lengua.", language: "es" }], phone, [
    { itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ option: "Lengua / Beef Tongue" }] },
    { itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ option: "Lengua / Beef Tongue" }] },
  ]),
  run("aceite-dorada", [{ speaker: "caller", text: "Dos quesadillas en aceite.", language: "es" }], phone, [{ itemId: phone.find((item) => /quesadilla/i.test(item.name) && /dorada/i.test(item.name))?.id, quantity: 2 }]),
  run("h03-es", [
    { speaker: "caller", text: "Dos tacos taqueros de bistec.", language: "es" },
    { speaker: "caller", text: "Cambia la primera línea. De pollo, no de bistec.", language: "es" },
  ], phone, [{ itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ option: "Pollo / Chicken" }] }]),
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

const runtimeMenu = buildMenuFromSquareCatalog(squareObjectsFromSiteCatalog());
const frozenMenu = frozenPhoneMenu();
const runtimeCoca = reconcileCountedRequests([], [{ speaker: "caller", text: "Una coca.", language: "es" }], runtimeMenu);
const frozenCoca = reconcileCountedRequests([], [{ speaker: "caller", text: "Una coca.", language: "es" }], frozenMenu);
const runtimeRow = runtimeMenu.find((item) => item.id === runtimeCoca.lines[0]?.itemId);
const onion = cases.find((row) => row.id === "no-quiero-cebolla")!;
const printedOnion = buildTicketLines(
  [{ name: "Taco", quantity: 2, choices: [], totalCents: 700 }],
  [{ itemId: "taco-1", quantity: 2, modifiers: [], elviNotes: ["sin cebolla"] }],
  [],
);
const printedDeluxe = buildTicketLines(
  [{ name: "Quesadilla", quantity: 1, choices: ["DELUXE (Lechuga/Lettuce, Pico, Crema/Sour Cream, Queso Fresco)"], totalCents: 0 }],
  [{ itemId: "q", quantity: 1, modifiers: [], elviNotes: ["no crema"] }],
  ["no crema"],
);
const plainId = cases.find((row) => row.id === "plain")!.lines[0]?.itemId || "";
const checks: Record<string, boolean> = {
  plain: cases.find((row) => row.id === "plain")!.lines.length === 1 && cases.find((row) => row.id === "plain")!.lines[0].elviNotes.includes("confirmar") && !cases.find((row) => row.id === "plain")!.reviewReason && cases.find((row) => row.id === "plain")!.lines[0].readback === "Coca Cola",
  "negated-no": cases.find((row) => row.id === "negated-no")!.lines.length === 0,
  declined: cases.find((row) => row.id === "declined")!.lines.length === 0 && !cases.find((row) => row.id === "declined")!.reviewReason,
  removed: cases.find((row) => row.id === "removed")!.lines.length === 0 && !cases.find((row) => row.id === "removed")!.reviewReason,
  "staff-out": cases.find((row) => row.id === "staff-out")!.lines.length === 0 && cases.find((row) => row.id === "staff-out")!.reviewReason === "revisar pedido contado",
  replaced: !cases.find((row) => row.id === "replaced")!.lines.some((line) => line.itemId === plainId) && cases.find((row) => row.id === "replaced")!.closures.some((closure) => closure.target === "coca" && closure.kind === "replacement"),
  "mejor-a-las-seis": cases.find((row) => row.id === "mejor-a-las-seis")!.lines[0]?.itemId === plainId && cases.find((row) => row.id === "mejor-a-las-seis")!.closures.length === 0,
  "sin-cebolla": cases.find((row) => row.id === "sin-cebolla")!.lines.some((line) => line.itemId === "taco-1" && line.elviNotes.includes("sin cebolla")) && cases.find((row) => row.id === "sin-cebolla")!.closures.length === 0,
  "runtime-coca": runtimeCoca.lines[0]?.itemId === "sq-drink-coca-cola-JJE4KC" && runtimeCoca.lines[0]?.itemId === frozenCoca.lines[0]?.itemId && runtimeRow?.name === "Coca Cola",
  "no-quiero-cebolla": onion.lines.some((line) => line.itemId === "taco-1" && line.elviNotes.includes("sin cebolla")) && onion.closures.length === 0,
  "sin-problema": cases.find((row) => row.id === "sin-problema")!.lines.some((line) => line.itemId === "taco-1" && !line.elviNotes.some((note) => /problema/.test(note))),
  "family-already": cases.find((row) => row.id === "family-already")!.lines.length === 0 && !cases.find((row) => row.id === "family-already")!.reviewReason,
  "hold-lengua": cases.find((row) => row.id === "hold-lengua")!.lines.length === 0 && cases.find((row) => row.id === "hold-lengua")!.reviewReason === "revisar pedido contado",
  "hold-comal": cases.find((row) => row.id === "hold-comal")!.lines.length === 0 && cases.find((row) => row.id === "hold-comal")!.reviewReason === "revisar pedido contado",
  "exact-lengua": cases.find((row) => row.id === "exact-lengua")!.lines.length === 0 && !cases.find((row) => row.id === "exact-lengua")!.reviewReason,
  "split-lengua": cases.find((row) => row.id === "split-lengua")!.lines.length === 0 && !cases.find((row) => row.id === "split-lengua")!.reviewReason,
  "aceite-dorada": cases.find((row) => row.id === "aceite-dorada")!.lines.length === 0 && !cases.find((row) => row.id === "aceite-dorada")!.reviewReason,
  "h03-es": cases.find((row) => row.id === "h03-es")!.lines.length === 0 && !cases.find((row) => row.id === "h03-es")!.reviewReason,
  "printed-restriction": printedOnion.some((line) => line.notes.filter((note) => note === "sin cebolla").length === 1 && !line.notes.includes("confirmar")),
  "printed-deluxe-once": printedDeluxe.some((line) => line.notes.filter((note) => /crema/i.test(note)).length === 1),
  "phone-only-prices": phone.find((item) => item.squareVariationId === "PYTW56MHJJGL6JKTZGSXGVWQ")?.priceCents === 1000 && phone.find((item) => item.squareVariationId === "QGR5AQTWVHNW347NOPAKX44U")?.priceCents === 400,
  diet: /diet/i.test(String(phone.find((item) => item.id === cases.find((row) => row.id === "diet")!.lines[0]?.itemId)?.name || "")),
  zero: cases.find((row) => row.id === "zero")!.lines.length === 0 && cases.find((row) => row.id === "zero")!.reviewReason === "revisar pedido contado",
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
const accept = execFileSync("npx", ["tsx", "test/offline/accept-shortcut.ts"], {
  cwd: "/agent/repos/build-an-app-for-the-apple/services/api",
  encoding: "utf8",
  env: { ...process.env, NODE_ENV: "test", ELVI_CALL_LOG_DIR: "/tmp/elvi-accept-shortcut", ELVI_CALLERS_FILE: "/tmp/elvi-accept-shortcut/callers.json" },
});
checks["accept-shortcut"] = /PASS accept-shortcut/.test(accept);
const staffList = execFileSync("npx", ["tsx", "test/offline/affirmed-staff-list.ts"], {
  cwd: "/agent/repos/build-an-app-for-the-apple/services/api",
  encoding: "utf8",
  env: {
    ...process.env,
    NODE_ENV: "test",
    ELVI_CALL_LOG_DIR: "/tmp/elvi-affirmed-staff-list",
    ELVI_CALLERS_FILE: "/tmp/elvi-affirmed-staff-list/callers.json",
    ELVI_COUNTED_DIAG: "/tmp/elvi-affirmed-staff-diag.jsonl",
  },
});
for (const name of ["upsell-adds-nothing", "tambien-tenemos-adds-nothing", "wrong-readback-keeps-pepsi", "wrong-readback-review-reason", "wrong-readback-scratch-diagnostic", "pero-is-not-a-clean-yes", "later-correction-wins", "latest-list-wins", "c07-still-passes", "closing-staff-adds-nothing", "denial-then-yes-adds-nothing", "unspoken-size-holds", "garbled-duplicate-not-added", "c10-pickup", "false-ready-times", "las-plus-hour", "unreadable-con-todo-leaves-other-regular", "no-regular-after-con-todo-stays-regular", "coke-regular-does-not-revert-dorada", "quesadilla-without-tortilla-holds", "fajitas-elvis-corn-default-clears", "duro-without-a-dish-word-binds-to-the-dorada", "comal-once-covers-every-quesadilla", "one-comal-answer-covers-every-taco", "homemade-after-a-tortilla-question-is-comal", "alpastor-maps-to-pastor", "al-pastor-maps-to-pastor", "el-pastor-maps-to-pastor", "asada-maps-to-bistec", "asada-alias-is-the-bistec-option-id", "asada-option-id-covers-spoken-asada", "asada-does-not-cover-a-different-meat", "staff-question-does-not-clear-another-dish", "menudo-corn-default-finalizes-clean", "spoken-tortilla-wins", "quesadilla-without-a-spoken-tortilla-holds", "taco-without-a-spoken-tortilla-holds", "guisado-defaults-to-regular-corn", "mole-defaults-to-regular-corn", "rellenos-defaults-to-regular-corn", "fajitas-elvis-defaults-to-regular-corn", "fajitas-spoken-flour-stays-flour", "extra-tortillas-when-the-caller-asks", "plain-order-does-not-add-extra-tortillas", "caller-yes-adds-the-named-extra", "caller-yes-without-a-type-holds-the-extra", "staff-only-extra-tortillas-are-not-added", "one-other-agua-fresca-resolves", "two-or-more-aguas-frescas-hold", "ordered-landmark-agua-fresca-stays", "al-lado-de-resolves-the-other-agua", "modifier-applied-is-final", "modificador-aplicado-queda-final", "filler-is-not-menu-vocabulary", "relleno-no-es-vocabulario", "missing-salsa-holds", "missing-nopales-holds", "missing-pata-holds", "salsa-already-in-the-cart-does-not-hold", "nopales-already-in-the-cart-does-not-hold", "sour-already-in-the-cart-does-not-hold", "salsita-already-in-the-cart-does-not-hold", "opales-does-not-hold", "razas-does-not-hold", "just-does-not-hold", "papa-and-pata-stay-distinct", "pastor-display-name-covers-alpastor", "frijol-on-frijoles-refritos-does-not-hold", "frijol-on-con-frijoles-does-not-hold", "queso-style-already-selected-does-not-hold", "included-onion-does-not-hold", "spoken-costilla-not-on-the-line-still-holds", "modifier-withdrawn-is-final-without-it", "modificador-retirado-queda-final-sin-el", "side-ordered-is-present-or-held", "lado-pedido-esta-o-queda-en-revision", "missing-spoken-count-holds", "same-meat-two-words-are-covered", "restated-count-is-not-another-order", "extra-tortillas-without-a-type-stay-held", "fiesta-fajitas-tortilla-stays-held", "birria-defaults-to-consome-and-tortillas", "spoken-ounce-size-is-not-a-hold", "single-size-drink-does-not-hold", "unavailable-drink-size-stays-a-mismatch", "flour-menudo-stays-held", "menudo-validation-stays-when-another-reason-remains", "hecha-a-mano-is-comal", "carnita-and-hecha-a-mano-clear-the-taco", "dish-alias-binds-the-meat", "split-list-covers-every-line", "later-order-keeps-its-own-tortilla-hold", "same-number-covers-the-earlier-line", "hecha-mano-without-a-is-comal", "one-spoken-dorada-drops-the-other-meat", "regular-on-another-dish-does-not-keep-the-dorada", "dorada-and-comal-of-the-same-meat-both-stay", "two-people-order-the-identical-dish", "street-and-comal-of-the-same-meat-both-stay", "two-orders-of-the-same-dish-both-stay", "regular-and-deluxe-of-the-same-meat-both-stay", "split-total-covers-each-line", "other-menudo-groups-still-hold", "staff-only-size-stays-held", "yep-accepts-a-steak-readback", "quesadillas-without-a-named-meat-stay-held", "retake-keeps-regular-and-deluxe-of-the-same-meat", "staff-clock-is-not-ready-time", "person-pickup-is-not-togo", "no-tenemos-birria-is-unavailable", "libra-does-not-hold", "c11-menudo-uses-corn-default", "addon-delivery-is-not-pickup", "normal-during-tacos-does-not-add-a-sope", "named-small-sope-still-lands", "c05-counted-hold-cleared", "c07-counted-hold-cleared", "c09-chorizo-clears-the-meat-hold", "staff-no-hay-does-not-add-that-dish", "unspecified-change-adds-and-keeps-the-earlier-line", "leave-earlier-does-not-add-them-again", "cambio-anterior-agrega-y-deja-la-linea", "leave-earlier-intent-adds"]) {
  checks[name] = new RegExp(`PASS ${name}`).test(staffList);
}
const body = {
  sha: execSync("git rev-parse HEAD", { cwd: "/agent/repos/build-an-app-for-the-apple" }).toString().trim(),
  variation_name_source: "frozenPhoneMenu copies sku.name onto variationName while building the committed site-catalog menu. Reconciliation reads that field. It does not look up a Square id again.",
  checks,
  production_gate: productionGate,
  cases,
  printed_ticket: {
    normal_line: printedOnion.map((line) => ({ name: line.name, quantity: line.quantity, notes: line.notes, flag: line.flag })),
    deluxe_line: printedDeluxe.map((line) => ({ name: line.name, quantity: line.quantity, notes: line.notes, flag: line.flag })),
    sin_problema: cases.find((row) => row.id === "sin-problema")!.lines[0]?.elviNotes || [],
  },
  phone_only_prices: {
    menudo_solo_caldo: phone.find((item) => item.squareVariationId === "PYTW56MHJJGL6JKTZGSXGVWQ")?.priceCents,
    aguacate_full: phone.find((item) => item.squareVariationId === "QGR5AQTWVHNW347NOPAKX44U")?.priceCents,
    source: "The two rows are not in site-catalog.json. Their prices are the amounts the phone repairs already speak when a catalog price is missing: Menudo SOLO Caldo 1000 cents, Aguacate FULL 400 cents. They are not zero.",
  },
  runtime_coca: { runtime: runtimeCoca.lines[0]?.itemId || null, frozen: frozenCoca.lines[0]?.itemId || null, name: runtimeRow?.name || null },
};
writeFileSync(outPath, JSON.stringify(body, null, 2));
for (const [id, ok] of Object.entries(checks)) console.log(ok ? "PASS" : "FAIL", id);
if (Object.values(checks).some((ok) => !ok)) process.exit(1);
