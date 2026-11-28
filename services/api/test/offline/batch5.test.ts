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
    ["caller", "Un taco de pastor."],
    ["caller", "Me llamo Nuria."],
    ["staff", "Nuria, muy bien."],
    ["caller", "Muchísimas gracias, ponga eso."],
  ]);
  assert.equal(result.customerName, "Nuria");
  const place = await order([
    ["caller", "Un taco de pastor."],
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
  assert.match(opts(line), /Milanesa/);
  assert.equal((line.elviNotes || []).some((note: string) => /^milanesa$/i.test(note)), false);
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

test("a greeting word is a name only when it is a person's name, and a no-order call has none", async () => {
  const fermin = await order([["caller", "Hola, Fermín."], ["caller", "Un taco de pastor."]]);
  assert.equal(fermin.customerName, "Fermín");
  const leaks = ["Tienen", "Tengo", "Necesito", "Perdón", "Podría", "Vamos", "Estoy", "Cuánto", "Ahorita", "Mañana", "Entonces", "Pues", "Oiga", "Bueno", "Hello", "Please", "Orden", "Nuevo", "Llevar", "Recoger", "Hoy", "Delivery", "Pickup", "Nosotros", "Comer", "También", "Quisiera", "Correcto", "Porque"];
  for (const word of leaks) {
    for (const frame of [`Hola, ${word}.`, `Mande, ${word}.`, `Soy ${word}.`, `Es para ${word}.`]) {
      const junk = await order([["caller", frame], ["caller", "Un taco de pastor."]]);
      assert.notEqual(junk.customerName, word, frame);
    }
  }
  const asking = await order([["caller", "Hola, Fermín."], ["caller", "¿Tienen mole?"]]);
  assert.equal(asking.customerName, undefined);
});

test("a verb, a courtesy phrase, or a street word is not the customer name", async () => {
  const leaks = ["Debiste", "Give", "Encargar", "Saber", "Avenue", "Dígame", "Espere", "Número", "Tel", "Same", "What", "Adentro"];
  for (const word of leaks) {
    const asked = await order([
      ["caller", "Un taco de pastor."],
      ["staff", "¿Su nombre?"],
      ["caller", `${word}.`],
    ]);
    assert.notEqual(asked.customerName, word, word);
    const framed = await order([["caller", `Es para ${word}.`], ["caller", "Un taco de pastor."]]);
    assert.notEqual(framed.customerName, word, `para ${word}`);
  }
  const courtesy = await order([
    ["caller", "Un taco de pastor."],
    ["staff", "¿Su nombre?"],
    ["caller", "Mucho gusto."],
  ]);
  assert.notEqual(courtesy.customerName, "Mucho Gusto");
  assert.notEqual(courtesy.customerName, "Mucho");
  const kept = await order([
    ["caller", "Un taco de pastor."],
    ["staff", "¿Su nombre?"],
    ["caller", "Yesenia."],
  ]);
  assert.equal(kept.customerName, "Yesenia");
  const pork = await order([
    ["caller", "Quiero un platillo de milanesa de puerco."],
    ["staff", "¿De comal, con arroz y frijoles?"],
    ["caller", "Sí."],
  ]);
  assert.equal(pork.validation, "unresolved");
  assert.doesNotMatch(opts(pork.cart.find((row: any) => /platillo/i.test(String(row.itemId)))), /Milanesa Pollo/);
});

test("an answer to the name question keeps an uncommon name, and a greeting does not", async () => {
  const answer = await order([
    ["caller", "Un taco de pastor."],
    ["staff", "¿Su nombre?"],
    ["caller", "Rosalba."],
  ]);
  assert.equal(answer.customerName, "Rosalba");
  const surname = await order([
    ["caller", "Una gordita de pollo."],
    ["staff", "¿Su apellido?"],
    ["caller", "Paredes."],
  ]);
  assert.equal(surname.customerName, "Paredes");
  const called = await order([["caller", "My name is Dana."], ["caller", "Un taco de pastor."]]);
  assert.equal(called.customerName, "Dana");
  const intro = await order([["caller", "This is Marcus."], ["caller", "Un burrito de bistec."]]);
  assert.equal(intro.customerName, "Marcus");
  const clause = await order([
    ["caller", "Un taco de pastor."],
    ["staff", "¿A nombre de quién?"],
    ["caller", "Elena, y es para recoger."],
  ]);
  assert.equal(clause.customerName, "Elena");
  const glued = await order([["caller", "Hola, Marco, tres gorditas de pollo de comal."]]);
  assert.notEqual(glued.customerName, "Marco Tres Gorditas de Pollo de Comal");
  assert.ok(!String(glued.customerName || "").includes("Gordita"));
  const hello = await order([
    ["staff", "Hello."],
    ["caller", "Lupita."],
    ["caller", "Un taco de pastor."],
  ]);
  assert.notEqual(hello.customerName, "Lupita");
  const none = await order([["caller", "Soy Renato."], ["caller", "¿Tienen horchata?"]]);
  assert.equal(none.customerName, undefined);
});

test("fajitas without a known meat stay unresolved, and a platter tortilla is the included one", async () => {
  const plain = await order([["caller", "Unas fajitas."], ["staff", "¿De comal?"], ["caller", "Sí."]]);
  const plainLine = plain.cart.find((row: any) => /fajita/i.test(String(row.itemId)));
  assert.equal(plain.validation, "unresolved");
  assert.equal(plainLine?.validation, "unresolved");
  const shrimp = await order([["caller", "Unas fajitas de camarón."]]);
  assert.equal(shrimp.validation, "unresolved");
  assert.doesNotMatch(opts(shrimp.cart.find((row: any) => /fajita/i.test(String(row.itemId)))), /Pollo|Bistec|Milanesa/);
  const beef = await order([
    ["caller", "Quiero un platillo de milanesa de res."],
    ["staff", "¿De comal, con arroz y frijoles?"],
    ["caller", "Sí."],
  ]);
  const beefLine = beef.cart.find((row: any) => /platillo/i.test(String(row.itemId)));
  assert.equal(beef.validation, "unresolved");
  assert.doesNotMatch(opts(beefLine), /Milanesa Pollo/);
  assert.doesNotMatch(opts(beefLine), /EXTRA 3 x/);
  assert.match(opts(beefLine), /3 x \(Corn\) Corn Tortilla/);
});

test("a lowercase name is kept, and a closing does not replace it", async () => {
  const hello = await order([["caller", "hola, fermín"], ["caller", "Un taco de pastor."]]);
  assert.equal(hello.customerName, "Fermín");
  const called = await order([["caller", "me llamo ximena"], ["caller", "Una gordita de pollo."]]);
  assert.equal(called.customerName, "Ximena");
  const pickup = await order([["caller", "para fermín"], ["caller", "Un taco de pastor."]]);
  assert.equal(pickup.customerName, "Fermín");
  const full = await order([["caller", "Me llamo maría de los ángeles."], ["caller", "Un taco de pastor."]]);
  assert.equal(full.customerName, "María de los Ángeles");
  const laura = await order([
    ["caller", "Un taco de pastor."],
    ["staff", "¿A nombre de quién?"],
    ["caller", "Laura."],
    ["caller", "Muchísimas gracias."],
  ]);
  assert.equal(laura.customerName, "Laura");
});

test("a closing next to a name does not replace the name", async () => {
  const laura = await order([
    ["caller", "Un taco de pastor."],
    ["staff", "¿A nombre de quién?"],
    ["caller", "Es para Laura, muchísimas gracias."],
  ]);
  assert.equal(laura.customerName, "Laura");
  const ernesto = await order([["caller", "Ponga Ernesto."], ["caller", "Un taco de pastor."]]);
  assert.equal(ernesto.customerName, "Ernesto");
});

test("a bare count after cuantas or cuantos sets the one line", async () => {
  const four = await order([
    ["caller", "Una gordita de pollo."],
    ["staff", "¿Cuántas?"],
    ["caller", "Cuatro."],
  ]);
  assert.equal(four.cart.find((row: any) => /gordita/i.test(String(row.itemId)))?.quantity, 4);
  const five = await order([
    ["caller", "Un taco de pastor."],
    ["staff", "¿Cuántos?"],
    ["caller", "Cinco."],
  ]);
  assert.equal(five.cart.find((row: any) => /^sq-taco-/.test(String(row.itemId)))?.quantity, 5);
});

test("fajitas and a yes to a platter are not an empty cart", async () => {
  const fajitas = await order([["caller", "Unas fajitas de bistec."]]);
  const fajitaLine = fajitas.cart.find((row: any) => /fajita/i.test(String(row.itemId)));
  assert.match(opts(fajitaLine), /Bistec|Steak/);
  assert.equal(fajitaLine.validation, undefined);
  const asked = await order([["caller", "¿Puedes preparar unas fajitas de pollo?"]]);
  assert.match(opts(asked.cart.find((row: any) => /fajita/i.test(String(row.itemId)))), /Pollo|Chicken/);
  const plate = await order([
    ["caller", "Quiero un platillo."],
    ["staff", "¿De comal, con arroz y frijoles?"],
    ["caller", "Sí."],
  ]);
  assert.ok(plate.cart.some((row: any) => /platillo/i.test(String(row.itemId))));
});

test("a street period is dropped, bottled water is water, and one burrito is not empty", async () => {
  const street = await order([
    ["caller", "Para entregar a domicilio."],
    ["caller", "Es el 900 de la calle Magnolia., apartamento 2."],
  ]);
  assert.equal(street.address, "900 Magnolia St Apartamento 2");
  assert.doesNotMatch(String(street.address), /\.\s/);
  const water = await order([["caller", "Una botella de agua."]]);
  assert.match(String(water.cart[0]?.itemId), /water-bottle/);
  assert.doesNotMatch(String(water.cart[0]?.itemId), /horchata/);
  const plain = await order([["caller", "Un burrito de bistec."]]);
  assert.equal(plain.cart.length, 1);
  assert.match(String(plain.cart[0].itemId), /burrito/);
  const deluxe = await order([["caller", "Un burrito deluxe de pollo."]]);
  assert.match(String(deluxe.cart[0]?.itemId), /burrito/);
  assert.match(opts(deluxe.cart[0]), /DELUXE|Deluxe/);
});
