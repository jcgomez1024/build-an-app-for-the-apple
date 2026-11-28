import assert from "node:assert/strict";
import test from "node:test";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { frozenPhoneMenu } from "../../src/phone-menu.ts";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";
import { addressesIn, detectAddress } from "../../src/delivery.ts";

const menu = frozenPhoneMenu();
const run: any = async () => ({ actions: [], reply: "" });
run.menu = () => menu;

async function order(lines: Array<[string, string]>) {
  const turns = lines.map(([speaker, text], n) => ({ speaker, text, language: "es", start: n, end: n + 1 }));
  return shadowOrderFromTurns(turns as any, run) as any;
}
const opts = (line: any) => (line?.modifiers || []).map((mod: any) => String(mod.option)).join(" | ");

test("an agreed gordita stays on the cart", async () => {
  const result = await order([
    ["caller", "Quiero cuatro gorditas de costilla."],
    ["staff", "Cuatro gorditas de costilla, ¿verdad?"],
    ["caller", "Sí, así es."],
  ]);
  const line = (result.cart || []).find((row: any) => /gordita/.test(String(row.itemId)));
  assert.ok(line);
  assert.equal(line.quantity, 4);
  assert.match(opts(line), /Costilla/);
  assert.equal(result.noOrder, undefined);
});

test("a repeated readback does not add a second taco line", async () => {
  const result = await order([
    ["caller", "Dame dos tacos de harina de lengua."],
    ["staff", "Dos tacos de harina de lengua."],
    ["caller", "Sí, dos tacos de harina de lengua."],
  ]);
  const tacos = (result.cart || []).filter((row: any) => /^sq-taco-/.test(String(row.itemId)));
  assert.equal(tacos.length, 1);
  assert.equal(tacos[0].quantity, 2);
});

test("a question about an item adds nothing", async () => {
  const result = await order([
    ["caller", "¿Tienen horchata?"],
    ["staff", "Sí, tenemos horchata."],
    ["caller", "¿Qué trae el mole?"],
  ]);
  assert.equal((result.cart || []).length, 0);
});

test("regular after a pata question is not con pata and is not an empty order", async () => {
  const result = await order([
    ["caller", "Un menudo, por favor."],
    ["staff", "¿Lo prefiere con pata, o regular?"],
    ["caller", "Regular."],
    ["staff", "Un menudo regular."],
    ["caller", "Sí."],
  ]);
  assert.equal(result.noOrder, undefined);
  assert.equal((result.cart || []).length, 1);
  assert.match(String(result.cart[0].itemId), /menudo/);
  assert.doesNotMatch(String(result.cart[0].itemId), /con-pata/);
});

test("a flour answer updates the quesadilla instead of adding a second line", async () => {
  const result = await order([
    ["caller", "Dos quesadillas de pollo."],
    ["staff", "¿De comal o de harina?"],
    ["caller", "De harina."],
  ]);
  const lines = (result.cart || []).filter((row: any) => /quesadilla/.test(String(row.itemId)));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].quantity, 2);
  assert.match(opts(lines[0]), /Harina|Flour/);
  assert.match(opts(lines[0]), /Pollo/);
});

test("an opening total is split across the meats that follow", async () => {
  const result = await order([
    ["caller", "Cinco quesadillas en total."],
    ["caller", "Una de pastor, una de pollo y tres de lengua."],
  ]);
  const lines = (result.cart || []).filter((row: any) => /quesadilla/.test(String(row.itemId)));
  const qty = (meat: RegExp) => lines.filter((line: any) => meat.test(opts(line))).reduce((sum: number, line: any) => sum + line.quantity, 0);
  assert.equal(qty(/pastor/i), 1);
  assert.equal(qty(/pollo/i), 1);
  assert.equal(qty(/lengua/i), 3);
  assert.equal(lines.reduce((sum: number, line: any) => sum + line.quantity, 0), 5);
});

test("a count does not carry onto the next dish", async () => {
  const result = await order([["caller", "Dos tacos de comal de pollo y una quesadilla de bistec."]]);
  const taco = (result.cart || []).find((row: any) => /^sq-taco-/.test(String(row.itemId)));
  const quesadilla = (result.cart || []).find((row: any) => /^sq-quesadilla-/.test(String(row.itemId)));
  assert.equal(taco?.quantity, 2);
  assert.equal(quesadilla?.quantity, 1);
  assert.match(opts(quesadilla), /Bistec/);
});

test("bistec con chorizo stays one quesadilla", async () => {
  const result = await order([["caller", "Una quesadilla de comal de bistec con chorizo."]]);
  const lines = result.cart || [];
  assert.equal(lines.length, 1);
  assert.match(opts(lines[0]), /Bistec/);
  assert.match(opts(lines[0]), /Chorizo/);
});

test("a meat answer fills the empty taco", async () => {
  const result = await order([
    ["caller", "Dos tacos de comal."],
    ["staff", "¿De qué carne?"],
    ["caller", "De tripa."],
  ]);
  const taco = (result.cart || []).find((row: any) => /^sq-taco-/.test(String(row.itemId)));
  assert.equal(taco?.quantity, 2);
  assert.match(opts(taco), /Tripa/);
});

test("an agreed sope keeps the count and the meat", async () => {
  const result = await order([
    ["caller", "Dame cuatro sopes de costilla."],
    ["staff", "Cuatro sopes de costilla."],
    ["caller", "Sí."],
  ]);
  const line = (result.cart || []).find((row: any) => /sope/.test(String(row.itemId)));
  assert.ok(line);
  assert.equal(line.quantity, 4);
  assert.match(opts(line), /Costilla/);
  assert.equal(result.noOrder, undefined);
});

test("a delivery address keeps the apartment and leaves the phone out", async () => {
  const result = await order([
    ["caller", "Para entregar a domicilio."],
    ["caller", "Es el 1482 de la calle Magnolia, apartamento 4B."],
    ["staff", "1482 Magnolia, apartamento 4B."],
    ["caller", "Sí, correcto. Mi número es 614 555 0199."],
  ]);
  const address = String(result.address || "");
  assert.match(address, /1482/);
  assert.match(address, /Magnolia/i);
  assert.match(address, /4b/i);
  assert.doesNotMatch(address, /614|555|0199/);
});

test("taquitos keep the second meat in the same sentence", async () => {
  const result = await order([["caller", "Seis taquitos de cabeza y dos de lengua."]]);
  const tacos = (result.cart || []).filter((row: any) => /^sq-taco-/.test(String(row.itemId)));
  const qty = (meat: RegExp) => tacos.filter((line: any) => meat.test(opts(line))).reduce((sum: number, line: any) => sum + line.quantity, 0);
  assert.equal(qty(/Cabeza/), 6);
  assert.equal(qty(/Lengua/), 2);
});

test("a tortilla said for another dish does not move onto the taquitos", async () => {
  const result = await order([["caller", "Tres taquitos de lengua y una quesadilla de harina de pollo."]]);
  const taco = (result.cart || []).find((row: any) => /^sq-taco-/.test(String(row.itemId)) && /Lengua/.test(opts(row)));
  const quesadilla = (result.cart || []).find((row: any) => /quesadilla/.test(String(row.itemId)) && /Pollo/.test(opts(row)));
  assert.ok(taco);
  assert.equal(taco.quantity, 3);
  assert.doesNotMatch(opts(taco), /Harina|Flour/);
  assert.ok(quesadilla);
  assert.match(opts(quesadilla), /Harina|Flour/);
});

test("a yes to the taquero question takes the taquitos off hold", async () => {
  const result = await order([
    ["caller", "Dos taquitos de costilla."],
    ["staff", "¿Los quieres taqueros?"],
    ["caller", "Sí."],
  ]);
  const taco = (result.cart || []).find((row: any) => /^sq-taco-/.test(String(row.itemId)));
  assert.equal(taco?.quantity, 2);
  assert.match(opts(taco), /Street|Taquero/);
  assert.equal((taco?.elviNotes || []).some((note: string) => /tortilla/i.test(note)), false);
});

test("live name and address callers stay on the 17bcf7e result", () => {
  assert.equal(nameFromTranscriptInfo([{ speaker: "staff", text: "¿A nombre de quién?" }, { speaker: "caller", text: "Hola, Fermín." }] as any), null);
  assert.equal(nameFromTranscriptInfo([{ speaker: "staff", text: "¿Su nombre?" }, { speaker: "caller", text: "Mande, Fermín." }] as any), null);
  assert.equal(nameFromTranscriptInfo([{ speaker: "caller", text: "Me llamo Fermín." }] as any)?.name, "Fermín");
  assert.equal(nameFromTranscriptInfo([{ speaker: "caller", text: "Un taco de pastor." }, { speaker: "staff", text: "Oye, Luis, ¿ya está el pedido?" }] as any)?.name, "Luis");
  assert.deepEqual(addressesIn("Es el 1482 de la calle Magnolia, apartamento 4B."), []);
  assert.equal(detectAddress([{ speaker: "caller", text: "123 Main St apt 2", start: 1 }] as any).address?.full, "123 Main St Apt 2");
});

test("a greeting before a name keeps the name on the shadow order", async () => {
  const hola = await order([["caller", "Un taco de pollo."], ["staff", "¿A nombre de quién?"], ["caller", "Hola, Fermín."]]);
  assert.equal(hola.customerName, "Fermín");
  const mande = await order([["caller", "Un taco de pollo."], ["staff", "¿Su nombre?"], ["caller", "Mande, Fermín."]]);
  assert.equal(mande.customerName, "Fermín");
});

test("a filler does not replace a name already given", async () => {
  const result = await order([
    ["caller", "Me llamo Nuria."],
    ["staff", "Nuria, muy bien."],
    ["caller", "Muchísimas gracias, ponga eso."],
  ]);
  assert.equal(result.customerName, "Nuria");
  const place = await order([
    ["caller", "Me llamo Carlos."],
    ["staff", "¿A nombre de quién?"],
    ["caller", "Allá en Carlos."],
  ]);
  assert.notEqual(place.customerName, "Allá En Carlos");
  assert.equal(place.customerName, "Carlos");
});

test("a bare count answers the staff question", async () => {
  const result = await order([
    ["staff", "¿Cuántas gorditas de pollo?"],
    ["caller", "Cuatro."],
    ["caller", "Sí."],
  ]);
  const line = (result.cart || []).find((row: any) => /gordita/.test(String(row.itemId)));
  assert.ok(line);
  assert.equal(line.quantity, 4);
  assert.match(opts(line), /Pollo/);
});

test("a milanesa platillo with the tortilla and side answered is not empty", async () => {
  const result = await order([
    ["caller", "Un platillo de milanesa."],
    ["staff", "¿Con tortillas de comal?"],
    ["caller", "Sí, de comal."],
    ["staff", "¿Arroz y frijoles?"],
    ["caller", "Sí."],
  ]);
  const line = (result.cart || []).find((row: any) => /platillo-de-guisado/.test(String(row.itemId)));
  assert.ok(line);
  assert.match(opts(line), /Corn/);
  assert.match(opts(line), /Arroz/);
  assert.match((line.elviNotes || []).join(" "), /milanesa/);
  assert.equal(result.noOrder, undefined);
});

test("de queso closes the enchilada option", async () => {
  const result = await order([
    ["caller", "Dos enchiladas."],
    ["staff", "¿De queso o de pollo?"],
    ["caller", "De queso."],
  ]);
  const line = (result.cart || []).find((row: any) => /enchilada/.test(String(row.itemId)));
  assert.ok(line);
  assert.match(opts(line), /Queso/);
  assert.equal(line.validation, undefined);
  assert.equal((line.elviNotes || []).some((note: string) => /confirmar/i.test(note)), false);
});

test("taquitos do not take the tortilla of the other tacos", async () => {
  const result = await order([["caller", "Tres taquitos de cabeza y dos tacos de harina de pollo."]]);
  const cabeza = (result.cart || []).find((row: any) => /^sq-taco-/.test(String(row.itemId)) && /Cabeza/.test(opts(row)));
  const pollo = (result.cart || []).find((row: any) => /^sq-taco-/.test(String(row.itemId)) && /Pollo/.test(opts(row)));
  assert.equal(cabeza?.quantity, 3);
  assert.doesNotMatch(opts(cabeza), /Harina|Flour/);
  assert.equal(pollo?.quantity, 2);
  assert.match(opts(pollo), /Harina|Flour/);
});

test("horchata stays horchata, fried stays off comal, and burrito con todo is the fillings", async () => {
  const drink = await order([["caller", "Quiero una agua de horchata."]]);
  assert.match(String(drink.cart[0]?.itemId), /horchata/);
  assert.doesNotMatch(String(drink.cart[0]?.itemId), /water|embotellada|bottle/);
  const fried = await order([["caller", "Una quesadilla frita de pollo."]]);
  assert.match(String(fried.cart[0]?.itemId), /dorada/);
  assert.doesNotMatch(String(fried.cart[0]?.itemId), /^sq-quesadilla-/);
  const burrito = await order([["caller", "Un burrito de carne asada con todo."]]);
  const line = burrito.cart[0];
  assert.match(String(line.itemId), /burrito/);
  assert.match(opts(line), /Arroz/);
  assert.match(opts(line), /Frijoles/);
  assert.doesNotMatch(opts(line), /DELUXE|\+\$0\.75/);
});

test("a kitchen shout is not the order name, and a confirmed name stays", async () => {
  const shouted = await order([
    ["caller", "Un taco de pastor."],
    ["staff", "¿A nombre de quién?"],
    ["caller", "Gracias."],
    ["staff", "Oye, Luis, ¿ya está el pedido?"],
  ]);
  assert.notEqual(shouted.customerName, "Luis");
  assert.notEqual(shouted.customerName, "Gracias");
  const named = await order([
    ["caller", "Dos tacos de pollo."],
    ["caller", "Para entregar, 1482 de la calle Magnolia."],
    ["staff", "¿A nombre de quién?"],
    ["caller", "Ramiro."],
    ["staff", "Ramiro, muy bien."],
    ["staff", "Oye, Luis, ¿ya está el pedido?"],
  ]);
  assert.equal(named.customerName, "Ramiro");
});
