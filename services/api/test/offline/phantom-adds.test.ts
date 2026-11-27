import assert from "node:assert/strict";
import test from "node:test";
import { catalogAddAllowed } from "../../src/menu-names.ts";
import { applyAffirmedStaffList } from "../../src/list-repair.ts";
import { isTotalOnlyCall } from "../../src/readback-pass.ts";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { frozenPhoneMenu } from "../../src/phone-menu.ts";

const menu = frozenPhoneMenu();
const run: any = async () => ({ actions: [], reply: "" });
run.menu = () => menu;

async function cartIds(turns: Array<{ speaker: string; text: string; language?: string }>) {
  const order: any = await shadowOrderFromTurns(turns.map((t, n) => ({ speaker: t.speaker, text: t.text, language: t.language || "es", start: n, end: n + 1 })) as any, run);
  return (order.cart || []).map((line: any) => String(line.itemId));
}

test("a shorter word does not name a pack, a dip, an extras row, or a side", () => {
  assert.equal(catalogAddAllowed("Elvis Dip", "Sí, buenas tardes.", "Cocina Elvis."), false);
  assert.equal(catalogAddAllowed("Elvis Dip", "Me da un elvis dip de bistec."), true);
  assert.equal(catalogAddAllowed("Elvis Dip", "A large bowl of queso with chorizo.", "Okay, queso dip, the Elvis dip."), true);
  assert.equal(catalogAddAllowed("8 Pack MEAL (GD) 8 x Gorditas", "Y una gordita de duro preparada, por favor."), false);
  assert.equal(catalogAddAllowed("Gordita", "Y una gordita de duro preparada, por favor."), true);
  assert.equal(catalogAddAllowed("Extras Cilantro 2oz", "regular is cilantro, okay"), false);
  assert.equal(catalogAddAllowed("Extras Cilantro 2oz", "ponme extra cilantro"), true);
  assert.equal(catalogAddAllowed("Sides Arroz / Rice", "tomatillos comes on the side"), false);
  assert.equal(catalogAddAllowed("Sides Arroz / Rice", "and one side of rice"), true);
  assert.equal(catalogAddAllowed("Platillo de Guisado", "Tengo carnes y guisados."), false);
  assert.equal(catalogAddAllowed("Menudo con Pata", "¿Me puede poner un menudo con pata?"), true);
  assert.equal(catalogAddAllowed("Coctel de Camaron / Shrimp Cocktail", "¿Tienen cóctel de camarón?"), true);
});

test("a greeting yes does not ring Elvis Dip", () => {
  const cart: any[] = [];
  applyAffirmedStaffList(cart, [
    { speaker: "staff", text: "Cocina Elvis." },
    { speaker: "caller", text: "Sí, buenas tardes." },
    { speaker: "caller", text: "dos quesadillas de lengua" },
  ], menu);
  assert.equal(cart.some((line) => /elvis-dip/i.test(String(line.itemId))), false);
});

test("a total callback is not a new order", () => {
  const turns = [
    { speaker: "staff", text: "Yes." },
    { speaker: "caller", text: "Hi, this is Destiny again." },
    { speaker: "caller", text: "I just forgot to get the total." },
    { speaker: "staff", text: "Okay, right now putting a seven, deluxe fried quesadillas, steak, and, three chicken deluxe, fry, and one side of rice grande." },
    { speaker: "caller", text: "Yes." },
    { speaker: "caller", text: "I just wanted the total price." },
    { speaker: "caller", text: "Seventy dollars and fifty cents." },
    { speaker: "caller", text: "Bye." },
  ];
  assert.equal(isTotalOnlyCall(turns), true);
  assert.equal(isTotalOnlyCall([{ speaker: "caller", text: "So total four." }, { speaker: "caller", text: "Yes, I have place to order. This is Jay for three, steak quesadilla fried." }]), false);
});

test("staff rice on a total callback does not land, and a real quesadilla order does not grow a dip", async () => {
  const total = await cartIds([
    { speaker: "staff", text: "Yes." },
    { speaker: "caller", text: "I just forgot to get the total.", language: "en" },
    { speaker: "staff", text: "one side of rice grande.", language: "en" },
    { speaker: "caller", text: "Yes.", language: "en" },
    { speaker: "caller", text: "I just wanted the total price.", language: "en" },
  ]);
  assert.deepEqual(total, []);
  const ordered = await cartIds([
    { speaker: "staff", text: "Cocina Elvis." },
    { speaker: "caller", text: "Sí, buenas tardes." },
    { speaker: "caller", text: "dos quesadillas de lengua" },
    { speaker: "caller", text: "de maíz" },
    { speaker: "caller", text: "y una de tripa." },
    { speaker: "caller", text: "Nada más." },
  ]);
  assert.equal(ordered.some((id: string) => /elvis-dip/i.test(id)), false);
  assert.equal(ordered.some((id: string) => /quesadilla/i.test(id)), true);
});
