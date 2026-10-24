// agustin1: CAaf4876ecad1910c62a4938b819859500 — Sat Oct 24 ~4:14 PM ET
// Spanish factory group (8 tickets). Caller Agustín (staff greeting); para-* = pickup only.
// Berros = ASR of "Verdes", never caller identity. Spicy salsa on everything.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nameFromTranscriptInfo } from "../../src/order-name.ts";
import { shadowOrderFromTurns, personSwitch, DORADA_DELUXE_ID } from "../../src/call-scoring.ts";

const QCO = "sq-quesadilla-HLT6CR";
const TACO = "sq-taco-TAR7L5";
const CHIL = "sq-chilaquiles-con-huevo-YWKBQV";
const BUR = "sq-burrito-TGWBEN";
const HORCH = "sq-drink-agua-fresca-horchata-32oz-HL6HPK";

const turns = [
  { speaker: "staff", text: "Cocina Elvis." },
  { speaker: "caller", text: "Sí, buenas tardes." },
  { speaker: "staff", text: "Buenas tardes." },
  { speaker: "caller", text: "Oye, ¿me puedes hacer un pedido aquí para la fábrica?" },
  { speaker: "staff", text: "Ah, sí, bueno, si me permite poquitos." },
  { speaker: "caller", text: "Claro que sí." },
  { speaker: "staff", text: "Buenas tardes, Agustín." },
  { speaker: "caller", text: "Buenas tardes, Carlos, ¿cómo estás?" },
  { speaker: "staff", text: "Bien, bien, ¿y tú?" },
  { speaker: "caller", text: "También bien, mira, aquí dando de lata." },
  { speaker: "staff", text: "A ver, ahora sí, Agustín, dime, ¿qué te vamos a poner?" },
  { speaker: "caller", text: "A ver, mira, en la primera orden," },
  { speaker: "caller", text: "me pones, me pones un, un, un platito de chilaquiles verdes con frijoles. Eh, ¿quieres carne o quieres" },
  { speaker: "staff", text: "Ah, ok, ¿con qué carne?" },
  { speaker: "caller", text: "huevos? Carne o huevos. Pero chilaquiles. Este, no, no me le pongas carne, Carlos, nomás los chilaquiles y frijoles." },
  { speaker: "caller", text: "Verdes." },
  { speaker: "staff", text: "Berros, ¿peramán? Okay." },
  { speaker: "staff", text: "Solo frijoles." },
  { speaker: "caller", text: "Sí, por favor." },
  { speaker: "caller", text: "Y en la misma orden," },
  { speaker: "caller", text: "sería una quesadilla de chorizo de maíz" },
  { speaker: "staff", text: "Quesadilla de comal" },
  { speaker: "caller", text: "y de comal, de chorizo," },
  { speaker: "caller", text: "Y ya, pues la quesadilla me la mandas con su con su verdura. Este, esa sería para Tony." },
  { speaker: "caller", text: "En la siguiente orden," },
  { speaker: "caller", text: "van a ser tres quesadillas de comal," },
  { speaker: "caller", text: "serían dos de costilla" },
  { speaker: "caller", text: "con cebolla asada adentro." },
  { speaker: "caller", text: "Y una de chicharrón duro," },
  { speaker: "caller", text: "pero esa con frijoles y cebolla asada adentro." },
  { speaker: "caller", text: "Esa es para Sandro." },
  { speaker: "caller", text: "En la siguiente orden" },
  { speaker: "caller", text: "van a ser" },
  { speaker: "caller", text: "cuatro tacos de lengua de tortilla taquera" },
  { speaker: "caller", text: "y otro y otro taco de chorizo igual taquera, de taqueros." },
  { speaker: "caller", text: "Esa orden sería para Mike." },
  { speaker: "caller", text: "En otra orden" },
  { speaker: "caller", text: "van a hacer dos quesadillas en aceite" },
  { speaker: "caller", text: "preparadas," },
  { speaker: "caller", text: "una de bistec y una de pastor." },
  { speaker: "caller", text: "Sí, las dos preparadas doraditas, por favor." },
  { speaker: "caller", text: "Esa es para Johnny." },
  { speaker: "caller", text: "En la siguiente orden" },
  { speaker: "caller", text: "van a hacer dos quesadillas de harina de pollo." },
  { speaker: "caller", text: "De pollo." },
  { speaker: "caller", text: "Esa orden es para Franjer." },
  { speaker: "caller", text: "En otra orden," },
  { speaker: "caller", text: "van a ser dos quesadillas de harina," },
  { speaker: "caller", text: "una de lengua y una de bistec." },
  { speaker: "caller", text: "¿Tienes deshebrada?" },
  { speaker: "caller", text: "Me pones un taco de deshebrada, por favor." },
  { speaker: "caller", text: "Eh, no, ese de de taquero." },
  { speaker: "caller", text: "Y un agua de horchata chica, por favor." },
  { speaker: "caller", text: "Esa orden es para Osvaldo." },
  { speaker: "caller", text: "En otra orden," },
  { speaker: "caller", text: "va a ser un burrito grande preparado" },
  { speaker: "caller", text: "de bistec." },
  { speaker: "caller", text: "Ese es para el chaparro." },
  { speaker: "caller", text: "Y en otra orden," },
  { speaker: "caller", text: "me pones por favor seis tacos" },
  { speaker: "caller", text: "de tortilla taquera," },
  { speaker: "caller", text: "van a ser dos de chicharrón duro" },
  { speaker: "caller", text: "y, sí, taqueros y cuatro de chorizo." },
  { speaker: "caller", text: "Esa, esa orden es para Agustín." },
  { speaker: "caller", text: "Sería todo, todo me lo pones con con salsa de la que pica, por favor." },
  { speaker: "caller", text: "Sería todo, Carlos, por aquí te veo un ratito," },
] as any;

test("agustin1: personSwitch para el chaparro + named wins over otra orden", () => {
  assert.equal(personSwitch("Ese es para el chaparro."), "Chaparro");
  assert.equal(personSwitch("Esa sería para Tony."), "Tony");
  assert.equal(personSwitch("En otra orden van a hacer dos. Esa es para Johnny."), "Johnny");
  assert.equal(personSwitch("En la siguiente orden"), "+");
  assert.equal(personSwitch("para llevar"), null);
});

test("agustin1: name Agustín from staff greeting; Berros/para-* not caller identity", () => {
  const info = nameFromTranscriptInfo(turns);
  assert.equal(info?.name, "Agustín");
  assert.equal(info?.thirdPerson, false);
  assert.equal(info?.source, "vocative");
});

test("agustin1: factory rebuild — 8 people, spicy salsa, truth cart", async () => {
  // Live-wrong model: invent meats on chilaquiles, wrong qtys, QD for flour, phantoms
  const run = async (text: string) => {
    const acts: any[] = [];
    if (/chilaquiles/i.test(text))
      acts.push({
        type: "add_item", itemId: CHIL, quantity: 1,
        modifiers: [
          { option: "1 x EXTRA Huevo (+$1.25)" },
          { option: "Chorizo / Mexican Sausage (+$3.00)" },
        ],
      });
    if (/quesadilla.*chorizo|chorizo.*comal|de comal, de chorizo/i.test(text))
      acts.push({
        type: "add_item", itemId: QCO, quantity: 4,
        modifiers: [{ option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" }, { option: "Chorizo / Mexican Sausage" }],
      });
    if (/costilla|chicharr/i.test(text))
      acts.push({
        type: "add_item", itemId: QCO, quantity: 2,
        modifiers: [{ option: "(QCO) Quesadilla Comal / Homemade (+$1.00)" }, { option: "Costilla / Beef Rib" }],
      });
    if (/lengua.*taquer|taquer.*lengua|cuatro tacos/i.test(text))
      acts.push({
        type: "add_item", itemId: TACO, quantity: 4,
        modifiers: [{ option: "(TST) Taco Taquero / Street Taco" }, { option: "Lengua / Beef Tongue (+$0.50)" }, { option: "Mild Salsa Asada" }],
      });
    if (/taco de chorizo|chorizo igual taquer/i.test(text))
      acts.push({
        type: "add_item", itemId: TACO, quantity: 4,
        modifiers: [{ option: "(TST) Taco Taquero / Street Taco" }, { option: "Chorizo / Mexican Sausage" }],
      });
    if (/aceite|dorad|preparad/i.test(text) && /quesadill/i.test(text))
      acts.push({
        type: "add_item", itemId: DORADA_DELUXE_ID, quantity: 2,
        modifiers: [{ option: "(QD) DELUXE Preparada" }, { option: "Pollo / Chicken" }],
      });
    if (/harina de pollo|quesadillas de harina de pollo/i.test(text))
      acts.push({
        type: "add_item", itemId: DORADA_DELUXE_ID, quantity: 2,
        modifiers: [{ option: "(QD) DELUXE Preparada" }, { option: "Pollo / Chicken" }],
      });
    if (/harina/i.test(text) && /lengua|bistec/i.test(text))
      acts.push({
        type: "add_item", itemId: DORADA_DELUXE_ID, quantity: 2,
        modifiers: [{ option: "(QD) DELUXE Preparada" }, { option: "Lengua / Beef Tongue (+$0.50)" }],
      });
    if (/horchata/i.test(text))
      acts.push({ type: "add_item", itemId: HORCH, quantity: 1, modifiers: [] });
    if (/burrito/i.test(text))
      acts.push({
        type: "add_item", itemId: BUR, quantity: 1,
        modifiers: [{ option: "Grande '12 (+$3.00)" }, { option: "Bistec / Steak" }],
      });
    if (/seis tacos|chicharrón duro|cuatro de chorizo/i.test(text) && /taquer/i.test(text))
      acts.push({
        type: "add_item", itemId: TACO, quantity: 2,
        modifiers: [{ option: "(TST) Taco Taquero / Street Taco" }],
      });
    return { actions: acts, reply: "?" };
  };

  const r: any = await shadowOrderFromTurns(turns, run as any);
  const byPerson = (p: string) => r.cart.filter((l: any) => l.person === p);
  const meatOf = (l: any) => (l.modifiers || []).map((m: any) => String(m.option)).find((o: string) =>
    /Bistec|Pastor|Chorizo|Pollo|Lengua|Costilla|Duro|Deshebrada/i.test(o) && !/salsa/i.test(o)) || "";
  const hasHot = (l: any) => (l.modifiers || []).some((m: any) => /Hot Salsa Roja/i.test(String(m.option)));
  const hasMod = (l: any, re: RegExp) => (l.modifiers || []).some((m: any) => re.test(String(m.option)));

  // Tony
  {
    const lines = byPerson("Tony");
    const chil = lines.find((l: any) => l.itemId === CHIL);
    assert.ok(chil, "Tony chilaquiles: " + JSON.stringify(lines));
    assert.equal(chil.quantity, 1);
    assert.ok(!(chil.modifiers || []).some((m: any) => /Huevo|Chorizo|Bistec|Pollo|Carnitas/i.test(String(m.option))),
      "no meat/huevo on chilaquiles: " + JSON.stringify(chil.modifiers));
    const qco = lines.filter((l: any) => l.itemId === QCO);
    assert.equal(qco.reduce((n: number, l: any) => n + l.quantity, 0), 1, "Tony 1 QCO chorizo");
    assert.match(meatOf(qco[0]), /Chorizo/i);
    assert.ok(hasHot(qco[0]), "Tony spicy");
  }

  // Sandro
  {
    const lines = byPerson("Sandro");
    const cost = lines.find((l: any) => /Costilla/i.test(meatOf(l)));
    const duro = lines.find((l: any) => /Duro/i.test(meatOf(l)));
    assert.ok(cost && cost.quantity === 2, "2 QCO costilla: " + JSON.stringify(lines));
    assert.ok(hasMod(cost, /Cebolla/i), "cebolla asada on costilla");
    assert.ok(duro && duro.quantity === 1, "1 QCO duro: " + JSON.stringify(lines));
    assert.ok(hasMod(duro, /Frijoles|Cebolla/i), "frijoles+cebolla on duro");
    assert.ok(hasHot(cost) && hasHot(duro), "Sandro spicy");
  }

  // Mike
  {
    const lines = byPerson("Mike");
    const lengua = lines.find((l: any) => l.itemId === TACO && /Lengua/i.test(meatOf(l)));
    const chorizo = lines.find((l: any) => l.itemId === TACO && /Chorizo/i.test(meatOf(l)));
    assert.ok(lengua && lengua.quantity === 4, "4 TST lengua: " + JSON.stringify(lines));
    assert.ok(chorizo && chorizo.quantity === 1, "1 TST chorizo: " + JSON.stringify(lines));
  }

  // Johnny
  {
    const lines = byPerson("Johnny");
    const qd = lines.filter((l: any) => l.itemId === DORADA_DELUXE_ID);
    assert.equal(qd.length, 2, "2 QD: " + JSON.stringify(lines));
    assert.ok(qd.some((l: any) => /Bistec/i.test(meatOf(l))));
    assert.ok(qd.some((l: any) => /Pastor|Alpastor/i.test(meatOf(l))));
  }

  // Franjer — QHR pollo ×2
  {
    const lines = byPerson("Franjer");
    assert.ok(lines.every((l: any) => l.itemId === QCO), "Franjer quesadillas not QD: " + JSON.stringify(lines));
    assert.ok(lines.every((l: any) => hasMod(l, /QHR|Harina|Flour/i)), "QHR: " + JSON.stringify(lines));
    assert.equal(lines.reduce((n: number, l: any) => n + l.quantity, 0), 2);
    assert.ok(lines.every((l: any) => /Pollo/i.test(meatOf(l))));
  }

  // Osvaldo
  {
    const lines = byPerson("Osvaldo");
    const qhr = lines.filter((l: any) => l.itemId === QCO && hasMod(l, /QHR|Harina/i));
    assert.equal(qhr.length, 2, "2 QHR: " + JSON.stringify(lines));
    assert.ok(qhr.some((l: any) => /Lengua/i.test(meatOf(l))));
    assert.ok(qhr.some((l: any) => /Bistec/i.test(meatOf(l))));
    const desh = lines.find((l: any) => l.itemId === TACO && /Deshebrada/i.test(meatOf(l)));
    assert.ok(desh && desh.quantity === 1, "TST deshebrada: " + JSON.stringify(lines));
    const h = lines.find((l: any) => /horchata/i.test(String(l.itemId)));
    assert.ok(h, "horchata");
    assert.equal(h.posSize, "small", "horchata chica");
  }

  // Chaparro
  {
    const lines = byPerson("Chaparro");
    const bur = lines.find((l: any) => l.itemId === BUR);
    assert.ok(bur, "burrito: " + JSON.stringify(lines));
    assert.ok(hasMod(bur, /Grande/i) && /Bistec/i.test(meatOf(bur)));
    assert.ok(hasMod(bur, /DELUXE|Preparad/i), "preparado");
  }

  // Agustín
  {
    const lines = byPerson("Agustín");
    const duro = lines.find((l: any) => l.itemId === TACO && /Duro/i.test(meatOf(l)));
    const chorizo = lines.find((l: any) => l.itemId === TACO && /Chorizo/i.test(meatOf(l)));
    assert.ok(duro && duro.quantity === 2, "2 TST duro: " + JSON.stringify(lines));
    assert.ok(chorizo && chorizo.quantity === 4, "4 TST chorizo: " + JSON.stringify(lines));
  }

  const groups = new Set(r.groups || r.cart.map((l: any) => l.person));
  for (const p of ["Tony", "Sandro", "Mike", "Johnny", "Franjer", "Osvaldo", "Chaparro", "Agustín"])
    assert.ok(groups.has(p), "group " + p + ": " + JSON.stringify([...groups]));

  // no phantom torta / wrong QD pollo-lengua piles
  assert.ok(!r.cart.some((l: any) => /torta/i.test(String(l.itemId))), "no torta phantom");
});
