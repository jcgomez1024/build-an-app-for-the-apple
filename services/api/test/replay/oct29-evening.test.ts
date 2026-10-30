// Oct 29 evening misses: marta1 CA3f4666, alejandro1 CA6e99c9, osmar1 CA20f62b, efrain1 CAa45bdf.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";
import { staffUnavailable } from "../../src/spoken-ledger.ts";
const T = (k: string) => JSON.parse(readFileSync(new URL(`../fixtures/${k}-turns.json`, import.meta.url), "utf8"));
const stub = async () => ({ reply: "¿Algo más?", actions: [] as any[] });
const opts = (l: any) => (l.modifiers || []).map((m: any) => String(m.option)).join("|");
const units = (c: any[], re: RegExp) => c.filter((l) => re.test(l.itemId)).reduce((n, l) => n + l.quantity, 0);

test("marta1: 3 gorditas prensado con frijoles + 1 side salsa asada 4oz; no phantom gorditas", async () => {
  const r: any = await shadowOrderFromTurns(T("CA3f4666"), stub as any);
  assert.equal(units(r.cart, /gordita/), 3);
  assert.ok(r.cart.filter((l: any) => /gordita/.test(l.itemId)).every((l: any) => /Prensado/.test(opts(l)) && /Con Frijoles/.test(opts(l))));
  const s = r.cart.find((l: any) => /extras/.test(l.itemId));
  assert.ok(s && /4oz/.test(opts(s)) && s.quantity === 1);
});

test("alejandro1: nuditos=gorditas, 6 sin queso over 2 plates, name Alejandro", async () => {
  const t = T("CA6e99c9");
  const r: any = await shadowOrderFromTurns(t, stub as any);
  assert.equal(units(r.cart, /gordita/), 6);
  assert.equal(r.cart.filter((l: any) => /huarache/i.test(l.itemId)).length, 0);
  const g = r.cart.filter((l: any) => /gordita/.test(l.itemId));
  assert.ok(g.every((l: any) => /sin queso/.test(String(l.elviNotes)) && !/Queso Gordita/.test(opts(l))));
  assert.equal(g.filter((l: any) => /plato 2/.test(String(l.elviNotes)) && /con nopales/.test(String(l.elviNotes))).length, 3);
  assert.equal(nameFromTranscriptInfo(t)?.name, "Alejandro");
});

test("osmar1: Osmar 4 comal tacos (2 pastor, 2 cabeza); Ulises 2 tortas pastor sin queso cebollita; group → no memory", async () => {
  const t = T("CA20f62b");
  const r: any = await shadowOrderFromTurns(t, stub as any);
  const tacos = r.cart.filter((l: any) => /taco/.test(l.itemId));
  assert.equal(units(tacos, /./), 4);
  assert.ok(tacos.every((l: any) => /Comal/.test(opts(l)) && l.person === "Osmar Lira"));
  assert.equal(units(tacos.filter((l: any) => /Alpastor/.test(opts(l))), /./), 2);
  assert.equal(units(tacos.filter((l: any) => /Cabeza/.test(opts(l))), /./), 2);
  const tortas = r.cart.filter((l: any) => /torta/.test(l.itemId));
  assert.equal(units(tortas, /./), 2);
  assert.ok(tortas.every((l: any) => /Alpastor/.test(opts(l)) && /Cebolla y Chiles/.test(opts(l)) && /sin queso/.test(String(l.elviNotes)) && l.person === "Ulises Sánchez"));
  assert.ok(!r.cart.some((l: any) => /Bistec/.test(opts(l))));
  assert.deepEqual(r.groups.sort(), ["Osmar Lira", "Ulises Sánchez"]);
  assert.ok((nameFromTranscriptInfo(t)?.group?.length || 0) >= 2);
});

test("efrain1: 2 chiles rellenos queso, arroz y frijoles (más arroz), maíz; staff 'enchiladas hasta mañana' overrides menu; name saved", async () => {
  const t = T("CAa45bdf");
  const r: any = await shadowOrderFromTurns(t, stub as any);
  assert.equal(r.cart.length, 1);
  const c = r.cart[0];
  assert.match(c.itemId, /chiles-rellenos/); assert.equal(c.quantity, 2);
  assert.ok(/QUESO/.test(opts(c)) && /Arroz-Rice and Frijoles/.test(opts(c)) && /Corn Tortilla/.test(opts(c)));
  assert.match(String(c.elviNotes), /más arroz/);
  assert.ok(staffUnavailable(t).includes("enchilada"));
  assert.ok(!r.cart.some((l: any) => /enchilada/.test(l.itemId)));
  assert.equal(nameFromTranscriptInfo(t)?.name, "Efraín");
});

test("update_item never empties a cart (quantity 0 / empty modifiers ignored)", async () => {
  const turns: any[] = [{ speaker: "caller", text: "Una gordita de bistec" }, { speaker: "staff", text: "¿Con queso?" }, { speaker: "caller", text: "Sí" }];
  const script: any = {
    "Una gordita de bistec": { reply: "", actions: [{ type: "add_item", itemId: "sq-gordita-T", quantity: 1, modifiers: [{ step: "", option: "Bistec / Steak" }] }] },
    "Sí": { reply: "", actions: [{ type: "update_item", index: 0, itemId: "sq-gordita-T", quantity: 0 }] },
  };
  const r: any = await shadowOrderFromTurns(turns, async (t: string) => script[t] || { reply: "", actions: [] });
  assert.equal(units(r.cart, /gordita/), 1);
});
