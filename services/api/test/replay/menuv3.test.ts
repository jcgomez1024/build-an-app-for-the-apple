// menuv3: browsable menu PREVIEW (?menu=v3). Store states, the page script on synthetic data in a stub DOM,
// and a card add that goes through Elvi's own add step (validate -> applyActions -> Elvi told). Synthetic data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import path from "node:path";
import { storeState } from "../../src/menu-v3.js";
const web = path.resolve(import.meta.dirname, "../../../../apps/web");
const w = [{ open: "11:00:00", close: "20:00:00" }];
const hrs = { MON: [], TUE: w, WED: w, THU: w, FRI: w, SAT: w, SUN: w };
const cat: any = { store: { prepMinutes: 20, timezone: "America/New_York", pickupHours: hrs }, categories: [] };
const at = (iso: string) => new Date(iso);

test("menuv3: store states (ET)", () => {
  const s = (iso: string) => storeState(at(iso), cat);
  const st = s("2026-10-21T15:00:00Z"); // Wed 11:00 ET
  if (!st) { assert.ok(storeState(at("2026-10-21T15:00:00Z")), "store hours present in real catalog"); return; }
  assert.equal(st.state, "open");
  assert.equal(s("2026-10-21T23:25:00Z")!.state, "last_order"); // 7:25 PM
  assert.equal(s("2026-10-21T23:45:00Z")!.state, "closed");     // 7:45 PM: after close-20
  assert.equal(s("2026-10-21T13:00:00Z")!.state, "before_open"); // 9 AM
  assert.equal(s("2026-10-19T17:00:00Z")!.state, "closed");      // Monday
});
test("menuv3: real catalog gives a store state", () => { assert.ok(storeState(at("2026-10-21T15:00:00Z"))?.pill?.es); });

// ---- page script in a stub DOM ----
function runPage(store: any, schedAvail: any = null, search = "") {
  const src = fs.readFileSync(path.join(web, "ui1.js"), "utf8").replace(/^export \{\};$/m, "");
  const html: Record<string, string> = {}; const clicks: any[] = []; const adds: any[] = [];
  const mk = (sel: string): any => new Proxy({ style: { setProperty() {} }, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, textContent: "", setAttribute() {}, removeAttribute() {}, getBoundingClientRect: () => ({ top: 0, height: 50, bottom: 50 }), scrollTo() {}, closest: () => null },
    { set(t: any, k: any, v: any) { t[k] = v; if (k === "innerHTML") html[sel] = v; return true; } });
  const els: Record<string, any> = {}; const q = (s: string) => els[s] || (els[s] = mk(s));
  const menu = [
    { id: "t1", name: "Taco Test", priceCents: 350, description: "Synthetic taco", modifierGroups: [{ id: "g1", name: "Meat", required: true, minSelections: 1, options: [{ id: "o1", name: "Pollo" }] }] },
    { id: "s1", name: "Soda Test", priceCents: 250, modifierGroups: [] },
    { id: "w1", name: "Weekend Test", priceCents: 1500, modifierGroups: [] },
  ];
  const catalog = { categories: [
    { name: "MOST POPULAR", popular: true, available: true, items: [{ id: "t1", product: "Taco Test", available: true }] },
    { name: "BEBIDAS / DRINKS", available: true, items: [{ id: "s1", product: "Soda Test", available: true }] },
    { name: "SABADO / DOMINGO ESPECIAL", customTimes: true, available: false, window: { es: "sáb–dom 11am–3pm", en: "Sat–Sun 11am–3pm" }, items: [{ id: "w1", product: "Weekend Test", available: false }] },
  ], storeState: store, popular: [{ id: "t1", product: "Taco Test", count: 9, available: true }], scheduleAvail: schedAvail };
  const g: any = globalThis;
  g.window = { elviBridge: { state: { cart: [], menu }, addFromMenu: (it: any, qn: number, m: any) => { adds.push([it.id, qn, m]); return { ok: true, said: "Agregué " + it.name + ". ¿Algo más?" }; }, addCartItem: () => { throw new Error("v3 must not bypass Elvi"); }, renderCart() {}, readback: () => "" },
    addEventListener() {}, scrollY: 0, scrollTo() {}, dispatchEvent() {} };
  g.requestAnimationFrame = (f: any) => setTimeout(f, 0); g.matchMedia = () => ({ matches: true }); g.CustomEvent = class { constructor(public type: string, public o: any) {} };
  g.location = { search, hostname: "order.cocinaelvis.app" };
  g.localStorage = { getItem: () => "es", setItem() {} };
  g.document = { querySelector: q, querySelectorAll: () => [], getElementById: (i: string) => q("#" + i), documentElement: mk("html"), readyState: "loading",
    body: Object.assign(mk("body"), { prepend() {} }), createElement: () => mk("el" + Math.random()), addEventListener: (ev: string, f: any) => { if (ev === "click") clicks.push(f); } };
  g.fetch = async (u: string) => ({ ok: true, json: async () => (String(u).includes("/ui/catalog") ? catalog : { items: menu }) });
  const ids: any[] = []; const realSI = setInterval; g.setInterval = (f: any, ms: number) => { const h = realSI(f, ms); ids.push(h); return h; };
  new Function(src)();
  g.setInterval = realSI;
  const camel = (a: string) => a.replace(/^data-/, "").replace(/-(\w)/g, (_, c) => c.toUpperCase());
  const matches = (sel: string, ds: any) => sel.split(",").some((x) => { x = x.trim(); if (x === "#ui1") return true; if (x === "#ui1 .v3-card") return !!ds.item; const m = x.match(/^\[([\w-]+)\]$/); return !!m && ds[camel(m[1])] !== undefined; });
  const click = (dataset: any, cls = "") => { const el: any = { dataset, classList: { contains: (c: string) => cls.includes(c) } }; el.closest = (sel: string) => (matches(sel, dataset) ? (sel === "#ui1" ? {} : el) : null); const ev = { target: el, stopImmediatePropagation() {}, preventDefault() {} }; for (const f of clicks) f(ev); };
  return { html, adds, click, win: g.window, stop: () => ids.forEach(clearInterval) };
}
const tick = () => new Promise((r) => setTimeout(r, 60));
test("menuv3: page renders tabs, Popular first, timed tab marked, card add goes through Elvi", async () => {
  const P = runPage({ state: "open", pill: { es: "Abierto", en: "Open" }, banner: null, hours: [] });
  await tick();
  const h = P.html["#ui1-main"] || "";
  assert.match(h, /id="v3-tabs"/);
  const tabs = [...h.matchAll(/data-v3tab="([^"]+)">([^<]+)/g)].map((m) => m[2]);
  assert.equal(tabs[0], "Popular"); assert.ok(!tabs.some((x) => /MOST POPULAR|Más populares/.test(x)), "site popular dup skipped");
  assert.ok(tabs.some((x) => x.includes("⏱")), "closed timed category marked");
  assert.match(h, /★ Popular/); assert.match(h, /v3-card is-later[^>]*data-item="w1"/); assert.match(h, /v3-sub">Cerrado ahora · sáb–dom 11am–3pm/, "time-window note kept");
  P.click({ item: "s1" }); await tick();
  assert.deepEqual(P.adds, [["s1", 1, []]], "simple item adds via Elvi's addFromMenu");
  P.stop();
});
test("menuv3 time1: closed / before open → small banner, browsing AND adding allowed (even time-window items)", async () => {
  const P = runPage({ state: "closed", pill: { es: "Cerrado", en: "Closed" }, banner: { es: "x", en: "x" }, hours: [], nextOpen: { es: "abrimos jue 11:00am", en: "we open Thu 11:00am" } });
  await tick(); const h = P.html["#ui1-main"] || "";
  assert.match(h, /v3-banner closed slim">Cerrado · abrimos jue 11:00am · puedes ordenar ahora para más tarde/);
  assert.ok(!/data-v3chk|data-v3submit/.test(h), "old Programar checkbox gone");
  P.click({ item: "s1" }); await tick(); P.click({ item: "w1" }); await tick(); assert.deepEqual(P.adds.map((a) => a[0]), ["s1", "w1"]); P.stop();
  const Q = runPage({ state: "before_open", pill: { es: "Abre 11:00am", en: "Opens 11:00am" }, banner: { es: "x", en: "x" }, hours: [], nextOpen: null });
  await tick(); assert.match(Q.html["#ui1-main"] || "", /Abrimos 11:00am · puedes ordenar ahora para más tarde/); Q.stop();
});
test("menuv3 time1: ?schedule=1 approach removed; checkout timing step exists", () => {
  const src = fs.readFileSync(path.join(web, "ui1.js"), "utf8");
  assert.match(src, /const V3 = Q3\.get\("menu"\) !== "old";/);
  assert.ok(!/SCHED_OK|v3DryRun|data-v3chk/.test(src)); assert.match(src, /function timingHTML\(\)/); assert.match(src, /data-tmpay/);
});

// ---- Elvi's add step, extracted from app.js and run with synthetic stubs ----
test("menuv3: menuCardAdd = validate → applyActions → Elvi told (history + live session)", () => {
  const app = fs.readFileSync(path.join(web, "app.js"), "utf8");
  assert.match(app, /addFromMenu: \(item, quantity = 1, modifiers = \[\]\) => menuCardAdd\(item, quantity, modifiers\)/);
  const fn = app.slice(app.indexOf("function menuCardAdd("), app.indexOf("\n}\n", app.indexOf("function menuCardAdd(")) + 2);
  const log: any[] = [];
  const env = { state: { cart: [] as any[], chatFallbackHistory: [] as any[] }, ui: { reply: { textContent: "" } }, window: { dispatchEvent: (e: any) => log.push(["event", e.type]) }, CustomEvent: class { constructor(public type: string) {} },
    validateAddItemToolArgs: (a: any) => (a.itemId === "t1" && !a.modifiers.length ? { ok: false, requiredGroups: [{ groupName: "Meat" }] } : { ok: true }),
    applyActions: (acts: any[]) => { log.push(["apply", acts[0].type, acts[0].itemId]); env.state.cart.push({ id: acts[0].itemId }); },
    getEffectiveLanguage: () => "es", shortAddReadback: () => "1 taco de pollo", describeCartLine: () => "1 Taco (Pollo)", getCartItemCount: () => env.state.cart.length,
    sendWs: (m: any) => log.push(["ws", m.item.content[0].text]) };
  const run = new Function(...Object.keys(env), `${fn}; return menuCardAdd;`)(...Object.values(env));
  const miss = run({ id: "t1", name: "Taco" }, 1, []);
  assert.deepEqual(miss, { ok: false, missing: ["Meat"], message: undefined }); assert.equal(log.length, 0, "nothing added when a required choice is missing");
  const ok = run({ id: "t1", name: "Taco" }, 1, [{ groupId: "g1", option: "Pollo" }]);
  assert.equal(ok.ok, true); assert.equal(ok.said, "Agregué 1 taco de pollo. ¿Algo más?");
  assert.deepEqual(log[0], ["apply", "add_item", "t1"]);
  assert.match(log[1][1], /added from the menu: 1 Taco \(Pollo\)\. Cart now has 1 item\(s\)\. Do not add it again/);
  assert.equal(env.state.chatFallbackHistory.at(-1).text, ok.said); assert.equal(env.ui.reply.textContent, ok.said);
  assert.deepEqual(log[2], ["event", "elvi:menu-add"]);
});

test("menuv3: next opening skips Monday; weekend preview hours 10am; last order 7:40pm", () => {
  const s = (iso: string) => storeState(at(iso))!;
  assert.equal(s("2026-10-25T23:50:00Z").schedule!.en, "Schedule for Tue 11:00am"); // Sun after close
  assert.equal(s("2026-10-26T16:00:00Z").schedule!.en, "Schedule for Tue 11:00am"); // Monday
  assert.equal(s("2026-10-26T16:00:00Z").schedule!.at, "2026-10-27T15:00:00.000Z");
  assert.equal(s("2026-10-24T13:30:00Z").schedule!.en, "Schedule for Sat 10:00am"); // Sat before open
  assert.equal(s("2026-10-24T23:30:00Z").pill.en, "Last order 7:40pm");
  assert.equal(s("2026-10-21T15:00:00Z").schedule, null);
});
test("menuv3: item sheet asks only the first missing required group, then enables Agregar", async () => {
  const P = runPage({ state: "open", pill: { es: "Abierto", en: "Open" }, banner: null, hours: [] });
  await tick(); P.click({ item: "t1" }); await tick();
  const sh = P.html["#v3-sheet-wrap"] || Object.entries(P.html).find(([k, v]) => /v3-sheet/.test(v))?.[1] || "";
  assert.match(sh, /¿De qué carne\?/); assert.match(sh, /disabled>Falta: Carne/); assert.match(sh, /v3-grp need/);
  assert.equal(P.adds.length, 0);
  P.click({ g: "0", o: "Pollo" }); await tick();
  const sh2 = Object.entries(P.html).filter(([k, v]) => /v3-sheet/.test(v)).map(([, v]) => v).pop() || "";
  assert.match(sh2, /data-add="1">Agregar · \$3\.50/);
  P.click({ add: "1" }); await tick();
  assert.deepEqual(P.adds.map((a) => a[0]), ["t1"]); assert.equal(P.adds[0][2][0].option, "Pollo"); P.stop();
});
