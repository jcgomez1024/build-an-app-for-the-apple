import assert from "node:assert/strict";
import test from "node:test";
import { applyAffirmedStaffList, applyLineScopedQuantity, applyReadbackCounts, applyStaffReadback, liveMeatSplitQty, parseList, pruneQuantityFlags, repeatLastFood } from "../../src/list-repair.ts";
import { applyStaffOrderCount } from "../../src/readback-pass.ts";
import { callerSpokenQty, peelAnother, staffQuantity } from "../../src/caller-count.ts";
import { ambiguousMakeIt, ambiguousMore, applyMakeItNMerge, lineMeatRe, openLineKeys } from "../../src/modifier-turns.ts";
import { isAbandonedOrder, isAbandonTurn } from "../../src/readback-pass.ts";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { frozenPhoneMenu } from "../../src/phone-menu.ts";

const menu = frozenPhoneMenu();

test("a shadow staff readback does not add lines the cart does not have", () => {
  const cart: any[] = [];
  const turns = [
    { speaker: "caller", text: "Quiero ordenar." },
    { speaker: "staff", text: "Te tengo tres tacos de pastor y dos quesadillas de bistec." },
  ];
  applyStaffReadback(cart, turns, menu, true);
  assert.equal(cart.length, 0);
  const live: any[] = [];
  applyStaffReadback(live, turns, menu, false);
  assert.equal(live.length, 2);
});

test("comalde is parsed for the shadow list and left alone by a live helper", () => {
  const listed = parseList("las tres quesadillas de comalde tripa");
  assert.equal(listed.find((line) => line.meat === "tripa")?.style, "comal");
  const live = liveMeatSplitQty({
    actions: [
      { type: "add_item", itemId: "sq-quesadilla-HLT6CR", quantity: 3, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Tripa / Beef Tripe (+$0.50)" }] },
      { type: "add_item", itemId: "sq-quesadilla-HLT6CR", quantity: 2, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] },
    ],
  }, { transcript: "tres quesadillas de comalde tripa y dos de bistec" });
  assert.equal(live.actions[0].quantity, 3);
  assert.equal(live.actions[1].quantity, 2);
});

test("comalde parses as comal and a real style mismatch stays flagged", () => {
  const agreed = applyAffirmedStaffList([], [
    { speaker: "caller", text: "Tres quesadillas al comal de tripa." },
    { speaker: "staff", text: "Dos quesadillas de harina de biste, y una quesadilla de harina de chorizo, y las tres quesadillas de comalde tripa." },
    { speaker: "caller", text: "Sí, cierto." },
  ], menu);
  assert.equal(agreed.flagged.includes("style:sq-quesadilla-HLT6CR"), false, JSON.stringify(agreed.flagged));
  const clash = applyAffirmedStaffList([], [
    { speaker: "caller", text: "Tres quesadillas de harina de tripa." },
    { speaker: "staff", text: "Las tres quesadillas de comal de tripa." },
    { speaker: "caller", text: "Sí, cierto." },
  ], menu);
  assert.ok(clash.flagged.includes("style:sq-quesadilla-HLT6CR"), JSON.stringify(clash.flagged));
});

test("two more adds when this turn's model record did not apply it", () => {
  const line = () => ({ itemId: "sq-taco-TAR7L5", quantity: 3, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }] });
  const en = [line()];
  const es = [line()];
  applyLineScopedQuantity(en, [{ speaker: "caller", text: "Two more tacos of chorizo." }]);
  applyLineScopedQuantity(es, [{ speaker: "caller", text: "Dos tacos más de chorizo." }]);
  assert.equal(en[0].quantity, 5);
  assert.equal(es[0].quantity, 5);
  const applied = [line()];
  applied[0].quantity = 4;
  applyLineScopedQuantity(applied, [{ speaker: "caller", text: "Two more tacos of chorizo.", modelQty: [{ itemId: "sq-taco-TAR7L5", option: "Chorizo / Mexican Sausage", before: 2, after: 4 }] } as any]);
  assert.equal(applied[0].quantity, 4);
});

test("two separate two-more turns add twice", () => {
  const cart = [{ itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }] }];
  applyLineScopedQuantity(cart, [
    { speaker: "caller", text: "Two more tacos of chorizo." },
    { speaker: "caller", text: "Two more tacos of chorizo." },
  ]);
  assert.equal(cart[0].quantity, 6);
});

test("otros dos and a trailing más add, EN and ES", () => {
  const line = () => ({ itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }] });
  const en = [line()];
  const es = [line()];
  const esTrail = [line()];
  applyLineScopedQuantity(en, [{ speaker: "caller", text: "Another two tacos of chorizo." }]);
  applyLineScopedQuantity(es, [{ speaker: "caller", text: "Otros dos tacos de chorizo." }]);
  applyLineScopedQuantity(esTrail, [{ speaker: "caller", text: "Dos tacos de chorizo más." }]);
  assert.equal(en[0].quantity, 4);
  assert.equal(es[0].quantity, 4);
  assert.equal(esTrail[0].quantity, 4);
});

test("a leading más un adds or stays, and never resets a line at 2", () => {
  const open = [{ itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }] }];
  applyLineScopedQuantity(open, [{ speaker: "caller", text: "Más un taco de chorizo." }]);
  assert.equal(open[0].quantity, 3);
  const kept = [
    { itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }] },
    { itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Pollo / Chicken" }] },
  ];
  applyLineScopedQuantity(kept, [{ speaker: "caller", text: "Más un taco de harina de pollo.", modelQty: [{ itemId: "sq-taco-TAR7L5", option: "Pollo / Chicken", before: 0, after: 1 }] } as any]);
  assert.equal(kept[0].quantity, 2);
  assert.equal(kept[1].quantity, 1);
});

test("a restated más una coca adds no second coke", () => {
  const cart = [
    { itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }] },
    { itemId: "sq-drink-coca-cola-JJE4KC", quantity: 1, modifiers: [] },
  ];
  applyLineScopedQuantity(cart, [{ speaker: "caller", text: "Entonces son dos tacos de chorizo más una coca." }]);
  assert.equal(cart.length, 2);
  assert.equal(cart[0].quantity, 2);
  assert.equal(cart[1].quantity, 1);
});

test("más una coca de dieta adds no regular coke", () => {
  const cart = [{ itemId: "sq-drink-diet-coca-cola-ZOE5GZ", quantity: 1, modifiers: [] }];
  applyLineScopedQuantity(cart, [{ speaker: "caller", text: "Más una coca de dieta." }]);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].itemId, "sq-drink-diet-coca-cola-ZOE5GZ");
  assert.equal(cart.some((row) => row.itemId === "sq-drink-coca-cola-JJE4KC"), false);
});

test("otra de bistec in its own turn after a quesadilla adds no taco", () => {
  const cart = [{ itemId: "sq-quesadilla-HLT6CR", quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Chorizo / Mexican Sausage" }] }];
  applyLineScopedQuantity(cart, [
    { speaker: "caller", text: "Una quesadilla de chorizo." },
    { speaker: "caller", text: "Y otra de bistec." },
  ]);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].itemId, "sq-quesadilla-HLT6CR");
  assert.equal(cart[0].quantity, 1);
});

test("shadow scoring adds two more when the turn record shows the model applied nothing", async () => {
  const chorizo = { step: "(B) Q Carnes / Meats", option: "Chorizo / Mexican Sausage" };
  const run: any = async (text: string) => {
    const spoken = text.toLowerCase();
    if (/more|m[aá]s/.test(spoken)) return { actions: [], reply: "ok" };
    if (/chorizo/.test(spoken)) return { actions: [{ type: "add_item", itemId: "sq-gordita-M647RE", quantity: 3, modifiers: [chorizo] }], reply: "ok" };
    return { actions: [], reply: "ok" };
  };
  run.menu = () => menu;
  const order: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, language: "en", text: "Three gorditas of chorizo." },
    { speaker: "staff", start: 1, end: 2, language: "en", text: "Ok." },
    { speaker: "caller", start: 3, end: 4, language: "en", text: "Two more gorditas of chorizo." },
  ] as any, run);
  const lines = (order.cart || []).filter((line: any) => line.itemId === "sq-gordita-M647RE" && (line.modifiers || []).some((mod: any) => /chorizo/i.test(String(mod.option))));
  assert.equal(lines.length, 1, JSON.stringify(order.cart));
  assert.equal(lines[0].quantity, 5);
});

test("shadow scoring keeps a two-more add the turn already applied", async () => {
  const chorizo = { step: "(B) Q Carnes / Meats", option: "Chorizo / Mexican Sausage" };
  const run: any = async (text: string) => {
    const spoken = text.toLowerCase();
    if (/m[aá]s|more/.test(spoken)) return { actions: [{ type: "update_item", itemId: "sq-gordita-M647RE", quantity: 4 }], reply: "ok" };
    if (/chorizo/.test(spoken)) return { actions: [{ type: "add_item", itemId: "sq-gordita-M647RE", quantity: 2, modifiers: [chorizo] }], reply: "ok" };
    return { actions: [], reply: "ok" };
  };
  run.menu = () => menu;
  const order: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, language: "es", text: "Chorizo, por favor." },
    { speaker: "staff", start: 1, end: 2, language: "es", text: "Ok." },
    { speaker: "caller", start: 3, end: 4, language: "es", text: "Dos gorditas más de chorizo." },
  ] as any, run);
  const lines = (order.cart || []).filter((line: any) => line.itemId === "sq-gordita-M647RE" && (line.modifiers || []).some((mod: any) => /chorizo/i.test(String(mod.option))));
  assert.equal(lines.length, 1, JSON.stringify(order.cart));
  assert.equal(lines[0].quantity, 4);
});

test("confirm-only shadow readback stays off unless the flag is set", () => {
  const line = () => ({ itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }, { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" }] });
  const bistec = () => ({ itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }, { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" }] });
  const turns = [{ speaker: "staff", text: "Te tengo seis tacos de chorizo y tres tacos de bistec." }];
  const previous = process.env.ELVI_SHADOW_READBACK_CONFIRM_ONLY;
  delete process.env.ELVI_SHADOW_READBACK_CONFIRM_ONLY;
  const off = [line(), bistec()];
  applyStaffReadback(off, turns, menu, true);
  assert.equal(off[0].quantity, 2);
  assert.equal(off[1].quantity, 1);
  assert.ok((off as any).readbackFlags.some((flag: string) => flag.startsWith("quantity:")));
  process.env.ELVI_SHADOW_READBACK_CONFIRM_ONLY = "1";
  const on = [line(), bistec()];
  applyStaffReadback(on, turns, menu, true);
  assert.equal(on[0].quantity, 2);
  assert.equal(on[1].quantity, 1);
  assert.ok((on as any).readbackFlags.some((flag: string) => flag.startsWith("quantity:")));
  const live = [line(), bistec()];
  applyStaffReadback(live, turns, menu, false);
  assert.equal(live[0].quantity, 2);
  assert.equal(live[1].quantity, 1);
  if (previous === undefined) delete process.env.ELVI_SHADOW_READBACK_CONFIRM_ONLY;
  else process.env.ELVI_SHADOW_READBACK_CONFIRM_ONLY = previous;
});

test("nada más and anything else change nothing", () => {
  const line = () => ({ itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }] });
  for (const text of ["Nada más.", "Algo más.", "Nothing more.", "Anything else."]) {
    const cart = [line()];
    applyLineScopedQuantity(cart, [{ speaker: "caller", text }]);
    assert.equal(cart[0].quantity, 2, text);
  }
});

test("N more adds to the line instead of replacing it, EN and ES", () => {
  const line = () => ({ itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }] });
  const en = [line()];
  const es = [line()];
  applyLineScopedQuantity(en, [{ speaker: "caller", text: "Two more tacos of chorizo." }]);
  applyLineScopedQuantity(es, [{ speaker: "caller", text: "Dos tacos más de chorizo." }]);
  assert.equal(en[0].quantity, 4);
  assert.equal(es[0].quantity, 4);
});

test("a later count changes only the named line", () => {
  const cart = [
    { itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }] },
    { itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }] },
  ];
  applyLineScopedQuantity(cart, [
    { speaker: "caller", text: "Six tacos of chorizo." },
    { speaker: "caller", text: "Seis tacos de chorizo." },
  ]);
  assert.equal(cart[0].quantity, 1);
  assert.equal(cart[1].quantity, 6);
});

function itemOffering(kind: RegExp, meat: RegExp) {
  return menu.find((item) => kind.test(item.id) && (item.modifierGroups || []).some((group) => (group.options || []).some((choice) => meat.test(typeof choice === "string" ? choice : String(choice.name || "")))));
}

function shadowRun(answer: (text: string) => { actions: any[]; reply: string }) {
  const run: any = async (text: string) => answer(text);
  run.menu = () => menu;
  return run;
}

test("otra after a quesadilla repeats that quesadilla with the named meat", async () => {
  const order: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, language: "es", text: "Una quesadilla de harina de chorizo." },
    { speaker: "staff", start: 1, end: 2, language: "es", text: "Ok." },
    { speaker: "caller", start: 3, end: 4, language: "es", text: "Y otra de bistec." },
  ] as any, shadowRun((text) => /otra/i.test(text)
    ? { actions: [{ type: "add_item", itemId: "sq-not-a-guess", quantity: 1 }], reply: "guess" }
    : { actions: [{ type: "add_item", itemId: "sq-quesadilla-HLT6CR", quantity: 1, modifiers: [{ step: "(A) Q Tortilla Options", option: "(QHR) Quesadilla Harina / Flour (+$0.75)" }, { step: "(B) Q Carnes / Meats", option: "Chorizo / Mexican Sausage" }] }], reply: "ok" }));
  const lines = (order.cart || []).filter((line: any) => line.itemId === "sq-quesadilla-HLT6CR");
  assert.equal(lines.length, 2, JSON.stringify(order.cart));
  assert.equal(lines[1].quantity, 1);
  assert.match(JSON.stringify(lines[1].modifiers), /Harina/);
  assert.match(JSON.stringify(lines[1].modifiers), /Bistec/);
  const added = lines[1].modifiers.find((mod: any) => /bistec/i.test(String(mod.option)));
  const catalog = menu.find((item) => item.id === "sq-quesadilla-HLT6CR");
  const expected = (catalog?.modifierGroups || []).flatMap((group) => group.options || []).find((choice) => (typeof choice === "string" ? choice : choice.name) === added.option);
  assert.equal(added.optionId, typeof expected === "string" ? "" : expected?.id);
  assert.match((order.steps || []).map((step: any) => step.reply).join(" "), /Ok, otra quesadilla de bistec, ¿verdad\?/);
});

test("otra after a taco repeats that taco", async () => {
  const order: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, language: "es", text: "Un taco de chorizo." },
    { speaker: "staff", start: 1, end: 2, language: "es", text: "Ok." },
    { speaker: "caller", start: 3, end: 4, language: "es", text: "Otra de bistec." },
  ] as any, shadowRun((text) => /otra/i.test(text)
    ? { actions: [{ type: "add_item", itemId: "sq-not-a-guess", quantity: 1 }], reply: "guess" }
    : { actions: [{ type: "add_item", itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" }, { step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }] }], reply: "ok" }));
  const lines = (order.cart || []).filter((line: any) => line.itemId === "sq-taco-TAR7L5");
  assert.equal(lines.length, 2, JSON.stringify(order.cart));
  assert.match(JSON.stringify(lines[1].modifiers), /Street|Taquero/);
  assert.match(JSON.stringify(lines[1].modifiers), /Bistec/);
  assert.match((order.steps || []).map((step: any) => step.reply).join(" "), /Ok, otro taco de bistec, ¿verdad\?/);
});

test("another after a torta repeats that torta in English", async () => {
  const torta = itemOffering(/^sq-torta-/, /bistec|steak/i);
  assert.ok(torta, "frozen menu has a torta with steak");
  const steak = (torta.modifierGroups || []).flatMap((group) => (group.options || []).map((choice) => ({ group, choice }))).find((row) => /steak|bistec/i.test(typeof row.choice === "string" ? row.choice : String(row.choice.name || "")));
  const option = typeof steak.choice === "string" ? steak.choice : steak.choice.name;
  const order: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, language: "en", text: "One chorizo torta." },
    { speaker: "staff", start: 1, end: 2, language: "en", text: "Ok." },
    { speaker: "caller", start: 3, end: 4, language: "en", text: "Another steak." },
  ] as any, shadowRun((text) => /another/i.test(text)
    ? { actions: [{ type: "add_item", itemId: "sq-not-a-guess", quantity: 1 }], reply: "guess" }
    : { actions: [{ type: "add_item", itemId: torta.id, quantity: 1, modifiers: [{ step: steak.group.name, option }] }], reply: "ok" }));
  const lines = (order.cart || []).filter((line: any) => line.itemId === torta.id);
  assert.equal(lines.length, 2, JSON.stringify(order.cart));
  assert.match(JSON.stringify(lines[1].modifiers), /Steak|Bistec/);
  assert.match((order.steps || []).map((step: any) => step.reply).join(" "), /Ok, another steak torta, right\?/);
});

test("otra with a meat the last item does not offer falls back", async () => {
  const order: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, language: "es", text: "Una quesadilla de chorizo." },
    { speaker: "staff", start: 1, end: 2, language: "es", text: "Ok." },
    { speaker: "caller", start: 3, end: 4, language: "es", text: "Y otra de pulpo." },
  ] as any, shadowRun((text) => /quesadilla/i.test(text)
    ? { actions: [{ type: "add_item", itemId: "sq-quesadilla-HLT6CR", quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Chorizo / Mexican Sausage" }] }], reply: "ok" }
    : { actions: [], reply: "¿De qué?" }));
  assert.equal((order.cart || []).length, 1, JSON.stringify(order.cart));
  assert.match((order.steps || []).map((step: any) => step.reply).join(" "), /¿Otra de pulpo de cuál platillo\?/);
  assert.equal((order.cart || []).some((line: any) => line.itemId === "sq-not-a-guess"), false);
});

test("caller count 1 stays when staff reads back 3", () => {
  const cart = [
    { itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }, { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" }] },
    { itemId: "sq-quesadilla-HLT6CR", quantity: 2, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Chorizo / Mexican Sausage" }] },
  ];
  applyStaffReadback(cart, [
    { speaker: "caller", text: "Un taco de bistec y dos quesadillas de chorizo." },
    { speaker: "staff", text: "Te tengo tres tacos de bistec y dos quesadillas de chorizo." },
  ], menu, true);
  assert.equal(cart[0].quantity, 1);
  assert.equal(cart[1].quantity, 2);
  assert.ok((cart as any).readbackFlags.some((flag: string) => flag === `quantity:${cart[0].itemId}`));
});

test("a matching staff readback still updates the tortilla", () => {
  const cart = [
    { itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }, { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" }] },
    { itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }, { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" }] },
  ];
  applyStaffReadback(cart, [
    { speaker: "caller", text: "Dos tacos de chorizo y un taco de bistec." },
    { speaker: "staff", text: "Te tengo dos tacos de comal de chorizo y un taco de bistec." },
  ], menu, true);
  assert.equal(cart[0].quantity, 2);
  assert.equal(cart[1].quantity, 1);
  assert.match(JSON.stringify(cart[0].modifiers), /Comal/);
  assert.equal((cart as any).readbackFlags, undefined);
});

test("a readback that matches the caller corrects a wrong cart", () => {
  const cart = [
    { itemId: "sq-torta-4GNTTE", quantity: 2, modifiers: [{ step: "(B) Torta Carne Options", option: "Bistec / Steak" }] },
    { itemId: "sq-torta-4GNTTE", quantity: 1, modifiers: [{ step: "(B) Torta Carne Options", option: "Alpastor / Roasted Pork" }] },
    { itemId: "sq-torta-4GNTTE", quantity: 1, modifiers: [{ step: "(B) Torta Carne Options", option: "Bistec / Steak" }] },
  ];
  applyReadbackCounts(cart, [
    { speaker: "caller", text: "Me pondría dos tortas, una de bistec y una de pastor." },
    { speaker: "caller", text: "Me pone unas dos igual, una y una." },
    { speaker: "caller", text: "Otra orden igual." },
    { speaker: "staff", text: "Entonces te tengo dos tortas de bistec y dos tortas de al pastor." },
  ]);
  const sig = cart.map((line) => `${line.quantity} ${line.modifiers.map((mod) => mod.option).join("+")}`).sort();
  assert.deepEqual(sig, ["2 Alpastor / Roasted Pork", "2 Bistec / Steak"]);
  assert.equal((cart as any).readbackFlags, undefined);
});

test("comal and dorada of the same meat keep separate counts", () => {
  const cart = [
    { itemId: "sq-quesadilla-HLT6CR", quantity: 6, modifiers: [{ step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" }, { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] },
    { itemId: "sq-qd-quesadilla-dorada-qd-regular-dorada-T5STUH", quantity: 1, modifiers: [{ step: "(QD) Quesadilla Dorada options", option: "(QD) REGULAR Dorada" }, { step: "(B) QD Carnes / Meats", option: "Bistec / Steak" }] },
  ];
  applyStaffReadback(cart, [
    { speaker: "caller", text: "Tres quesadillas de bistec de comal y una quesadilla de bistec dorada." },
    { speaker: "staff", text: "Te tengo tres quesadillas de comal de biste y una quesadilla dorada de biste." },
  ], menu, true);
  assert.equal(cart[0].quantity, 3);
  assert.equal(cart[1].quantity, 1);
  assert.equal((cart as any).readbackFlags, undefined);
});

test("a bare quesadilla count carries onto the next meat turn", () => {
  const cart = [
    { itemId: "sq-qd-quesadilla-dorada-qd-deluxe-preparada-T5STUH", quantity: 2, modifiers: [{ step: "(QD) Quesadilla Dorada options", option: "(QD) DELUXE Preparada" }, { step: "(B) QD Carnes / Meats", option: "Prensado / Spicy Pork" }] },
    { itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }, { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" }] },
  ];
  applyStaffReadback(cart, [
    { speaker: "caller", text: "Una quesadilla" },
    { speaker: "caller", text: "preparada de chicharrón prensado." },
    { speaker: "caller", text: "Y dos tacos de bistec." },
    { speaker: "staff", text: "Te tengo una quesadilla preparada de prensado y dos tacos de bistec." },
  ], menu, true);
  assert.equal(cart[0].quantity, 1);
  assert.equal(cart[1].quantity, 2);
});

test("Two? followed by Yep is the caller's count", () => {
  const cart = [
    { itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }, { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" }] },
    { itemId: "sq-quesadilla-HLT6CR", quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Chorizo / Mexican Sausage" }] },
  ];
  applyStaffReadback(cart, [
    { speaker: "caller", text: "Steak tacos." },
    { speaker: "staff", text: "Two?" },
    { speaker: "caller", text: "Yep." },
    { speaker: "staff", text: "Te tengo dos tacos de bistec y una quesadilla de chorizo." },
  ], menu, true);
  assert.equal(cart[0].quantity, 2);
  assert.equal(cart[1].quantity, 1);
});

test("¿Dos? followed by sí is the caller's count", () => {
  const cart = [
    { itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }, { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" }] },
    { itemId: "sq-quesadilla-HLT6CR", quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Chorizo / Mexican Sausage" }] },
  ];
  applyStaffReadback(cart, [
    { speaker: "caller", text: "Tacos de bistec." },
    { speaker: "staff", text: "¿Dos?" },
    { speaker: "caller", text: "Sí." },
    { speaker: "staff", text: "Te tengo dos tacos de bistec y una quesadilla de chorizo." },
  ], menu, true);
  assert.equal(cart[0].quantity, 2);
});

test("a full readback confirmed with sí does not replace the caller's count", () => {
  const cart = [
    { itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }, { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" }] },
    { itemId: "sq-quesadilla-HLT6CR", quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Chorizo / Mexican Sausage" }] },
  ];
  applyStaffReadback(cart, [
    { speaker: "caller", text: "Un taco de bistec y una quesadilla de chorizo." },
    { speaker: "staff", text: "Te tengo tres tacos de bistec y una quesadilla de chorizo, ¿correcto?" },
    { speaker: "caller", text: "Sí." },
  ], menu, true);
  assert.equal(cart[0].quantity, 1);
  assert.ok((cart as any).readbackFlags.some((flag: string) => flag === `quantity:${cart[0].itemId}`));
});

test("a staff count question answered no changes nothing", () => {
  const cart = [
    { itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }, { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" }] },
    { itemId: "sq-quesadilla-HLT6CR", quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Chorizo / Mexican Sausage" }] },
  ];
  applyStaffReadback(cart, [
    { speaker: "caller", text: "Tacos de bistec y una quesadilla de chorizo." },
    { speaker: "staff", text: "¿Dos?" },
    { speaker: "caller", text: "No." },
    { speaker: "staff", text: "Te tengo dos tacos de bistec y una quesadilla de chorizo." },
  ], menu, true);
  assert.equal(cart[0].quantity, 1);
  assert.equal(cart[1].quantity, 1);
});

test("dorada preparada and deluxe are the same count", () => {
  const cart = [
    { itemId: "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L", quantity: 1, modifiers: [{ step: "(QD) Quesadilla Dorada options", option: "(QD) DELUXE Preparada" }, { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] },
    { itemId: "sq-quesadilla-HLT6CR", quantity: 2, modifiers: [{ step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" }, { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] },
  ];
  applyStaffReadback(cart, [
    { speaker: "caller", text: "Una quesadilla dorada preparada de bistec." },
    { speaker: "caller", text: "Y dos quesadillas de comal de bistec." },
    { speaker: "staff", text: "Te tengo una quesadilla deluxe de bistec y dos quesadillas de comal de bistec." },
  ], menu, true);
  assert.equal(cart[0].quantity, 1);
  assert.equal(cart[1].quantity, 2);
  assert.equal((cart as any).readbackFlags, undefined);
});

test("a quantity flag on a replaced line is pruned", () => {
  const cart = [
    { itemId: "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L", quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Tripa / Beef Tripe" }] },
  ];
  const flags = pruneQuantityFlags(cart, [
    "quantity:sq-qd-quesadilla-dorada-qd-regular-dorada-T5STUH",
    "quantity:sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L",
    "meat:sq-qd-quesadilla-dorada-qd-regular-dorada-T5STUH",
    "missing:quesadilla:tripa",
    "meat:sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L",
  ]);
  assert.deepEqual(flags, [
    "quantity:sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L",
    "meat:sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L",
  ]);
});

test("me puede poner N applies when the staff readback repeats it", () => {
  const cart = [{ itemId: "sq-pozole-rojo-red-pozole-DQ7X4J", quantity: 1, modifiers: [] }];
  applyStaffOrderCount(cart, [
    { speaker: "caller", text: "Ya tienen pozole." },
    { speaker: "caller", text: "¿Me puede poner cuatro, por favor?" },
    { speaker: "staff", text: "Serían cuatro pozoles." },
    { speaker: "caller", text: "Sí." },
  ]);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 4);
  assert.equal((cart as any).readbackFlags, undefined);
});

test("otra with no prior item asks which dish", async () => {
  const order: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, language: "es", text: "Otra de bistec." },
  ] as any, shadowRun(() => ({ actions: [], reply: "guess" })));
  assert.equal((order.cart || []).length, 0);
  assert.match((order.steps || []).map((step: any) => step.reply).join(" "), /¿Otra de bistec de cuál platillo\?/);
});

test("another with no prior item asks which dish in English", async () => {
  const order: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, language: "en", text: "Another steak." },
  ] as any, shadowRun(() => ({ actions: [], reply: "guess" })));
  assert.equal((order.cart || []).length, 0);
  assert.match((order.steps || []).map((step: any) => step.reply).join(" "), /Another steak of which dish\?/);
});

test("caller counts add más, otros, and otra instead of overwriting", () => {
  const mas = callerSpokenQty([
    { speaker: "caller", text: "Dos tacos de bistec." },
    { speaker: "caller", text: "Dos tacos más de bistec." },
  ], "taco", "bistec", "(TCO) Taco Comal / Homemade");
  assert.equal(mas, 4);
  const otros = callerSpokenQty([
    { speaker: "caller", text: "Dos tacos de bistec." },
    { speaker: "caller", text: "Otros dos." },
  ], "taco", "bistec", "");
  assert.equal(otros, 4);
  const otra = callerSpokenQty([
    { speaker: "caller", text: "Una quesadilla de bistec." },
    { speaker: "caller", text: "Otra de bistec." },
  ], "quesadilla", "bistec", "");
  assert.equal(otra, 2);
  const restated = callerSpokenQty([
    { speaker: "caller", text: "Dos tacos de bistec." },
    { speaker: "caller", text: "Dos tacos de bistec." },
  ], "taco", "bistec", "");
  assert.equal(restated, 2);
  const total = callerSpokenQty([
    { speaker: "caller", text: "Dos tacos de bistec." },
    { speaker: "caller", text: "Serían cuatro tacos de bistec." },
  ], "taco", "bistec", "");
  assert.equal(total, 4);
});

test("a staff count question can name the dish or the meat", () => {
  const tacos = callerSpokenQty([
    { speaker: "caller", text: "Tacos de bistec." },
    { speaker: "staff", text: "¿Dos tacos?" },
    { speaker: "caller", text: "Sí." },
  ], "taco", "bistec", "Bistec / Steak");
  assert.equal(tacos, 2);
  const english = callerSpokenQty([
    { speaker: "caller", text: "Steak tacos." },
    { speaker: "staff", text: "Two tacos?" },
    { speaker: "caller", text: "Yes." },
  ], "taco", "bistec", "Bistec / Steak");
  assert.equal(english, 2);
  const meat = callerSpokenQty([
    { speaker: "caller", text: "Quesadillas." },
    { speaker: "staff", text: "¿Dos de bistec?" },
    { speaker: "caller", text: "Sí." },
  ], "quesadilla", "bistec", "Bistec / Steak");
  assert.equal(meat, 2);
});

test("otra de asada matches bistec and otra de harina does not change the tortilla", () => {
  const cart = [{
    itemId: "sq-taco-TAR7L5", quantity: 1,
    modifiers: [
      { step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" },
      { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" },
      { step: "(I) Salsa Preferencia / Preference", option: "Mild Salsa Asada" },
    ],
  }];
  const asada = repeatLastFood(cart, "Otra de asada.", menu, "es");
  assert.match(asada?.reply || "", /Ok, otro taco de bistec/);
  assert.equal(cart.length, 2);
  assert.match(JSON.stringify(cart[1].modifiers), /Bistec/);
  assert.doesNotMatch(JSON.stringify(cart[1].modifiers.filter((mod: any) => /carne|meat/i.test(mod.step))), /Salsa/);
  const harina = repeatLastFood(cart, "Otra de harina.", menu, "es");
  assert.match(harina?.reply || "", /cuál platillo/);
  assert.equal(cart.length, 2);
  assert.match(JSON.stringify(cart[0].modifiers), /Street|Taquero/);
});

test("otra de pastor uses the catalog Alpastor option", () => {
  const cart = [{ itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }] }];
  const reply = repeatLastFood(cart, "Otra de pastor.", menu, "es");
  assert.match(reply?.reply || "", /Ok, otro taco de alpastor|Ok, otro taco de pastor/);
  assert.match(JSON.stringify(cart[1].modifiers), /Alpastor/);
});

test("otra skips a drink and repeats the food behind it", () => {
  const cart = [
    { itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }] },
    { itemId: "sq-drink-diet-coca-cola-ZOE5GZ", quantity: 1, modifiers: [] },
  ];
  const reply = repeatLastFood(cart, "Otra de bistec.", menu, "es");
  assert.match(reply?.reply || "", /otro taco de bistec/);
  assert.equal(cart.filter((line) => line.itemId === "sq-taco-TAR7L5").length, 2);
  assert.equal(cart.filter((line) => /drink/.test(line.itemId)).length, 1);
});

test("a correct readback keeps the added otra count", () => {
  const cart = [
    { itemId: "sq-quesadilla-HLT6CR", quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }, { step: "(A) Q Tortilla Options", option: "(QHR) Quesadilla Harina / Flour (+$0.75)" }] },
  ];
  repeatLastFood(cart, "Otra de bistec.", menu, "es");
  applyStaffReadback(cart, [
    { speaker: "caller", text: "Una quesadilla de bistec." },
    { speaker: "caller", text: "Otra de bistec." },
    { speaker: "staff", text: "Te tengo dos quesadillas de bistec y un taco de chorizo." },
  ], menu, true);
  const lines = cart.filter((line) => line.itemId === "sq-quesadilla-HLT6CR");
  assert.equal(lines.reduce((sum, line) => sum + line.quantity, 0), 2);
});

test("más una coca does not add onto the tacos, in ES and EN", () => {
  assert.equal(callerSpokenQty([{ speaker: "caller", text: "Dos tacos de chorizo más una coca." }], "taco", "chorizo", ""), 2);
  assert.equal(callerSpokenQty([{ speaker: "caller", text: "Two tacos of chorizo plus one coke." }], "taco", "chorizo", ""), 2);
});

test("otro taco, otra quesadilla, otra más, otro de, and por favor each add one", () => {
  const prior = [
    { speaker: "caller", text: "Un taco de bistec." },
    { speaker: "caller", text: "Una quesadilla de bistec." },
  ];
  const added = (extra: string) => callerSpokenQty([...prior, { speaker: "caller", text: extra }], "taco", "bistec", "");
  assert.equal(added("Y otro taco de bistec."), 2);
  assert.equal(callerSpokenQty([...prior, { speaker: "caller", text: "Otra quesadilla de bistec." }], "quesadilla", "bistec", ""), 2);
  assert.equal(callerSpokenQty([...prior, { speaker: "caller", text: "Otra más de bistec." }], "quesadilla", "bistec", ""), 2);
  assert.equal(callerSpokenQty([{ speaker: "caller", text: "Un taco de bistec." }, { speaker: "caller", text: "Otro de bistec." }], "taco", "bistec", ""), 2);
  assert.equal(callerSpokenQty([{ speaker: "caller", text: "Una quesadilla de bistec." }, { speaker: "caller", text: "Otra de bistec por favor." }], "quesadilla", "bistec", ""), 2);
  assert.equal(callerSpokenQty([{ speaker: "caller", text: "One steak taco." }, { speaker: "caller", text: "And another steak taco." }], "taco", "bistec", ""), 2);
  assert.equal(callerSpokenQty([{ speaker: "caller", text: "Dos tacos de bistec." }, { speaker: "caller", text: "Dos tacos de bistec." }], "taco", "bistec", ""), 2);
  const taco = [{ itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }, { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" }] }];
  assert.match(repeatLastFood(taco, "Y otro taco de bistec.", menu, "es")?.reply || "", /Ok, otro taco de bistec/);
  assert.equal(taco.length, 2);
  const quesadilla = [{ itemId: "sq-quesadilla-HLT6CR", quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Chorizo / Mexican Sausage" }] }];
  assert.match(repeatLastFood(quesadilla, "Otra quesadilla de bistec.", menu, "es")?.reply || "", /Ok, otra quesadilla de bistec/);
  assert.match(repeatLastFood(quesadilla, "Otra más de bistec.", menu, "es")?.reply || "", /Ok, otra quesadilla de bistec/);
  assert.match(repeatLastFood(taco, "Otro de bistec.", menu, "es")?.reply || "", /Ok, otro taco de bistec/);
  assert.match(repeatLastFood(quesadilla, "Otra de bistec por favor.", menu, "es")?.reply || "", /Ok, otra quesadilla de bistec/);
  assert.match(repeatLastFood(taco, "And another steak taco.", menu, "en")?.reply || "", /Ok, another steak taco/);
});

test("mejor que sean tres sets only the line being discussed", () => {
  const turns = [
    { speaker: "caller", text: "Dos tacos de bistec." },
    { speaker: "caller", text: "Una quesadilla de chorizo." },
    { speaker: "caller", text: "Mejor que sean tres." },
  ];
  assert.equal(callerSpokenQty(turns, "quesadilla", "chorizo", ""), 3);
  assert.equal(callerSpokenQty(turns, "taco", "bistec", ""), 2);
  assert.deepEqual(staffQuantity(turns, "quesadilla", "chorizo", 3, 1, ""), { quantity: 3, flag: false });
  assert.deepEqual(staffQuantity(turns, "taco", "bistec", 2, 2, ""), { quantity: 2, flag: false });
  const english = [
    { speaker: "caller", text: "Two steak tacos." },
    { speaker: "caller", text: "One chorizo quesadilla." },
    { speaker: "caller", text: "Make it three." },
  ];
  assert.equal(callerSpokenQty(english, "quesadilla", "chorizo", ""), 3);
  assert.equal(callerSpokenQty(english, "taco", "bistec", ""), 2);
});

test("¿Dos de pastor? counts the Alpastor line", () => {
  const turns = [
    { speaker: "caller", text: "Tacos de pastor." },
    { speaker: "staff", text: "¿Dos de pastor?" },
    { speaker: "caller", text: "Sí." },
  ];
  assert.equal(callerSpokenQty(turns, "taco", "Alpastor / Roasted Pork", "Alpastor / Roasted Pork"), 2);
  assert.equal(callerSpokenQty(turns, "taco", "Bistec / Steak", "Bistec / Steak"), null);
  const english = [
    { speaker: "caller", text: "Pastor tacos." },
    { speaker: "staff", text: "Two pastor?" },
    { speaker: "caller", text: "Yes." },
  ];
  assert.equal(callerSpokenQty(english, "taco", "alpastor", "Alpastor / Roasted Pork"), 2);
});

test("otra de pollo on a torta prefers Pollo over Milanesa Pollo", () => {
  const torta = menu.find((item) => item.id === "sq-torta-4GNTTE");
  const names = (torta?.modifierGroups || []).flatMap((group) => (group.options || []).map((choice) => typeof choice === "string" ? choice : choice.name));
  assert.ok(names.some((name) => name === "Pollo / Chicken"));
  assert.ok(names.some((name) => /milanesa pollo/i.test(name)));
  const cart = [{ itemId: "sq-torta-4GNTTE", quantity: 1, modifiers: [{ step: "(B) Torta Carne Options", option: "Bistec / Steak" }] }];
  const reply = repeatLastFood(cart, "Otra de pollo.", menu, "es");
  assert.match(reply?.reply || "", /Ok, otra torta de pollo/);
  assert.equal(cart.length, 2);
  assert.match(JSON.stringify(cart[1].modifiers), /Pollo \/ Chicken/);
  assert.doesNotMatch(JSON.stringify(cart[1].modifiers), /Milanesa/);
});

test("enchiladas take the plural confirmation", () => {
  const cart = [{ itemId: "sq-enchiladas-orden-de-enchiladas-6-6QOYJ5", quantity: 1, modifiers: [{ step: "(A) Enchiladas Carne Options (ONLINE)", option: "Bistec / Steak" }] }];
  const reply = repeatLastFood(cart, "Otra de pollo.", menu, "es");
  assert.match(reply?.reply || "", /Ok, otras enchiladas de pollo/);
  assert.match(JSON.stringify(cart[1].modifiers), /Pollo/);
});

test("otra coca, cosa, pregunta, día, vez, igual, and más stay out of the otra handler", () => {
  for (const phrase of ["otra coca", "otra cosa", "otra pregunta por el horario", "otro día paso", "otra vez lo mismo", "otro igual", "otro más"]) {
    assert.equal(peelAnother(phrase), null, phrase);
    assert.equal(repeatLastFood([{ itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }] }], phrase, menu, "es"), null, phrase);
  }
});

test("otro de bistec y uno de pollo keeps the rest of the turn", async () => {
  const heard: string[] = [];
  const order: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, language: "es", text: "Un taco de chorizo." },
    { speaker: "staff", start: 1, end: 2, language: "es", text: "Ok." },
    { speaker: "caller", start: 3, end: 4, language: "es", text: "Otro de bistec y uno de pollo." },
  ] as any, shadowRun((text) => {
    heard.push(text);
    if (/pollo/i.test(text)) return { actions: [{ type: "add_item", itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Pollo / Chicken" }] }], reply: "ok" };
    if (/chorizo/i.test(text)) return { actions: [{ type: "add_item", itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }] }], reply: "ok" };
    return { actions: [], reply: "ok" };
  }));
  assert.ok(heard.some((text) => /uno de pollo/i.test(text)), JSON.stringify(heard));
  const lines = (order.cart || []).filter((line: any) => line.itemId === "sq-taco-TAR7L5");
  assert.ok(lines.some((line: any) => /bistec/i.test(JSON.stringify(line.modifiers))));
  assert.ok(lines.some((line: any) => /pollo/i.test(JSON.stringify(line.modifiers))));
});

test("más N of a different item does not change the taco count and still reaches the model", async () => {
  for (const phrase of ["Más un caldo.", "Más un tamal.", "Más un café.", "Más una orden de papas.", "Más dos aguas."]) {
    assert.equal(callerSpokenQty([
      { speaker: "caller", text: "Dos tacos de chorizo." },
      { speaker: "caller", text: phrase },
    ], "taco", "chorizo", ""), 2, phrase);
  }
  const heard: string[] = [];
  await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, language: "es", text: "Dos tacos de chorizo." },
    { speaker: "staff", start: 1, end: 2, language: "es", text: "Ok." },
    { speaker: "caller", start: 3, end: 4, language: "es", text: "Más un caldo." },
  ] as any, shadowRun((text) => { heard.push(text); return { actions: [], reply: "ok" }; }));
  assert.ok(heard.some((text) => /caldo/i.test(text)), JSON.stringify(heard));
});

test("que sean dos asks which dish when two lines are open", async () => {
  const turns = [
    { speaker: "caller", text: "Dos tacos de bistec y una quesadilla de chorizo." },
    { speaker: "caller", text: "Que sean dos." },
  ];
  assert.equal(callerSpokenQty(turns, "taco", "bistec", ""), 2);
  assert.equal(callerSpokenQty(turns, "quesadilla", "chorizo", ""), 1);
  const cart = [
    { itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }] },
    { itemId: "sq-quesadilla-HLT6CR", quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Chorizo / Mexican Sausage" }] },
  ];
  applyMakeItNMerge(cart, turns);
  assert.equal(cart[0].quantity, 2);
  assert.equal(cart[1].quantity, 1);
  const heard: string[] = [];
  const order: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, language: "es", text: "Dos tacos de bistec y una quesadilla de chorizo." },
    { speaker: "staff", start: 1, end: 2, language: "es", text: "Ok." },
    { speaker: "caller", start: 3, end: 4, language: "es", text: "Que sean dos." },
  ] as any, shadowRun((text) => {
    heard.push(text);
    if (/que sean/i.test(text)) return { actions: [{ type: "add_item", itemId: "sq-not-a-guess", quantity: 2 }], reply: "guess" };
    return { actions: [], reply: "ok" };
  }));
  assert.equal(heard.some((text) => /que sean/i.test(text)), false, JSON.stringify(heard));
  assert.match((order.steps || []).map((step: any) => step.reply).join(" "), /¿Que sean dos de cuál platillo\?/);
  assert.equal((order.cart || []).some((line: any) => line.itemId === "sq-not-a-guess"), false);
  const english = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, language: "en", text: "Two steak tacos and one chorizo quesadilla." },
    { speaker: "staff", start: 1, end: 2, language: "en", text: "Ok." },
    { speaker: "caller", start: 3, end: 4, language: "en", text: "Make it three." },
  ] as any, shadowRun(() => ({ actions: [], reply: "ok" })));
  assert.match((english.steps || []).map((step: any) => step.reply).join(" "), /Three of which dish\?/);
});

test("otro taco de harina de bistec uses the flour tortilla", () => {
  const cart = [{ itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }, { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" }] }];
  const reply = repeatLastFood(cart, "Otro taco de harina de bistec.", menu, "es");
  assert.match(reply?.reply || "", /Ok, otro taco de bistec/);
  assert.match(JSON.stringify(cart[1].modifiers), /Harina|Flour/);
  assert.match(JSON.stringify(cart[1].modifiers), /Bistec/);
  assert.doesNotMatch(JSON.stringify(cart[1].modifiers), /Street|Taquero/);
});

test("a bare N más adds to the open line", () => {
  const after = (extra: string) => callerSpokenQty([
    { speaker: "caller", text: "Dos tacos de bistec." },
    { speaker: "caller", text: extra },
  ], "taco", "bistec", "");
  assert.equal(after("Dos más."), 4);
  assert.equal(after("Y dos más."), 4);
  assert.equal(after("Dame dos más."), 4);
  assert.equal(after("Dos más por favor."), 4);
  assert.equal(after("Una más y ya."), 3);
  assert.equal(after("Otro más."), 3);
});

test("que sean dos asks when two meats of the same dish are open", async () => {
  const turns = [
    { speaker: "caller", text: "Un taco de bistec y un taco de pollo." },
    { speaker: "caller", text: "Que sean dos." },
  ];
  assert.equal(callerSpokenQty(turns, "taco", "bistec", ""), 1);
  assert.equal(callerSpokenQty(turns, "taco", "pollo", ""), 1);
  const cart = [
    { itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }] },
    { itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Pollo / Chicken" }] },
  ];
  applyMakeItNMerge(cart, turns);
  assert.equal(cart[0].quantity, 1);
  assert.equal(cart[1].quantity, 1);
  const order: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, language: "es", text: "Un taco de bistec y un taco de pollo." },
    { speaker: "staff", start: 1, end: 2, language: "es", text: "Ok." },
    { speaker: "caller", start: 3, end: 4, language: "es", text: "Que sean dos." },
  ] as any, shadowRun((text) => /que sean/i.test(text)
    ? { actions: [{ type: "update_item", itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Pollo / Chicken" }] }], reply: "guess" }
    : { actions: [], reply: "ok" }));
  assert.match((order.steps || []).map((step: any) => step.reply).join(" "), /¿Que sean dos de cuál platillo\?/);
  assert.equal((order.cart || []).some((line: any) => line.quantity === 2), false);
});

test("otra de birria is the meat, not a dish question", () => {
  const cart = [{ itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }] }];
  const reply = repeatLastFood(cart, "Otra de birria.", menu, "es");
  assert.match(reply?.reply || "", /Ok, otro taco de birria/);
  assert.doesNotMatch(reply?.reply || "", /cuál platillo/);
  assert.match(JSON.stringify(cart[1].modifiers), /Birria/);
});

test("otro de lo mismo reaches the model", async () => {
  const heard: string[] = [];
  const order: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, language: "es", text: "Un taco de bistec." },
    { speaker: "staff", start: 1, end: 2, language: "es", text: "Ok." },
    { speaker: "caller", start: 3, end: 4, language: "es", text: "Otro de lo mismo." },
  ] as any, shadowRun((text) => {
    heard.push(text);
    if (/bistec/i.test(text) && !/mismo/i.test(text)) return { actions: [{ type: "add_item", itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }] }], reply: "ok" };
    return { actions: [], reply: "ok" };
  }));
  assert.ok(heard.some((text) => /lo mismo/i.test(text)), JSON.stringify(heard));
  assert.doesNotMatch((order.steps || []).map((step: any) => step.reply).join(" "), /cuál platillo|otra de lo/i);
});

test("otro de bistec, no, mejor no adds nothing", async () => {
  const cart = [{ itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }] }];
  const direct = repeatLastFood(cart, "Otro de bistec, no, mejor no.", menu, "es");
  assert.equal(cart.length, 1);
  assert.doesNotMatch(direct?.reply || "", /\?/);
  const heard: string[] = [];
  const order: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, language: "es", text: "Un taco de chorizo." },
    { speaker: "staff", start: 1, end: 2, language: "es", text: "Ok." },
    { speaker: "caller", start: 3, end: 4, language: "es", text: "Otro de bistec, no, mejor no." },
  ] as any, shadowRun((text) => {
    heard.push(text);
    if (/bistec/i.test(text)) return { actions: [{ type: "add_item", itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }] }], reply: "added" };
    if (/chorizo/i.test(text)) return { actions: [{ type: "add_item", itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }] }], reply: "ok" };
    return { actions: [], reply: "ok" };
  }));
  assert.equal(heard.some((text) => /mejor no/i.test(text)), false, JSON.stringify(heard));
  assert.equal((order.cart || []).some((line: any) => /bistec/i.test(JSON.stringify(line.modifiers))), false);
});

test("a cancelled otra still sends the rest of the turn to the model", async () => {
  const heard: string[] = [];
  const order: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, language: "es", text: "Un taco de chorizo." },
    { speaker: "staff", start: 1, end: 2, language: "es", text: "Ok." },
    { speaker: "caller", start: 3, end: 4, language: "es", text: "Otro de bistec, no, mejor no, uno de pollo." },
  ] as any, shadowRun((text) => {
    heard.push(text);
    if (/pollo/i.test(text)) return { actions: [{ type: "add_item", itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Pollo / Chicken" }] }], reply: "ok" };
    if (/chorizo/i.test(text)) return { actions: [{ type: "add_item", itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }] }], reply: "ok" };
    return { actions: [], reply: "ok" };
  }));
  assert.ok(heard.some((text) => /uno de pollo/i.test(text)), JSON.stringify(heard));
  assert.ok((order.cart || []).some((line: any) => /pollo/i.test(JSON.stringify(line.modifiers))));
  assert.equal((order.cart || []).some((line: any) => /bistec/i.test(JSON.stringify(line.modifiers))), false);
});

test("mejor no and no ya no cancel an otra in the same turn and the next turn", async () => {
  for (const phrase of ["Otro de bistec, mejor no.", "Otro de bistec, no, ya no."]) {
    const cart = [{ itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }] }];
    repeatLastFood(cart, phrase, menu, "es");
    assert.equal(cart.length, 1, phrase);
  }
  const run = shadowRun((text) => {
    if (/chorizo/i.test(text)) return { actions: [{ type: "add_item", itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }] }], reply: "ok" };
    if (/bistec/i.test(text)) return { actions: [{ type: "add_item", itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }] }], reply: "added" };
    return { actions: [], reply: "ok" };
  });
  for (const cancel of ["Mejor no.", "No, ya no."]) {
    const order: any = await shadowOrderFromTurns([
      { speaker: "caller", start: 0, end: 1, language: "es", text: "Un taco de chorizo." },
      { speaker: "staff", start: 1, end: 2, language: "es", text: "Ok." },
      { speaker: "caller", start: 3, end: 4, language: "es", text: "Otra de bistec." },
      { speaker: "staff", start: 4, end: 5, language: "es", text: "Ok." },
      { speaker: "caller", start: 5, end: 6, language: "es", text: cancel },
    ] as any, run);
    assert.equal((order.cart || []).some((line: any) => /bistec/i.test(JSON.stringify(line.modifiers))), false, cancel);
    assert.ok((order.cart || []).some((line: any) => /chorizo/i.test(JSON.stringify(line.modifiers))), cancel);
    assert.equal(callerSpokenQty([
      { speaker: "caller", text: "Un taco de chorizo." },
      { speaker: "caller", text: "Otra de bistec." },
      { speaker: "caller", text: cancel },
    ], "taco", "bistec", ""), null, cancel);
  }
});

test("pastor y asada then que sean dos asks which dish", async () => {
  const turns = [
    { speaker: "caller", text: "Un taco de pastor y asada." },
    { speaker: "caller", text: "Que sean dos." },
  ];
  assert.equal(callerSpokenQty(turns, "taco", "alpastor", ""), 1);
  assert.equal(callerSpokenQty(turns, "taco", "bistec", ""), null);
  const order: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, language: "es", text: "Un taco de pastor y asada." },
    { speaker: "staff", start: 1, end: 2, language: "es", text: "Ok." },
    { speaker: "caller", start: 3, end: 4, language: "es", text: "Que sean dos." },
  ] as any, shadowRun((text) => /que sean/i.test(text)
    ? { actions: [{ type: "update_item", itemId: "sq-taco-TAR7L5", quantity: 2 }], reply: "guess" }
    : { actions: [], reply: "ok" }));
  assert.match((order.steps || []).map((step: any) => step.reply).join(" "), /¿Que sean dos de cuál platillo\?/);
});

test("dos más and que sean dos ask when two lines are open", async () => {
  const more = [
    { speaker: "caller", text: "Dos tacos de bistec." },
    { speaker: "caller", text: "Una quesadilla de chorizo." },
    { speaker: "caller", text: "Dos más." },
  ];
  assert.equal(callerSpokenQty(more, "taco", "bistec", ""), 2);
  assert.equal(callerSpokenQty(more, "quesadilla", "chorizo", ""), 1);
  const asked: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, language: "es", text: "Dos tacos de bistec." },
    { speaker: "staff", start: 1, end: 2, language: "es", text: "Ok." },
    { speaker: "caller", start: 3, end: 4, language: "es", text: "Una quesadilla de chorizo." },
    { speaker: "staff", start: 4, end: 5, language: "es", text: "Ok." },
    { speaker: "caller", start: 6, end: 7, language: "es", text: "Dos más." },
  ] as any, shadowRun((text) => /m[aá]s/i.test(text)
    ? { actions: [{ type: "update_item", itemId: "sq-quesadilla-HLT6CR", quantity: 3 }], reply: "guess" }
    : { actions: [], reply: "ok" }));
  assert.match((asked.steps || []).map((step: any) => step.reply).join(" "), /¿Dos más de cuál platillo\?/);
  const separate = [
    { speaker: "caller", text: "Un taco de bistec." },
    { speaker: "caller", text: "Un taco de pollo." },
    { speaker: "caller", text: "Que sean dos." },
  ];
  assert.equal(callerSpokenQty(separate, "taco", "bistec", ""), 1);
  assert.equal(callerSpokenQty(separate, "taco", "pollo", ""), 1);
  const cart = [
    { itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }] },
    { itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Pollo / Chicken" }] },
  ];
  applyMakeItNMerge(cart, separate);
  assert.equal(cart[0].quantity, 1);
  assert.equal(cart[1].quantity, 1);
});

test("line meat pattern is loaded from the menu", () => {
  const pattern = lineMeatRe();
  assert.notEqual(pattern.source, "^$");
  assert.match("bistec", pattern);
  assert.match("pastor", pattern);
  assert.match("asada", pattern);
});

test("y otro más por favor adds one", () => {
  assert.equal(callerSpokenQty([
    { speaker: "caller", text: "Dos tacos de bistec." },
    { speaker: "caller", text: "Y otro más por favor." },
  ], "taco", "bistec", ""), 3);
});

test("real goodbyes still abandon the order", () => {
  assert.equal(isAbandonTurn("No quiero nada, a las dos de la tarde paso"), true);
  assert.equal(isAbandonedOrder([{ speaker: "caller", text: "No quiero nada, a las dos de la tarde paso" }]), true);
  assert.equal(isAbandonTurn("Entonces no, gracias, ya pedí dos de pollo en otro lado"), true);
  assert.equal(isAbandonedOrder([{ speaker: "caller", text: "Entonces no, gracias, ya pedí dos de pollo en otro lado" }]), true);
});

test("a topping after mejor no does not cancel the taco", () => {
  const start = () => [{ itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }] }];
  for (const phrase of ["Otro de bistec, mejor no cebolla.", "Otro de bistec, mejor no de harina.", "Otro de bistec, no ya no tiene queso?"]) {
    const cart = start();
    repeatLastFood(cart, phrase, menu, "es");
    assert.ok(cart.some((line) => /chorizo/i.test(JSON.stringify(line.modifiers))), phrase);
  }
});

test("a staff question keeps the otra line", async () => {
  const run = shadowRun((text) => {
    if (/chorizo/i.test(text)) return { actions: [{ type: "add_item", itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }] }], reply: "ok" };
    return { actions: [], reply: "ok" };
  });
  const more: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, language: "es", text: "Un taco de chorizo." },
    { speaker: "staff", start: 1, end: 2, language: "es", text: "Ok." },
    { speaker: "caller", start: 3, end: 4, language: "es", text: "Otra de bistec." },
    { speaker: "staff", start: 4, end: 5, language: "es", text: "¿Algo más?" },
    { speaker: "caller", start: 6, end: 7, language: "es", text: "No, ya no, es todo." },
  ] as any, run);
  assert.ok((more.cart || []).some((line: any) => /bistec/i.test(JSON.stringify(line.modifiers))));
  const onion: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, language: "es", text: "Un taco de chorizo." },
    { speaker: "staff", start: 1, end: 2, language: "es", text: "Ok." },
    { speaker: "caller", start: 3, end: 4, language: "es", text: "Otra de bistec." },
    { speaker: "staff", start: 4, end: 5, language: "es", text: "¿Con cebolla?" },
    { speaker: "caller", start: 6, end: 7, language: "es", text: "Mejor no." },
  ] as any, run);
  assert.equal(onion.steps?.[0]?.source, "abandoned-order");
  assert.equal((onion.cart || []).length, 0);
});

test("dos tacos de bistec y otro de bistec dos más adds", async () => {
  assert.equal(callerSpokenQty([
    { speaker: "caller", text: "Dos tacos de bistec, y otro de bistec, dos más." },
  ], "taco", "bistec", ""), 5);
  const order: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, language: "es", text: "Dos tacos de bistec, y otro de bistec." },
    { speaker: "staff", start: 1, end: 2, language: "es", text: "Ok." },
    { speaker: "caller", start: 3, end: 4, language: "es", text: "Dos más." },
  ] as any, shadowRun(() => ({ actions: [], reply: "ok" })));
  assert.doesNotMatch((order.steps || []).map((step: any) => step.reply).join(" "), /cuál platillo/);
});

test("Mejor no after another staff question still wipes like 14488d4", async () => {
  const run = shadowRun((text) => {
    if (/pollo/i.test(text)) return { actions: [{ type: "add_item", itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Pollo / Chicken" }] }], reply: "ok" };
    if (/chorizo/i.test(text)) return { actions: [{ type: "add_item", itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }] }], reply: "ok" };
    return { actions: [], reply: "ok" };
  });
  const ended: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, language: "es", text: "Un taco de chorizo." },
    { speaker: "staff", start: 1, end: 2, language: "es", text: "¿Se lo preparo?" },
    { speaker: "caller", start: 3, end: 4, language: "es", text: "Mejor no." },
  ] as any, run);
  assert.equal(ended.steps?.[0]?.source, "abandoned-order");
  assert.equal((ended.cart || []).length, 0);
  const continued: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, language: "es", text: "Un taco de chorizo." },
    { speaker: "staff", start: 1, end: 2, language: "es", text: "¿Se lo preparo?" },
    { speaker: "caller", start: 3, end: 4, language: "es", text: "Mejor no." },
    { speaker: "staff", start: 4, end: 5, language: "es", text: "Ok." },
    { speaker: "caller", start: 6, end: 7, language: "es", text: "Dame uno de pollo." },
  ] as any, run);
  const meats = (continued.cart || []).map((line: any) => JSON.stringify(line.modifiers));
  assert.equal(meats.length, 2);
  assert.match(meats[0], /pollo/i);
  assert.match(meats[1], /chorizo/i);
});

test("a cancel can name the replacement pollo", async () => {
  const run = shadowRun((text) => {
    if (/pollo/i.test(text)) return { actions: [{ type: "add_item", itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Pollo / Chicken" }] }], reply: "ok" };
    if (/chorizo/i.test(text)) return { actions: [{ type: "add_item", itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }] }], reply: "ok" };
    return { actions: [], reply: "ok" };
  });
  for (const phrase of ["Otro de bistec, no, mejor no, dame uno de pollo.", "Otro de bistec, mejor no, mejor uno de pollo."]) {
    const order: any = await shadowOrderFromTurns([
      { speaker: "caller", start: 0, end: 1, language: "es", text: "Un taco de chorizo." },
      { speaker: "staff", start: 1, end: 2, language: "es", text: "Ok." },
      { speaker: "caller", start: 3, end: 4, language: "es", text: phrase },
    ] as any, run);
    assert.ok((order.cart || []).some((line: any) => /pollo/i.test(JSON.stringify(line.modifiers))), phrase);
    assert.equal((order.cart || []).filter((line: any) => /bistec/i.test(JSON.stringify(line.modifiers))).length, 0, phrase);
  }
  const agreed: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, language: "es", text: "Un taco de chorizo." },
    { speaker: "staff", start: 1, end: 2, language: "es", text: "Ok." },
    { speaker: "caller", start: 3, end: 4, language: "es", text: "Otra de bistec." },
    { speaker: "staff", start: 4, end: 5, language: "es", text: "Ok." },
    { speaker: "caller", start: 6, end: 7, language: "es", text: "No, mejor no, dame uno de pollo." },
  ] as any, run);
  assert.equal((agreed.cart || []).some((line: any) => /bistec/i.test(JSON.stringify(line.modifiers))), false);
  assert.ok((agreed.cart || []).some((line: any) => /pollo/i.test(JSON.stringify(line.modifiers))));
  assert.equal(callerSpokenQty([
    { speaker: "caller", text: "Un taco de chorizo." },
    { speaker: "caller", text: "Otra de bistec." },
    { speaker: "staff", text: "Ok." },
    { speaker: "caller", text: "No, mejor no, dame uno de pollo." },
  ], "taco", "bistec", ""), null);
  assert.equal(callerSpokenQty([
    { speaker: "caller", text: "Dos tacos de bistec." },
    { speaker: "caller", text: "Otra quesadilla de chorizo." },
    { speaker: "caller", text: "Mejor no." },
    { speaker: "caller", text: "Dos más." },
  ], "quesadilla", "chorizo", ""), null);
  assert.equal(callerSpokenQty([
    { speaker: "caller", text: "Dos tacos de bistec." },
    { speaker: "caller", text: "Otra quesadilla de chorizo." },
    { speaker: "caller", text: "Mejor no." },
    { speaker: "caller", text: "Dos más." },
  ], "taco", "bistec", ""), 4);
});

test("Mejor no after an otra still reaches the model when staff asked a question", async () => {
  const run = shadowRun((text) => {
    if (/pollo/i.test(text)) return { actions: [{ type: "add_item", itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Pollo / Chicken" }] }], reply: "model" };
    if (/chorizo|bistec|otra/i.test(text)) return { actions: [{ type: "add_item", itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: /bistec|otra/i.test(text) ? "Bistec / Steak" : "Chorizo / Mexican Sausage" }] }], reply: "model" };
    return { actions: [], reply: "model" };
  });
  for (const question of ["¿Con cebolla?", "¿Se lo preparo?", "¿Para aquí o para llevar?", "Son 40 minutos, ¿está bien?"]) {
    const ended: any = await shadowOrderFromTurns([
      { speaker: "caller", start: 0, end: 1, language: "es", text: "Un taco de chorizo." },
      { speaker: "staff", start: 1, end: 2, language: "es", text: "Ok." },
      { speaker: "caller", start: 3, end: 4, language: "es", text: "Otra de bistec." },
      { speaker: "staff", start: 4, end: 5, language: "es", text: question },
      { speaker: "caller", start: 6, end: 7, language: "es", text: "Mejor no." },
    ] as any, run);
    assert.equal(ended.steps?.[0]?.source, "abandoned-order", question);
    assert.equal((ended.cart || []).length, 0, question);
    const continued: any = await shadowOrderFromTurns([
      { speaker: "caller", start: 0, end: 1, language: "es", text: "Un taco de chorizo." },
      { speaker: "staff", start: 1, end: 2, language: "es", text: "Ok." },
      { speaker: "caller", start: 3, end: 4, language: "es", text: "Otra de bistec." },
      { speaker: "staff", start: 4, end: 5, language: "es", text: question },
      { speaker: "caller", start: 6, end: 7, language: "es", text: "Mejor no." },
      { speaker: "staff", start: 7, end: 8, language: "es", text: "Ok." },
      { speaker: "caller", start: 8, end: 9, language: "es", text: "Dame uno de pollo." },
    ] as any, run);
    const mejor = (continued.steps || []).find((step: any) => step.heard === "Mejor no");
    assert.equal(mejor?.reply, "model", question);
    assert.equal((continued.steps || []).some((step: any) => step.source === "another-cancel"), false, question);
    const meats = (continued.cart || []).map((line: any) => JSON.stringify(line.modifiers));
    assert.equal(meats.length, 2, question);
    assert.match(meats[0], /pollo/i, question);
    assert.match(meats[1], /chorizo/i, question);
  }
});

test("a dish-less pollo continues the taco and dos más asks", async () => {
  const turns = [
    { speaker: "caller", text: "Dos tacos de bistec." },
    { speaker: "caller", text: "Y uno de pollo." },
    { speaker: "caller", text: "Dos más." },
  ];
  assert.equal(callerSpokenQty(turns, "taco", "bistec", ""), 2);
  assert.equal(callerSpokenQty(turns, "taco", "pollo", ""), 1);
  const cart = [{ itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }] }];
  assert.equal(callerSpokenQty(turns, "taco", "bistec", "", cart), 4);
  assert.equal(callerSpokenQty([
    { speaker: "caller", text: "Dos tacos de bistec." },
    { speaker: "caller", text: "Una quesadilla de bistec." },
    { speaker: "caller", text: "Dos más." },
  ], "taco", "bistec", "", cart), 4);
  const asked: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, language: "es", text: "Dos tacos de bistec." },
    { speaker: "staff", start: 1, end: 2, language: "es", text: "Ok." },
    { speaker: "caller", start: 3, end: 4, language: "es", text: "Y uno de pollo." },
    { speaker: "staff", start: 4, end: 5, language: "es", text: "Ok." },
    { speaker: "caller", start: 6, end: 7, language: "es", text: "Dos más." },
  ] as any, shadowRun((text) => /pollo/i.test(text)
    ? { actions: [{ type: "add_item", itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Pollo / Chicken" }] }], reply: "ok" }
    : /bistec/i.test(text)
      ? { actions: [{ type: "add_item", itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }] }], reply: "ok" }
      : { actions: [{ type: "update_item", itemId: "sq-taco-TAR7L5", quantity: 4 }], reply: "guess" }));
  assert.match((asked.steps || []).map((step: any) => step.reply).join(" "), /¿Dos más de cuál platillo\?/);
});

test("otro taco de bistec in the same turn totals three and a dish question opens nothing", () => {
  assert.equal(callerSpokenQty([
    { speaker: "caller", text: "Dos tacos de bistec y otro taco de bistec." },
  ], "taco", "bistec", ""), 3);
  assert.equal(callerSpokenQty([
    { speaker: "caller", text: "Tienen tacos de frijoles." },
    { speaker: "caller", text: "Dos tacos de bistec." },
    { speaker: "caller", text: "Dos más." },
  ], "taco", "bistec", ""), 4);
});

test("dos más uses the same meat key as the lookup", () => {
  for (const said of ["Dos tacos al pastor.", "Dos tacos de pastor.", "Dos tacos de al pastor."]) {
    assert.equal(callerSpokenQty([
      { speaker: "caller", text: said },
      { speaker: "caller", text: "Dos más." },
    ], "taco", "alpastor", ""), 4, said);
  }
  assert.equal(callerSpokenQty([
    { speaker: "caller", text: "Dos tacos de tripas." },
    { speaker: "caller", text: "Dos más." },
  ], "taco", "tripa", ""), 4);
});

test("a greeting does not hide the food after it", () => {
  const turns = [{ speaker: "caller", text: "Hola, me da dos tacos de bistec y uno de pollo." }];
  assert.equal(callerSpokenQty(turns, "taco", "bistec", ""), 2);
  assert.equal(callerSpokenQty(turns, "taco", "pollo", ""), 1);
  assert.equal(callerSpokenQty([
    ...turns,
    { speaker: "caller", text: "Dos más." },
  ], "taco", "bistec", ""), 2);
  assert.equal(callerSpokenQty([
    ...turns,
    { speaker: "caller", text: "Dos más." },
  ], "taco", "pollo", ""), 1);
});

test("a comma keeps each item and an opening que tal does not hide the order", () => {
  const two = [
    { speaker: "caller", text: "Dos tacos de bistec, uno de pollo." },
    { speaker: "caller", text: "Dos más." },
  ];
  assert.equal(callerSpokenQty(two, "taco", "bistec", ""), 2);
  assert.equal(callerSpokenQty(two, "taco", "pollo", ""), 1);
  const dishes = [
    { speaker: "caller", text: "Un taco de bistec, una quesadilla de pollo." },
    { speaker: "caller", text: "Dos más." },
  ];
  assert.equal(callerSpokenQty(dishes, "taco", "bistec", ""), 1);
  assert.equal(callerSpokenQty(dishes, "quesadilla", "pollo", ""), 1);
  const three = [
    { speaker: "caller", text: "Dos tacos de bistec, uno de pollo, una quesadilla de chorizo." },
    { speaker: "caller", text: "Dos más." },
  ];
  assert.equal(callerSpokenQty(three, "taco", "bistec", ""), 2);
  assert.equal(callerSpokenQty(three, "taco", "pollo", ""), 1);
  assert.equal(callerSpokenQty(three, "quesadilla", "chorizo", ""), 1);
  const makeTwo = [
    { speaker: "caller", text: "Dos tacos de bistec, uno de pollo." },
    { speaker: "caller", text: "Que sean tres." },
  ];
  assert.equal(callerSpokenQty(makeTwo, "taco", "bistec", ""), 2);
  assert.equal(callerSpokenQty(makeTwo, "taco", "pollo", ""), 1);
  const makeThree = [
    { speaker: "caller", text: "Dos tacos de bistec, uno de pollo, una quesadilla de chorizo." },
    { speaker: "caller", text: "Que sean tres." },
  ];
  assert.equal(callerSpokenQty(makeThree, "taco", "bistec", ""), 2);
  assert.equal(callerSpokenQty(makeThree, "taco", "pollo", ""), 1);
  assert.equal(callerSpokenQty(makeThree, "quesadilla", "chorizo", ""), 1);
  for (const said of [
    "Hola, cómo está, me da dos tacos de bistec y uno de pollo.",
    "Qué tal, me da dos tacos de bistec y uno de pollo.",
    "Cómo está, me da dos tacos de bistec y uno de pollo.",
  ]) {
    const turns = [{ speaker: "caller", text: said }];
    assert.equal(callerSpokenQty(turns, "taco", "bistec", ""), 2, said);
    assert.equal(callerSpokenQty(turns, "taco", "pollo", ""), 1, said);
  }
});

test("que tal los tacos is not an order and two more counts", () => {
  assert.equal(callerSpokenQty([
    { speaker: "caller", text: "Qué tal los tacos de pastor." },
    { speaker: "caller", text: "Dos más." },
  ], "taco", "alpastor", ""), null);
  assert.equal(callerSpokenQty([
    { speaker: "caller", text: "Cómo está los tacos de pastor." },
    { speaker: "caller", text: "Dos más." },
  ], "taco", "alpastor", ""), null);
  const ordered = [
    { speaker: "caller", text: "Qué tal los de pastor. Dame dos tacos de bistec." },
    { speaker: "caller", text: "Dos más." },
  ];
  assert.equal(callerSpokenQty(ordered, "taco", "bistec", ""), 4);
  assert.equal(callerSpokenQty(ordered, "taco", "alpastor", ""), null);
  assert.equal(callerSpokenQty([
    { speaker: "caller", text: "Two tacos of steak." },
    { speaker: "caller", text: "Two more." },
  ], "taco", "bistec", ""), 4);
  const both = [
    { speaker: "caller", text: "Two tacos of steak." },
    { speaker: "caller", text: "One taco of chicken." },
    { speaker: "caller", text: "Two more." },
  ];
  assert.equal(callerSpokenQty(both, "taco", "bistec", ""), 2);
  assert.equal(callerSpokenQty(both, "taco", "pollo", ""), 1);
});

test("a numbered que tal order keeps its count and still asks", async () => {
  const pastor = [
    { speaker: "caller", text: "Qué tal, los tacos de pastor, dos por favor." },
    { speaker: "caller", text: "Dos más." },
  ];
  assert.equal(callerSpokenQty(pastor, "taco", "alpastor", ""), 2);
  assert.deepEqual(staffQuantity(pastor, "taco", "alpastor", 4, 4, ""), { quantity: 2, flag: true });
  const mixed = [
    { speaker: "caller", text: "Qué tal, la quesadilla de pollo y dos tacos de bistec." },
    { speaker: "caller", text: "Dos más." },
  ];
  assert.equal(callerSpokenQty(mixed, "taco", "bistec", ""), 2);
  assert.deepEqual(staffQuantity(mixed, "taco", "bistec", 4, 4, ""), { quantity: 2, flag: true });
  assert.equal(callerSpokenQty([
    { speaker: "caller", text: "¿Qué tal los tacos de pastor?" },
    { speaker: "caller", text: "Dos más." },
  ], "taco", "alpastor", ""), null);
  const asked: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, language: "es", text: "Qué tal, la quesadilla de pollo y dos tacos de bistec." },
    { speaker: "staff", start: 1, end: 2, language: "es", text: "Ok." },
    { speaker: "caller", start: 3, end: 4, language: "es", text: "Dos más." },
  ] as any, shadowRun((text) => /m[aá]s/i.test(text)
    ? { actions: [{ type: "update_item", itemId: "sq-taco-TAR7L5", quantity: 4, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }] }], reply: "guess" }
    : /bistec|quesadilla|pollo/i.test(text)
      ? { actions: [], reply: "ok" }
      : { actions: [], reply: "ok" }));
  assert.match((asked.steps || []).map((step: any) => step.reply).join(" "), /¿Dos más de cuál platillo\?/);
  const bare = [
    { speaker: "caller", text: "Dos de bistec. Una quesadilla de pollo." },
    { speaker: "caller", text: "Dos más." },
  ];
  assert.equal(callerSpokenQty(bare, "quesadilla", "pollo", ""), 1);
  const across = [
    { speaker: "caller", text: "Dos de bistec." },
    { speaker: "caller", text: "Una quesadilla de pollo." },
    { speaker: "caller", text: "Dos más." },
  ];
  assert.equal(callerSpokenQty(across, "quesadilla", "pollo", ""), 1);
  const cart = [
    { itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }] },
    { itemId: "sq-quesadilla-HLT6CR", quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Pollo / Chicken" }] },
  ];
  assert.equal(callerSpokenQty(bare, "quesadilla", "pollo", "", cart), 1);
  assert.deepEqual(staffQuantity(bare, "quesadilla", "pollo", 3, 3, "", cart), { quantity: 1, flag: true });
  for (const said of ["Seis de bistec.", "Diez de bistec.", "Una docena de bistec.", "Media docena de bistec.", "Four of bistec.", "Ten of bistec."]) {
    assert.equal(callerSpokenQty([
      { speaker: "caller", text: `${said} Una quesadilla de pollo.` },
      { speaker: "caller", text: "Dos más." },
    ], "quesadilla", "pollo", ""), 1, said);
  }
  assert.equal(callerSpokenQty([
    { speaker: "caller", text: "Para las dos, de pastor." },
    { speaker: "caller", text: "Dos más." },
  ], "taco", "alpastor", ""), null);
  assert.equal(openLineKeys([
    { speaker: "caller", text: "Para las dos, de pastor." },
    { speaker: "caller", text: "Dos más." },
  ], 1).some((key) => key.includes("pastor")), false);
  assert.equal(callerSpokenQty([
    { speaker: "caller", text: "Dos tacos de pollo, de bistec no." },
    { speaker: "caller", text: "Dos más." },
  ], "taco", "pollo", ""), 4);
  assert.equal(callerSpokenQty([
    { speaker: "caller", text: "Dos tacos de pollo, de bistec no." },
    { speaker: "caller", text: "Dos más." },
  ], "taco", "bistec", ""), null);
  const topping = [
    { speaker: "caller", text: "Dos tacos de pollo y uno de bistec no cebolla." },
    { speaker: "caller", text: "Dos más." },
  ];
  assert.equal(callerSpokenQty(topping, "taco", "pollo", ""), 2);
  assert.deepEqual(staffQuantity(topping, "taco", "pollo", 4, 4, ""), { quantity: 2, flag: true });
  const english = [
    { speaker: "caller", text: "Two chicken tacos and one of steak no onion." },
    { speaker: "caller", text: "Two more." },
  ];
  assert.equal(callerSpokenQty(english, "taco", "pollo", ""), 2);
  assert.deepEqual(staffQuantity(english, "taco", "pollo", 4, 4, ""), { quantity: 2, flag: true });
  const spicy = [
    { speaker: "caller", text: "Dos tacos de pollo sin cebolla no picante." },
    { speaker: "caller", text: "Dos más." },
  ];
  assert.equal(callerSpokenQty(spicy, "taco", "pollo", ""), 4);
  assert.deepEqual(staffQuantity(spicy, "taco", "pollo", 9, 9, ""), { quantity: 4, flag: true });
  const swap = [
    { speaker: "caller", text: "Dos tacos de chorizo." },
    { speaker: "caller", text: "Uno de pollo no mejor de bistec." },
    { speaker: "caller", text: "Dos más." },
  ];
  assert.equal(callerSpokenQty(swap, "taco", "chorizo", ""), 2);
  assert.deepEqual(staffQuantity(swap, "taco", "chorizo", 4, 4, ""), { quantity: 2, flag: true });
  const topped = [
    { speaker: "caller", text: "Tres tacos. Uno de bistec no cebolla." },
    { speaker: "caller", text: "Dos más." },
  ];
  assert.ok(openLineKeys(topped, 1).some((key) => key.endsWith("|bistec")));
  for (const said of ["Dos órdenes de bistec.", "Dos, de bistec.", "Bistec, dos."]) {
    assert.equal(callerSpokenQty([
      { speaker: "caller", text: `${said} Una quesadilla de pollo.` },
      { speaker: "caller", text: "Dos más." },
    ], "quesadilla", "pollo", ""), 1, said);
  }
  const steakCart = [
    { itemId: "sq-taco-TAR7L5", quantity: 4, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }] },
    { itemId: "sq-quesadilla-HLT6CR", quantity: 1, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Pollo / Chicken" }] },
  ];
  for (const said of ["Four of steak.", "Ten steak."]) {
    const turns = [
      { speaker: "caller", text: `${said} One chicken quesadilla.` },
      { speaker: "caller", text: "Two more." },
    ];
    assert.equal(callerSpokenQty(turns, "quesadilla", "pollo", "", steakCart), 1, said);
    assert.deepEqual(staffQuantity(turns, "quesadilla", "pollo", 3, 3, "", steakCart), { quantity: 1, flag: true }, said);
  }
});

test("con and with keep one line, and goat still adds", () => {
  const mixed = [
    { speaker: "caller", text: "Dos tacos de bistec con chorizo." },
    { speaker: "caller", text: "Dos más." },
  ];
  assert.equal(callerSpokenQty(mixed, "taco", "bistec", ""), 4);
  assert.deepEqual(staffQuantity(mixed, "taco", "bistec", 4, 4, ""), { quantity: 4, flag: false });
  const set = [
    { speaker: "caller", text: "Dos tacos de bistec con chorizo." },
    { speaker: "caller", text: "Que sean tres." },
  ];
  assert.equal(callerSpokenQty(set, "taco", "bistec", ""), 3);
  assert.deepEqual(staffQuantity(set, "taco", "bistec", 3, 3, ""), { quantity: 3, flag: false });
  for (const said of ["Una quesadilla de bistec con queso.", "Dos tacos de bistec con papas."]) {
    const turns = [{ speaker: "caller", text: said }, { speaker: "caller", text: "Dos más." }];
    const dish = /quesadilla/.test(said) ? "quesadilla" : "taco";
    const qty = /quesadilla/.test(said) ? 3 : 4;
    assert.equal(callerSpokenQty(turns, dish, "bistec", ""), qty, said);
    assert.deepEqual(staffQuantity(turns, dish, "bistec", qty, qty, ""), { quantity: qty, flag: false }, said);
  }
  const english = [
    { speaker: "caller", text: "Two steak tacos with cheese." },
    { speaker: "caller", text: "Two more." },
  ];
  assert.equal(callerSpokenQty(english, "taco", "bistec", ""), 4);
  assert.deepEqual(staffQuantity(english, "taco", "bistec", 4, 4, ""), { quantity: 4, flag: false });
  assert.equal(callerSpokenQty([
    { speaker: "caller", text: "Two goat tacos." },
    { speaker: "caller", text: "Two more." },
  ], "taco", "goat", ""), 4);
  assert.equal(callerSpokenQty([
    { speaker: "caller", text: "Two tacos of potatoes." },
    { speaker: "caller", text: "Two more." },
  ], "taco", "deshebrada", ""), null);
  assert.equal(callerSpokenQty([
    { speaker: "caller", text: "Two tacos of cheese." },
    { speaker: "caller", text: "Two more." },
  ], "taco", "queso", ""), null);
});

test("a counted item after con is its own line, and las dos is an order", () => {
  for (const said of ["Dos tacos de bistec con dos de pollo.", "Dos tacos de bistec con un taco de pollo.", "Two steak tacos with two of chicken.", "Two steak tacos with one chicken taco."]) {
    const turns = [{ speaker: "caller", text: said }, { speaker: "caller", text: /two/i.test(said) ? "Two more." : "Dos más." }];
    assert.equal(callerSpokenQty(turns, "taco", "bistec", ""), 2, said);
    assert.deepEqual(staffQuantity(turns, "taco", "bistec", 4, 4, ""), { quantity: 2, flag: true }, said);
  }
  const later = [
    { speaker: "caller", text: "Dos tacos de pollo." },
    { speaker: "caller", text: "Las dos de bistec." },
    { speaker: "caller", text: "Dos más." },
  ];
  assert.equal(callerSpokenQty(later, "taco", "pollo", ""), 2);
  assert.deepEqual(staffQuantity(later, "taco", "pollo", 4, 4, ""), { quantity: 2, flag: true });
  const together = [
    { speaker: "caller", text: "Las dos de bistec. Una quesadilla de pollo." },
    { speaker: "caller", text: "Dos más." },
  ];
  assert.equal(callerSpokenQty(together, "quesadilla", "pollo", ""), 1);
  assert.deepEqual(staffQuantity(together, "quesadilla", "pollo", 3, 3, ""), { quantity: 1, flag: true });
  const swapped = [
    { speaker: "caller", text: "Dos tacos de pollo no, con bistec." },
    { speaker: "caller", text: "Que sean tres." },
  ];
  assert.notEqual(callerSpokenQty(swapped, "taco", "pollo", ""), 3);
  assert.deepEqual(staffQuantity(swapped, "taco", "pollo", 3, 3, ""), { quantity: callerSpokenQty(swapped, "taco", "pollo", "") ?? 2, flag: true });
});

test("otro de bistec then que sean tres asks which line", async () => {
  for (const otra of ["Otro de bistec.", "Otra de bistec.", "Y otro de bistec.", "Y de bistec."]) {
    const ask = "Que sean tres.";
    const first = "Dos tacos de pollo.";
    const turns = [
      { speaker: "caller", text: first },
      { speaker: "caller", text: otra },
      { speaker: "caller", text: ask },
    ];
    assert.equal(callerSpokenQty(turns, "taco", "pollo", ""), 2, otra);
    assert.notEqual(callerSpokenQty(turns, "taco", "bistec", ""), 3, otra);
    assert.equal(ambiguousMakeIt(turns, 2), true, otra);
    assert.ok(openLineKeys(turns, 2).some((key) => key.endsWith("|bistec")), otra);
    assert.deepEqual(staffQuantity(turns, "taco", "pollo", 3, 3, ""), { quantity: 2, flag: true }, otra);
    const heard = staffQuantity(turns, "taco", "bistec", 3, 1, "");
    assert.equal(heard.flag, true, otra);
    assert.notEqual(heard.quantity, 3, otra);
  }
  const between = [
    { speaker: "caller", text: "Dos tacos de pollo." },
    { speaker: "caller", text: "Otro de bistec." },
    { speaker: "caller", text: "Sí." },
    { speaker: "caller", text: "Que sean tres." },
  ];
  assert.equal(ambiguousMakeIt(between, 3), true);
  assert.equal(callerSpokenQty(between, "taco", "pollo", ""), 2);
  assert.notEqual(callerSpokenQty(between, "taco", "bistec", ""), 3);
  assert.equal(staffQuantity(between, "taco", "bistec", 3, 1, "").flag, true);
  const order: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, language: "es", text: "Dos tacos de pollo." },
    { speaker: "staff", start: 1, end: 2, language: "es", text: "Ok." },
    { speaker: "caller", start: 3, end: 4, language: "es", text: "Otro de bistec." },
    { speaker: "staff", start: 4, end: 5, language: "es", text: "Ok." },
    { speaker: "caller", start: 6, end: 7, language: "es", text: "Que sean tres." },
  ] as any, shadowRun((text) => /otro/i.test(text)
    ? { actions: [{ type: "add_item", itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }] }], reply: "ok" }
    : /pollo/i.test(text)
      ? { actions: [{ type: "add_item", itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Pollo / Chicken" }] }], reply: "ok" }
      : { actions: [{ type: "update_item", itemId: "sq-taco-TAR7L5", quantity: 3 }], reply: "guess" }));
  assert.match((order.steps || []).map((step: any) => step.reply).join(" "), /¿Que sean tres de cuál platillo\?/);
  assert.equal((order.cart || []).some((line: any) => line.quantity === 3), false);
  const extra = openLineKeys([
    { speaker: "caller", text: "Otro de bistec chorizo." },
    { speaker: "caller", text: "Listo." },
  ], 1);
  assert.ok(extra.some((key) => key.endsWith("|bistec")));
  assert.equal(extra.some((key) => key.endsWith("|chorizo")), false);
  const timed = [
    { speaker: "caller", text: "A las dos de bistec." },
    { speaker: "caller", text: "Una quesadilla." },
    { speaker: "caller", text: "Dos más." },
  ];
  assert.ok(openLineKeys(timed, 2).includes("|bistec"));
  assert.notEqual(callerSpokenQty(timed, "taco", "bistec", ""), 2);
  assert.equal(ambiguousMore(timed, 2), true);
  const asked: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, language: "es", text: "A las dos de bistec." },
    { speaker: "staff", start: 1, end: 2, language: "es", text: "Ok." },
    { speaker: "caller", start: 3, end: 4, language: "es", text: "Una quesadilla." },
    { speaker: "staff", start: 4, end: 5, language: "es", text: "Ok." },
    { speaker: "caller", start: 6, end: 7, language: "es", text: "Dos más." },
  ] as any, shadowRun(() => ({ actions: [], reply: "ok" })));
  assert.match((asked.steps || []).map((step: any) => step.reply).join(" "), /¿Dos más de cuál platillo\?/);
  for (const said of ["A las dos de la mañana.", "Son las dos de la noche.", "A las dos de la tarde.", "Son las dos en punto.", "A las dos.", "Son las dos."]) {
    assert.equal(callerSpokenQty([
      { speaker: "caller", text: "Un taco de pollo." },
      { speaker: "caller", text: said },
      { speaker: "caller", text: "Dos más." },
    ], "taco", "pollo", ""), 3, said);
    assert.equal(openLineKeys([
      { speaker: "caller", text: said },
      { speaker: "caller", text: "Listo." },
    ], 1).length, 0, said);
  }
});

test("que sean tres asks when the second line is another meat or a dish", async () => {
  for (const otra of ["Otra de carne asada.", "Otro de chicharrón prensado.", "Otro de la de bistec."]) {
    const turns = [
      { speaker: "caller", text: "Dos tacos de pollo." },
      { speaker: "caller", text: otra },
      { speaker: "caller", text: "Que sean tres." },
    ];
    const meat = /prensado/i.test(otra) ? "prensado" : "bistec";
    assert.equal(callerSpokenQty(turns, "taco", "pollo", ""), 2, otra);
    assert.notEqual(callerSpokenQty(turns, "taco", meat, ""), 3, otra);
    assert.equal(ambiguousMakeIt(turns, 2), true, otra);
    assert.ok(openLineKeys(turns, 2).some((key) => key.endsWith(`|${meat}`)), otra);
    assert.deepEqual(staffQuantity(turns, "taco", "pollo", 3, 3, ""), { quantity: 2, flag: true }, otra);
    const heard = staffQuantity(turns, "taco", meat, 3, 1, "");
    assert.equal(heard.flag, true, otra);
    assert.notEqual(heard.quantity, 3, otra);
  }
  for (const otra of ["And another steak.", "Another of steak."]) {
    const turns = [
      { speaker: "caller", text: "Two chicken tacos." },
      { speaker: "caller", text: otra },
      { speaker: "caller", text: "Make it three." },
    ];
    assert.equal(callerSpokenQty(turns, "taco", "pollo", ""), 2, otra);
    assert.notEqual(callerSpokenQty(turns, "taco", "bistec", ""), 3, otra);
    assert.equal(ambiguousMakeIt(turns, 2), true, otra);
    assert.ok(openLineKeys(turns, 2).some((key) => key.endsWith("|bistec")), otra);
    assert.deepEqual(staffQuantity(turns, "taco", "pollo", 3, 3, ""), { quantity: 2, flag: true }, otra);
    const heard = staffQuantity(turns, "taco", "bistec", 3, 1, "");
    assert.equal(heard.flag, true, otra);
    assert.notEqual(heard.quantity, 3, otra);
  }
  const english: any = await shadowOrderFromTurns([
    { speaker: "caller", start: 0, end: 1, language: "en", text: "Two chicken tacos." },
    { speaker: "staff", start: 1, end: 2, language: "en", text: "Ok." },
    { speaker: "caller", start: 3, end: 4, language: "en", text: "And another steak." },
    { speaker: "staff", start: 4, end: 5, language: "en", text: "Ok." },
    { speaker: "caller", start: 6, end: 7, language: "en", text: "Make it three." },
  ] as any, shadowRun(() => ({ actions: [{ type: "update_item", itemId: "sq-taco-TAR7L5", quantity: 3 }], reply: "guess" })));
  assert.match((english.steps || []).map((step: any) => step.reply).join(" "), /Three of which dish\?/);
  assert.equal((english.cart || []).some((line: any) => line.quantity === 3), false);
  for (const said of ["Dos tacos de bistec y una torta.", "Dos tacos de bistec, una quesadilla."]) {
    const turns = [
      { speaker: "caller", text: said },
      { speaker: "caller", text: "Que sean tres." },
    ];
    const dish = /torta/.test(said) ? "torta" : "quesadilla";
    assert.equal(callerSpokenQty(turns, "taco", "bistec", ""), 2, said);
    assert.equal(ambiguousMakeIt(turns, 1), true, said);
    assert.ok(openLineKeys(turns, 1).some((key) => key.startsWith(`${dish}|`)), said);
    assert.deepEqual(staffQuantity(turns, "taco", "bistec", 3, 3, ""), { quantity: 2, flag: true }, said);
  }
  const flipped = [
    { speaker: "caller", text: "Una torta de pollo y dos tacos." },
    { speaker: "caller", text: "Que sean tres." },
  ];
  assert.equal(callerSpokenQty(flipped, "torta", "pollo", ""), 1);
  assert.equal(ambiguousMakeIt(flipped, 1), true);
  assert.ok(openLineKeys(flipped, 1).some((key) => key.startsWith("taco|")));
  assert.deepEqual(staffQuantity(flipped, "torta", "pollo", 3, 3, ""), { quantity: 1, flag: true });
  const before = [
    { speaker: "caller", text: "Antes de las dos, de bistec." },
    { speaker: "caller", text: "Listo." },
  ];
  assert.ok(openLineKeys(before, 1).some((key) => key.endsWith("|bistec")));
  assert.notEqual(callerSpokenQty(before, "taco", "bistec", ""), 2);
});

test("a later meat fills the dish instead of leaving a second key", () => {
  const check = (said: string, meat: string, more: string) => {
    const base = [{ speaker: "caller", text: said }];
    const added = [...base, { speaker: "caller", text: more }];
    const set = [...base, { speaker: "caller", text: /two/i.test(more) ? "Make it three." : "Que sean tres." }];
    assert.equal(callerSpokenQty(added, "taco", meat, ""), 4, said);
    assert.deepEqual(staffQuantity(added, "taco", meat, 2, 2, ""), { quantity: 4, flag: true }, said);
    assert.equal(callerSpokenQty(set, "taco", meat, ""), 3, said);
    assert.deepEqual(staffQuantity(set, "taco", meat, 2, 2, ""), { quantity: 3, flag: true }, said);
  };
  check("Dos tacos. Las dos de bistec.", "bistec", "Dos más.");
  check("Dos tacos, los dos de bistec.", "bistec", "Dos más.");
  check("Dos tacos. De bistec.", "bistec", "Dos más.");
  check("Two tacos. Steak.", "bistec", "Two more.");
  const onion = [{ speaker: "caller", text: "Tres tacos. Uno de bistec no cebolla." }];
  const onionMore = [...onion, { speaker: "caller", text: "Dos más." }];
  const before = callerSpokenQty(onion, "taco", "bistec", "");
  assert.equal(callerSpokenQty(onionMore, "taco", "bistec", ""), (before || 0) + 2);
  assert.equal(staffQuantity(onionMore, "taco", "bistec", before || 0, before || 0, "").flag, true);
  const asked = [
    { speaker: "caller", text: "Dos tacos." },
    { speaker: "staff", text: "¿De qué?" },
    { speaker: "caller", text: "Las dos de pollo." },
  ];
  assert.equal(callerSpokenQty([...asked, { speaker: "caller", text: "Dos más." }], "taco", "pollo", ""), 4);
  assert.deepEqual(staffQuantity([...asked, { speaker: "caller", text: "Dos más." }], "taco", "pollo", 2, 2, ""), { quantity: 4, flag: true });
  assert.equal(callerSpokenQty([...asked, { speaker: "caller", text: "Que sean tres." }], "taco", "pollo", ""), 3);
  assert.deepEqual(staffQuantity([...asked, { speaker: "caller", text: "Que sean tres." }], "taco", "pollo", 2, 2, ""), { quantity: 3, flag: true });
  const guessed = [
    { speaker: "caller", text: "Dos tacos de pollo." },
    { speaker: "caller", text: "Otro de bistec." },
    { speaker: "caller", text: "Mejor que sean tres." },
  ];
  assert.notEqual(callerSpokenQty(guessed, "taco", "pollo", ""), 3);
  assert.notEqual(callerSpokenQty(guessed, "taco", "bistec", ""), 3);
  assert.equal(staffQuantity(guessed, "taco", "pollo", 3, 3, "").flag, true);
  assert.equal(staffQuantity(guessed, "taco", "bistec", 3, 1, "").flag, true);
  for (const side of ["y una coca", "y una horchata", "y un consomé", "y unos nachos"]) {
    const turns = [
      { speaker: "caller", text: `Dos tacos de bistec ${side}.` },
      { speaker: "caller", text: "Que sean tres." },
    ];
    assert.notEqual(callerSpokenQty(turns, "taco", "bistec", ""), 3, side);
    assert.equal(staffQuantity(turns, "taco", "bistec", 3, 3, "").flag, true, side);
  }
  for (const filler of ["Sí, por favor.", "Claro."]) {
    const turns = [
      { speaker: "caller", text: "Dos tacos de bistec y una torta." },
      { speaker: "caller", text: filler },
      { speaker: "caller", text: "Que sean tres." },
    ];
    assert.equal(ambiguousMakeIt(turns, 2), true, filler);
    assert.equal(callerSpokenQty(turns, "taco", "bistec", ""), 2, filler);
    const otra = [
      { speaker: "caller", text: "Dos tacos de pollo." },
      { speaker: "caller", text: "Otro de bistec." },
      { speaker: "caller", text: filler },
      { speaker: "caller", text: "Que sean tres." },
    ];
    assert.equal(ambiguousMakeIt(otra, 3), true, filler);
    assert.notEqual(callerSpokenQty(otra, "taco", "bistec", ""), 3, filler);
  }
});

test("an unresolved count flags the staff readback", () => {
  const onion = [
    { speaker: "caller", text: "Dos tacos." },
    { speaker: "caller", text: "Una con cebolla." },
    { speaker: "caller", text: "Las dos de bistec." },
    { speaker: "caller", text: "Que sean tres." },
  ];
  assert.equal(callerSpokenQty(onion, "taco", "bistec", ""), 3);
  assert.equal(staffQuantity(onion, "taco", "bistec", 2, 2, "").flag, true);
  const timed = [
    { speaker: "caller", text: "Dos tacos." },
    { speaker: "caller", text: "A las dos." },
    { speaker: "caller", text: "De bistec." },
    { speaker: "caller", text: "Que sean tres." },
  ];
  assert.equal(callerSpokenQty(timed, "taco", "bistec", ""), 3);
  assert.equal(staffQuantity(timed, "taco", "bistec", 2, 2, "").flag, true);
  for (const said of ["Make it two, and a coke.", "Mejor tres, y una horchata.", "Hazlo dos y una coca."]) {
    const turns = [
      { speaker: "caller", text: "Two steak tacos and one chicken taco." },
      { speaker: "caller", text: said },
    ];
    const made = /tres/.test(said) ? 3 : 2;
    assert.notEqual(callerSpokenQty(turns, "taco", "pollo", ""), made, said);
    assert.equal(staffQuantity(turns, "taco", "pollo", made, made, "").flag, true, said);
    assert.equal(staffQuantity(turns, "taco", "bistec", 2, 2, "").flag, true, said);
  }
  const missed = [
    { speaker: "caller", text: "Dos tacos de bistec y una torta." },
    { speaker: "caller", text: "Que sean tres." },
  ];
  assert.equal(callerSpokenQty(missed, "taco", "bistec", ""), 2);
  assert.equal(staffQuantity(missed, "taco", "bistec", 2, 2, "").flag, true);
  assert.equal(staffQuantity(missed, "torta", "", 2, 2, "").flag, true);
});

test("a time plus a meat stays open beside the next dish", () => {
  for (const said of ["Para las dos, de bistec.", "A las dos, de bistec.", "Son las dos, de bistec.", "Ya son las dos, de bistec.", "Dame a las dos de bistec.", "De bistec, para las dos."]) {
    const turns = [
      { speaker: "caller", text: said },
      { speaker: "caller", text: "Una quesadilla de pollo." },
      { speaker: "caller", text: "Dos más." },
    ];
    assert.equal(callerSpokenQty(turns, "quesadilla", "pollo", ""), 1, said);
    assert.equal(staffQuantity(turns, "quesadilla", "pollo", 3, 3, "").flag, true, said);
    assert.ok(openLineKeys(turns, 2).some((key) => key.endsWith("|bistec")), said);
  }
  const scoped = [
    { speaker: "caller", text: "Dos tacos de bistec y una torta." },
    { speaker: "caller", text: "Que sean tres." },
    { speaker: "caller", text: "Y una coca." },
  ];
  assert.equal(staffQuantity(scoped, "taco", "bistec", 2, 2, "").flag, true);
  assert.equal(staffQuantity(scoped, "coca", "", 1, 1, "").flag, false);
  const named = [
    { speaker: "caller", text: "Dos tacos de bistec y una torta." },
    { speaker: "caller", text: "Que sean tres." },
    { speaker: "caller", text: "De bistec." },
  ];
  assert.equal(staffQuantity(named, "taco", "bistec", 2, 2, "").flag, true);
  assert.equal(staffQuantity(named, "torta", "", 2, 2, "").flag, false);
  const missed = [
    { speaker: "caller", text: "Dos tacos de bistec y una memela." },
    { speaker: "caller", text: "Que sean tres." },
  ];
  assert.equal(openLineKeys(missed, 1).some((key) => key.includes("memela")), false);
  assert.equal(callerSpokenQty(missed, "taco", "bistec", ""), 3);
  assert.equal(staffQuantity(missed, "taco", "bistec", 3, 3, "").flag, true);
  assert.equal(staffQuantity(missed, "memela", "", 1, 1, "").flag, true);
});

test("a time meat fills the earlier tacos and a bare side does not flag", () => {
  const pastor = [
    { speaker: "caller", text: "Dos tacos." },
    { speaker: "caller", text: "Para las dos, de pastor." },
  ];
  assert.equal(callerSpokenQty([...pastor, { speaker: "caller", text: "Dos más." }], "taco", "alpastor", ""), 4);
  assert.equal(staffQuantity([...pastor, { speaker: "caller", text: "Dos más." }], "taco", "alpastor", 2, 2, "").flag, true);
  assert.equal(callerSpokenQty([...pastor, { speaker: "caller", text: "Que sean tres." }], "taco", "alpastor", ""), 3);
  assert.equal(staffQuantity([...pastor, { speaker: "caller", text: "Que sean tres." }], "taco", "alpastor", 2, 2, "").flag, true);
  const asked = [
    { speaker: "caller", text: "Dos tacos." },
    { speaker: "staff", text: "¿De qué?" },
    { speaker: "caller", text: "Son las dos de pollo." },
    { speaker: "caller", text: "Que sean tres." },
  ];
  assert.equal(callerSpokenQty(asked, "taco", "pollo", ""), 3);
  assert.equal(staffQuantity(asked, "taco", "pollo", 2, 2, "").flag, true);
  const both = [
    { speaker: "caller", text: "Para las dos, dos de bistec y una de pollo." },
    { speaker: "caller", text: "Dos más." },
  ];
  assert.ok(openLineKeys(both, 1).some((key) => key.endsWith("|bistec")));
  assert.ok(openLineKeys(both, 1).some((key) => key.endsWith("|pollo")));
  assert.equal(staffQuantity(both, "taco", "bistec", 2, 2, "").flag, true);
  assert.equal(staffQuantity(both, "taco", "pollo", 1, 1, "").flag, true);
  const shared = [
    { speaker: "caller", text: "Un taco de bistec y una quesadilla de bistec." },
    { speaker: "caller", text: "Que sean tres." },
    { speaker: "caller", text: "De bistec." },
  ];
  assert.equal(staffQuantity(shared, "taco", "bistec", 1, 1, "").flag, true);
  assert.equal(staffQuantity(shared, "quesadilla", "bistec", 1, 1, "").flag, true);
  const dishOnly = [
    { speaker: "caller", text: "Dos tacos de bistec y una torta." },
    { speaker: "caller", text: "Que sean tres." },
    { speaker: "caller", text: "Los tacos." },
  ];
  assert.equal(staffQuantity(dishOnly, "taco", "bistec", 2, 2, "").flag, true);
  assert.equal(staffQuantity(dishOnly, "torta", "", 2, 2, "").flag, true);
  for (const said of ["Dos tacos de bistec y luego.", "Dos tacos de bistec y nomás.", "Dos tacos de bistec y ahorita.", "Dos tacos de bistec y mejor.", "Dos tacos de bistec y Juan.", "Two steak tacos and thanks."]) {
    const turns = [
      { speaker: "caller", text: said },
      { speaker: "caller", text: /two/i.test(said) ? "Make it three." : "Que sean tres." },
    ];
    assert.equal(callerSpokenQty(turns, "taco", "bistec", ""), 3, said);
    assert.equal(staffQuantity(turns, "taco", "bistec", 3, 3, "").flag, false, said);
  }
});

test("extra count phrases flag and do not change the quantity", () => {
  for (const said of ["Dos extra.", "Agrégale dos.", "Súbele a tres.", "Tres en total.", "Uno menos.", "Quítale uno.", "Ponle otro.", "Two extra.", "Let's do three."]) {
    const base = [{ speaker: "caller", text: "Dos tacos de bistec." }];
    const turns = [...base, { speaker: "caller", text: said }];
    assert.equal(callerSpokenQty(turns, "taco", "bistec", ""), 2, said);
    assert.equal(staffQuantity(turns, "taco", "bistec", 2, 2, "").flag, true, said);
  }
  const two = [
    { speaker: "caller", text: "Dos tacos de bistec y una torta." },
    { speaker: "caller", text: "Dos extra." },
    { speaker: "caller", text: "Y una coca." },
  ];
  assert.equal(callerSpokenQty(two, "taco", "bistec", ""), 2);
  assert.equal(staffQuantity(two, "taco", "bistec", 2, 2, "").flag, true);
  assert.equal(staffQuantity(two, "coca", "", 1, 1, "").flag, false);
  for (const said of ["Agrégale tres.", "Súbele a cuatro.", "Dos menos.", "Three extra.", "Let's do four."]) {
    const turns = [
      { speaker: "caller", text: "Dos tacos de bistec." },
      { speaker: "caller", text: said },
    ];
    assert.equal(callerSpokenQty(turns, "taco", "bistec", ""), 2, said);
    assert.equal(staffQuantity(turns, "taco", "bistec", 2, 2, "").flag, true, said);
  }
  for (const word of ["cheese", "lettuce", "guacamole", "refried", "classic", "toppings"]) {
    const keys = openLineKeys([
      { speaker: "caller", text: `Quiero ${word}.` },
      { speaker: "caller", text: "Listo." },
    ], 1);
    assert.equal(keys.some((key) => key.startsWith(`${word}|`)), false, word);
  }
});

test("only a real first answer clears the other line", () => {
  const base = [
    { speaker: "caller", text: "Un taco de bistec y un taco de pollo." },
    { speaker: "caller", text: "Que sean tres." },
  ];
  for (const said of ["Pollo no, bistec.", "No el de bistec, el de pollo.", "De bistec y de pollo.", "¿El de bistec lleva cebolla?"]) {
    const turns = [...base, { speaker: "caller", text: said }];
    assert.equal(staffQuantity(turns, "taco", "bistec", 1, 1, "").flag, true, said);
    assert.equal(staffQuantity(turns, "taco", "pollo", 1, 1, "").flag, true, said);
  }
  const later = [
    { speaker: "caller", text: "Dos tacos de bistec y una torta." },
    { speaker: "caller", text: "Que sean tres." },
    { speaker: "caller", text: "De bistec." },
    { speaker: "caller", text: "De pollo." },
  ];
  assert.equal(staffQuantity(later, "taco", "bistec", 2, 2, "").flag, true);
  assert.equal(staffQuantity(later, "torta", "", 2, 2, "").flag, false);
  for (const said of ["Dos tacos de bistec y a domicilio.", "Dos tacos de bistec y a recoger.", "Dos tacos de bistec y a nombre de Juan."]) {
    const turns = [
      { speaker: "caller", text: said },
      { speaker: "caller", text: "Que sean tres." },
    ];
    assert.equal(callerSpokenQty(turns, "taco", "bistec", ""), 3, said);
    assert.equal(staffQuantity(turns, "taco", "bistec", 3, 3, "").flag, false, said);
  }
  for (const said of ["21 en total.", "Treinta en total.", "Tres en total pesos.", "10 dollars en total."]) {
    const turns = [
      { speaker: "caller", text: "Dos tacos de bistec." },
      { speaker: "caller", text: said },
    ];
    assert.equal(callerSpokenQty(turns, "taco", "bistec", ""), 2, said);
    assert.equal(staffQuantity(turns, "taco", "bistec", 2, 2, "").flag, false, said);
  }
  const cheese = [
    { speaker: "caller", text: "Dos tacos de bistec." },
    { speaker: "caller", text: "Una extra de queso." },
  ];
  assert.equal(callerSpokenQty(cheese, "taco", "bistec", ""), 2);
  assert.equal(staffQuantity(cheese, "taco", "bistec", 2, 2, "").flag, true);
});

test("a later una de does not cancel a count hint", () => {
  for (const said of [
    "Agrégale dos y una de pollo.",
    "Quítale uno, y una de bistec.",
    "Dos extra y una de queso.",
    "Súbele a tres y una de asada.",
    "Ponle otro y una de pollo.",
    "Tres en total y uno de bistec.",
    "Uno menos, y una de pastor.",
    "Agrégale dos, una de cada una.",
  ]) {
    const turns = [
      { speaker: "caller", text: "Dos tacos de bistec." },
      { speaker: "caller", text: said },
    ];
    const qty = callerSpokenQty(turns, "taco", "bistec", "");
    assert.equal(staffQuantity(turns, "taco", "bistec", qty ?? 2, qty ?? 2, "").flag, true, said);
  }
});

test("a later count phrase still flags when an earlier una is a topping", () => {
  const must = [
    "Agrégale una de queso y agrégale dos.",
    "Quítale una cebolla y quítale uno.",
    "Quítale una salsa, y quítale dos.",
    "Súbele a una de crema y súbele a tres.",
    "Agrégale uno de bistec.",
    "Quítale uno de pollo.",
    "Agrégale una de bistec y una de pollo.",
    "Agrégale uno de cada uno.",
    "Quítale uno, de los de bistec.",
    "Uno extra.",
    "Una extra.",
  ];
  for (const said of must) {
    const turns = [
      { speaker: "caller", text: "Dos tacos de bistec." },
      { speaker: "caller", text: said },
    ];
    const qty = callerSpokenQty(turns, "taco", "bistec", "");
    assert.equal(staffQuantity(turns, "taco", "bistec", qty ?? 2, qty ?? 2, "").flag, true, said);
  }
  for (const said of ["Agrégale uno de bistec.", "Uno extra.", "Agrégale una de queso y agrégale dos."]) {
    const two = [
      { speaker: "caller", text: "Dos tacos de bistec y una quesadilla de pollo." },
      { speaker: "caller", text: said },
    ];
    const qty = callerSpokenQty(two, "taco", "bistec", "");
    assert.equal(staffQuantity(two, "taco", "bistec", qty ?? 2, qty ?? 2, "").flag, true, said);
  }
  const readback = [
    { speaker: "caller", text: "Dos tacos de bistec." },
    { speaker: "caller", text: "Agrégale uno de bistec." },
  ];
  assert.equal(staffQuantity(readback, "taco", "bistec", 1, 1, "").flag, true);
});

test("every una count phrase flags", () => {
  const phrases = [
    "Una extra de bistec.",
    "Uno extra de pollo.",
    "Una extra de cada uno.",
    "Agrégale una de crema y otra de bistec.",
    "Agrégale una de queso, ahora son tres.",
  ];
  for (const said of phrases) {
    const one = [
      { speaker: "caller", text: "Dos tacos de bistec." },
      { speaker: "caller", text: said },
    ];
    const oneQty = callerSpokenQty(one, "taco", "bistec", "");
    assert.equal(staffQuantity(one, "taco", "bistec", oneQty ?? 2, oneQty ?? 2, "").flag, true, said);
    const two = [
      { speaker: "caller", text: "Dos tacos de bistec y una quesadilla de pollo." },
      { speaker: "caller", text: said },
    ];
    const twoQty = callerSpokenQty(two, "taco", "bistec", "");
    assert.equal(staffQuantity(two, "taco", "bistec", twoQty ?? 2, twoQty ?? 2, "").flag, true, `two ${said}`);
  }
  const readback = [
    { speaker: "caller", text: "Dos tacos de bistec." },
    { speaker: "caller", text: "Una extra de bistec." },
  ];
  assert.equal(staffQuantity(readback, "taco", "bistec", 1, 1, "").flag, true);
  for (const turns of [
    [
      { speaker: "caller", text: "Una gordita con queso." },
      { speaker: "caller", text: "Agrégale una de queso." },
    ],
    [
      { speaker: "caller", text: "Una gordita con queso y dos tacos de bistec." },
      { speaker: "caller", text: "Agrégale una de queso." },
    ],
  ]) {
    const qty = callerSpokenQty(turns, "gordita", "", "");
    assert.equal(staffQuantity(turns, "gordita", "", qty ?? 1, qty ?? 1, "").flag, true);
  }
});

test("a continued bistec and an alias are one open line", () => {
  assert.equal(callerSpokenQty([
    { speaker: "caller", text: "Dos tacos de bistec." },
    { speaker: "caller", text: "Y otro de bistec." },
    { speaker: "caller", text: "Dos más." },
  ], "taco", "bistec", ""), 5);
  assert.equal(callerSpokenQty([
    { speaker: "caller", text: "Un taco de asada." },
    { speaker: "caller", text: "Y un taco de bistec." },
    { speaker: "caller", text: "Dos más." },
  ], "taco", "bistec", ""), 3);
  assert.equal(callerSpokenQty([
    { speaker: "caller", text: "Hola, buenos días." },
    { speaker: "caller", text: "Dos tacos de bistec." },
    { speaker: "caller", text: "Dos más." },
  ], "taco", "bistec", ""), 4);
});
