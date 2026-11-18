import assert from "node:assert/strict";
import test from "node:test";
import { applyAffirmedStaffList, applyLineScopedQuantity, applyStaffReadback, liveMeatSplitQty, parseList } from "../../src/list-repair.ts";
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

test("a trailing más or plus names the next item, EN and ES", () => {
  const line = () => ({ itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }] });
  const es = [line()];
  const en = [line()];
  applyLineScopedQuantity(es, [{ speaker: "caller", text: "Dos tacos de chorizo más una coca." }], menu);
  applyLineScopedQuantity(en, [{ speaker: "caller", text: "Two chorizo tacos plus a coke." }], menu);
  assert.equal(es[0].quantity, 2);
  assert.equal(en[0].quantity, 2);
  assert.equal(es.find((row) => /coca/i.test(row.itemId))?.quantity, 1);
  assert.equal(en.find((row) => /coca/i.test(row.itemId))?.quantity, 1);
});

test("otro de pastor is a new taco, EN and ES", () => {
  const line = () => ({ itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }] });
  const es = [line()];
  const en = [line()];
  applyLineScopedQuantity(es, [{ speaker: "caller", text: "Dos tacos de chorizo, otro de pastor." }], menu);
  applyLineScopedQuantity(en, [{ speaker: "caller", text: "Two chorizo tacos, another one of pastor." }], menu);
  assert.equal(es[0].quantity, 2);
  assert.equal(en[0].quantity, 2);
  const pastor = (cart: any[]) => cart.find((row) => (row.modifiers || []).some((mod: any) => /pastor/i.test(String(mod.option))));
  assert.equal(pastor(es)?.quantity, 1);
  assert.equal(pastor(en)?.quantity, 1);
});

test("confirm-only shadow readback stays off unless the flag is set", () => {
  const line = () => ({ itemId: "sq-taco-TAR7L5", quantity: 2, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Chorizo / Mexican Sausage" }, { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" }] });
  const bistec = () => ({ itemId: "sq-taco-TAR7L5", quantity: 1, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }, { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" }] });
  const turns = [{ speaker: "staff", text: "Te tengo seis tacos de chorizo y tres tacos de bistec." }];
  const previous = process.env.ELVI_SHADOW_READBACK_CONFIRM_ONLY;
  delete process.env.ELVI_SHADOW_READBACK_CONFIRM_ONLY;
  const off = [line(), bistec()];
  applyStaffReadback(off, turns, menu, true);
  assert.equal(off[0].quantity, 6);
  assert.equal(off[1].quantity, 3);
  assert.equal((off as any).readbackFlags, undefined);
  process.env.ELVI_SHADOW_READBACK_CONFIRM_ONLY = "1";
  const on = [line(), bistec()];
  applyStaffReadback(on, turns, menu, true);
  assert.equal(on[0].quantity, 2);
  assert.equal(on[1].quantity, 1);
  assert.ok((on as any).readbackFlags.some((flag: string) => flag.startsWith("quantity:")));
  const live = [line(), bistec()];
  applyStaffReadback(live, turns, menu, false);
  assert.equal(live[0].quantity, 6);
  assert.equal(live[1].quantity, 3);
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
