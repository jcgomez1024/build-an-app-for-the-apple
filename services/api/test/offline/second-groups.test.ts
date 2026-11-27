import assert from "node:assert/strict";
import test from "node:test";
import { applySecondGroups, secondGroupWants } from "../../src/second-groups.ts";
import { frozenPhoneMenu } from "../../src/phone-menu.ts";
import { applyQuesadillaCombo } from "../../src/list-repair.ts";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";

const menu = frozenPhoneMenu();
const T = (speaker: string, text: string) => ({ speaker, text });

test("otras tres adds three more of the quesadillas already ordered", () => {
  const turns = [
    T("caller", "Me gustaría ordenar tres quesadillas de comal."),
    T("caller", "Serían de frijoles con bistec."),
    T("caller", "Me puede agregar otras tres, por favor?"),
    T("staff", "Igual?"),
    T("caller", "Sí, igual."),
  ];
  const wants = secondGroupWants(turns);
  const bistec = wants.find((w) => w.meat === "bistec");
  assert.equal(bistec?.n, 6);
  assert.equal(bistec?.frij, true);
  const cart: any[] = [{ itemId: "sq-quesadilla-HLT6CR", quantity: 3, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }, { step: "(C) Con / With", option: "**Con Frijoles / With Beans (+$0.50)" }, { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" }] }];
  applySecondGroups(cart, turns, menu);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 6);
});

test("dos de X y dos de Y stays two taco lines", () => {
  const turns = [
    T("caller", "Dos tacos de cabeza y dos al pastor de tortilla de comal, por favor."),
    T("caller", "Un agua de horchata."),
  ];
  const wants = secondGroupWants(turns);
  assert.equal(wants.find((w) => w.meat === "cabeza")?.n, 2);
  assert.equal(wants.find((w) => w.meat === "alpastor")?.n, 2);
  const cart: any[] = [];
  applySecondGroups(cart, turns, menu);
  assert.equal(cart.filter((l) => String(l.itemId).includes("taco")).length, 2);
});

test("otra orden does not replace the earlier quesadillas", () => {
  const turns = [
    T("caller", "La primera orden, tres quesadillas de bistec, al comal."),
    T("caller", "La otra orden son tres de tripa."),
    T("caller", "Otra es, son dos quesadillas de bistec, de comal."),
    T("caller", "Otra va a ser dos de pastor y una de bistec."),
  ];
  const wants = secondGroupWants(turns);
  assert.equal(wants.find((w) => w.meat === "bistec")?.n, 6);
  assert.equal(wants.find((w) => w.meat === "tripa")?.n, 3);
  assert.equal(wants.find((w) => w.meat === "alpastor")?.n, 2);
});

test("a repeated count in the same group does not double", () => {
  const turns = [
    T("caller", "Dos quesadillas de comal de pollo."),
    T("caller", "Dos quesadillas de pollo, de comal."),
  ];
  assert.equal(secondGroupWants(turns).find((w) => w.meat === "pollo")?.n, 2);
});

test("quesadillas said before the fried question stay deluxe", () => {
  const turns = [
    T("caller", "Can I get three steak,"),
    T("caller", "quesadillas, fried?"),
    T("staff", "Deluxe or regular?"),
    T("caller", "The one with everything on it."),
    T("caller", "Let me get three deluxe."),
  ];
  const wants = secondGroupWants(turns);
  const steak = wants.find((w) => w.meat === "bistec");
  assert.equal(steak?.kind, "qd");
  assert.equal(steak?.qd, "preparada");
  assert.equal(steak?.n, 3);
});

test("staff arroz con frijoles on two quesadillas, and a yes, is one combo", () => {
  const turns = [
    T("caller", "Me puede poner las dos quesadillas de harina y las dos de biste, por favor?"),
    T("staff", "Dos de harina, las dos de bistec, arroz con frijoles."),
    T("caller", "Sí, señor."),
  ];
  const cart: any[] = [{ itemId: "sq-quesadilla-HLT6CR", quantity: 2, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }, { step: "(A) Q Tortilla Options", option: "(QHR) Quesadilla Harina / Flour (+$0.75)" }, { step: "(C) Con / With", option: "**Con Frijoles / With Beans (+$0.50)" }] }];
  assert.equal(applyQuesadillaCombo(cart, turns), true);
  assert.equal(cart.some((l) => String(l.itemId).includes("combo-quesadillas")), true);
  assert.equal(cart.some((l) => String(l.itemId).startsWith("sq-quesadilla-")), false);
});

test("a quesadilla after menudo is added and the menudo stays", async () => {
  const run: any = async () => ({ actions: [], reply: "" });
  run.menu = () => menu;
  const turns = [
    T("staff", "Buen día."),
    T("caller", "Oye, tendrás menudo?"),
    T("staff", "Sí, claro."),
    T("caller", "Me puedes ordenar dos?"),
    T("staff", "Dos menudos, con pata o sin pata?"),
    T("caller", "Sin pata."),
    T("caller", "Tendrás birria?"),
    T("staff", "Claro."),
    T("caller", "Tres quesadillas con birria."),
    T("staff", "Tres quesadillas del comal de birria. Algo más?"),
    T("caller", "Ujú."),
    T("caller", "No, sería todo."),
  ].map((t, n) => ({ ...t, language: "es", start: n, end: n + 1 }));
  const order: any = await shadowOrderFromTurns(turns as any, run);
  const ids = (order.cart || []).map((l: any) => `${l.quantity} ${l.itemId}`);
  assert.ok(ids.some((id: string) => id.startsWith("2 ") && id.includes("menudo")));
  assert.ok(ids.some((id: string) => id.startsWith("3 ") && id.includes("quesadilla")));
});
