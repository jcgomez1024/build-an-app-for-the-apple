// Affirmed staff lists may add a missing line. They never overwrite or delete a caller line.
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { flagUnresolvedRequired, gateTicketAcceptance, orderValidation } from "../../src/offline-evidence.ts";
import { callerReadyTime, detectFulfillment, spokenClock } from "../../src/delivery.ts";
import { applyAffirmedStaffList, applySettledQdConTodo, noteUnspokenRequiredChoice, reconcileAcceptedDishParts, STAFF_LIST_REVIEW } from "../../src/list-repair.ts";
import { frozenPhoneMenu } from "../../src/phone-menu.ts";
import { staffUnavailable } from "../../src/spoken-ledger.ts";
import { CASES } from "./cases.ts";
import { evaluateCase } from "./evaluate.ts";

const menu = frozenPhoneMenu();
const pepsi = menu.find((item) => item.name === "Pepsi");
const coke = menu.find((item) => item.name === "Coca Cola");
const taco = menu.find((item) => item.id === "sq-taco-TAR7L5");
if (!pepsi || !coke || !taco) throw new Error("phone menu is missing pepsi, coca, or the taco");

const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
  console.log(ok ? "PASS" : "FAIL", name);
}

const upsellCart: any[] = [];
const upsell = applyAffirmedStaffList(upsellCart, [
  { speaker: "staff", text: "¿Quiere tres tacos de pastor y dos quesadillas de bistec?" },
  { speaker: "caller", text: "Sí." },
], menu);
check("upsell-adds-nothing", !upsell.fired && upsell.added.length === 0 && upsellCart.length === 0);

const alsoCart: any[] = [];
const also = applyAffirmedStaffList(alsoCart, [
  { speaker: "staff", text: "También tenemos tres tacos de pastor y dos quesadillas de bistec." },
  { speaker: "caller", text: "Sí." },
], menu);
check("tambien-tenemos-adds-nothing", !also.fired && alsoCart.length === 0);

const pepsiLine = { itemId: pepsi.id, quantity: 1, modifiers: [], elviNotes: ["botella"] };
const pepsiCart = [JSON.parse(JSON.stringify(pepsiLine))];
const wrong = applyAffirmedStaffList(pepsiCart, [
  { speaker: "caller", text: "Tráeme una Pepsi de bote grande." },
  { speaker: "staff", text: "La coca." },
  { speaker: "caller", text: "Sí." },
], menu);
check("wrong-readback-keeps-pepsi", pepsiCart.length === 1 && pepsiCart[0].itemId === pepsi.id && !pepsiCart.some((line) => line.itemId === coke.id) && wrong.flagged.some((flag) => flag === `brand:${pepsi.id}`) && wrong.added.length === 0, JSON.stringify({ cart: pepsiCart, wrong }));

const noted = { itemId: taco.id, quantity: 2, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Bistec / Steak" }], elviNotes: ["sin cebolla"] };
const notedCart = [JSON.parse(JSON.stringify(noted))];
const pero = applyAffirmedStaffList(notedCart, [
  { speaker: "caller", text: "Dos tacos de bistec." },
  { speaker: "staff", text: "Dos tacos de bistec." },
  { speaker: "caller", text: "Sí, pero sin cebolla." },
], menu);
check("pero-is-not-a-clean-yes", !pero.fired && JSON.stringify(notedCart) === JSON.stringify([noted]));

const pollo = { itemId: taco.id, quantity: 2, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: "Pollo / Chicken" }], elviNotes: [] as string[] };
const corrected = [JSON.parse(JSON.stringify(pollo))];
const later = applyAffirmedStaffList(corrected, [
  { speaker: "caller", text: "Dos tacos de bistec." },
  { speaker: "staff", text: "Dos tacos de bistec." },
  { speaker: "caller", text: "Sí." },
  { speaker: "caller", text: "Mejor de pollo." },
], menu);
const stillPollo = corrected.length === 1 && corrected[0].modifiers.some((mod: any) => /pollo/i.test(mod.option)) && !corrected[0].modifiers.some((mod: any) => /bistec/i.test(mod.option));
check("later-correction-wins", stillPollo && later.added.length === 0, JSON.stringify({ corrected, later }));

const latestCart: any[] = [];
const latest = applyAffirmedStaffList(latestCart, [
  { speaker: "staff", text: "Dos tacos de pastor." },
  { speaker: "caller", text: "Sí." },
  { speaker: "staff", text: "Tres tacos de bistec." },
  { speaker: "caller", text: "Sí." },
], menu);
const meats = latestCart.flatMap((line) => (line.modifiers || []).map((mod: any) => mod.option)).join(" ");
check("latest-list-wins", latest.fired && latestCart.length === 1 && /bistec/i.test(meats) && !/pastor/i.test(meats) && latestCart[0].quantity === 3, JSON.stringify({ latestCart, latest }));

const falseTimes = ["me pone a una un", "como una tortilla", "a una de esas", "a two sour creams", "para las dos", "a dos de bistec", "¿A las dos quesos?", "como a una, como a cuatro casas", "4:40", "4:78", "440"];
check("false-ready-times", falseTimes.every((text) => spokenClock(text) === null) && spokenClock("a las once y media")?.time === "11:30" && spokenClock("como a las once diez")?.time === "11:10");
check("las-plus-hour", spokenClock("a las una")?.time === "1:00" && spokenClock("a las dos")?.time === "2:00" && spokenClock("a las tres")?.time === "3:00" && spokenClock("para las una")?.time === "1:00" && spokenClock("para las dos") === null && spokenClock("a dos de") === null && spokenClock("a dos de bistec") === null && spokenClock("dos quesadillas") === null && spokenClock("a las dos quesadillas") === null && spokenClock("para las dos y media")?.time === "2:30");
const regularDorada = "sq-qd-quesadilla-dorada-qd-regular-dorada-T5STUH";
const deluxeDorada = "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L";
const bistecMod = { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" };
const prensadoMod = { step: "(B) Q Carnes / Meats", option: "Prensado / Spicy Pork" };
const regularStyle = { step: "(QD) Style", option: "(QD) REGULAR Dorada" };
const separateRegular = [{ itemId: regularDorada, quantity: 1, modifiers: [regularStyle, bistecMod] }];
applySettledQdConTodo(separateRegular, [
  { speaker: "caller", text: "Una quesadilla dorada de bistec." },
  { speaker: "caller", text: "Y una dorada con todo de qwxzpl." },
]);
check("unreadable-con-todo-leaves-other-regular", separateRegular[0].itemId === regularDorada && /REGULAR Dorada/.test(JSON.stringify(separateRegular[0].modifiers)));
const rejectedRegular = [{ itemId: deluxeDorada, quantity: 2, modifiers: [{ step: "(QD) Style", option: "(QD) DELUXE Preparada" }, prensadoMod] }];
applySettledQdConTodo(rejectedRegular, [
  { speaker: "caller", text: "Dos quesadillas doradas de prensado con todo." },
  { speaker: "caller", text: "No, regulares." },
]);
check("no-regular-after-con-todo-stays-regular", rejectedRegular[0].itemId === regularDorada && /REGULAR Dorada/.test(JSON.stringify(rejectedRegular[0].modifiers)));
const cokeRegular = [{ itemId: deluxeDorada, quantity: 2, modifiers: [{ step: "(QD) Style", option: "(QD) DELUXE Preparada" }, prensadoMod] }];
applySettledQdConTodo(cokeRegular, [
  { speaker: "caller", text: "Dos quesadillas doradas de prensado con todo." },
  { speaker: "caller", text: "Una coca regular, no de dieta." },
]);
check("coke-regular-does-not-revert-dorada", cokeRegular[0].itemId === deluxeDorada);
const quesadilla = menu.find((item) => item.id === "sq-quesadilla-HLT6CR");
const fajita = menu.find((item) => /fajitas-elvis/i.test(item.id));
const qdLine = { itemId: quesadilla.id, quantity: 1, modifiers: [
  { step: "(A) Q Tortilla Options", option: "(QCO) Quesadilla Comal / Homemade" },
  { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" },
], elviNotes: [] as string[] };
noteUnspokenRequiredChoice([qdLine], [{ speaker: "caller", text: "Una quesadilla de bistec." }], menu);
check("quesadilla-without-tortilla-holds", (qdLine.elviNotes || []).some((note) => /tortilla/i.test(note)) && !(qdLine.elviNotes || []).some((note) => /carne|meat/i.test(note)), JSON.stringify(qdLine.elviNotes));
const fajitaLine = { itemId: fajita.id, quantity: 1, modifiers: [
  { step: "(A) Fajitas Carne / Meat Options", option: "Pollo / Chicken" },
  { step: "(B) Lado / Side", option: "Arroz-Rice and Frijoles-Beans" },
  { step: "(C) Tortilla Options", option: "3 x (Corn) Corn Tortilla" },
], elviNotes: [] as string[] };
noteUnspokenRequiredChoice([fajitaLine], [
  { speaker: "caller", text: "Quiero unas fajitas de pollo." },
  { speaker: "staff", text: "Arroz y frijoles esta bien?" },
  { speaker: "caller", text: "Si." },
], menu);
check("fajita-unspoken-tortilla-holds", (fajitaLine.elviNotes || []).some((note) => /tortilla/i.test(note)) && !(fajitaLine.elviNotes || []).some((note) => /lado|side/i.test(note)), JSON.stringify(fajitaLine.elviNotes));

function groupOption(item: any, groupRe: RegExp, optionRe: RegExp) {
  const group = (item?.modifierGroups || []).find((entry: any) => groupRe.test(String(entry.name || "")));
  const option = (group?.options || []).map((entry: any) => typeof entry === "string" ? entry : entry?.name).find((name: string) => optionRe.test(String(name || "")));
  return group && option ? { step: group.name, option } : null;
}
function meatNote(line: any) {
  return (line.elviNotes || []).some((note: string) => /carne|meat/i.test(note));
}
function tortillaNote(line: any) {
  return (line.elviNotes || []).some((note: string) => /tortilla/i.test(note));
}
const burrito = menu.find((item) => item.id === "sq-burrito-TGWBEN");
const gordita = menu.find((item) => item.id === "sq-gordita-M647RE");
const menudo = menu.find((item) => /menudo/i.test(item.name) && /tortilla/i.test(JSON.stringify(item.modifierGroups || [])));
const pastorMod = groupOption(quesadilla, /carne|meat/i, /alpastor|pastor/i);
const duroMod = groupOption(menu.find((item) => item.id === regularDorada), /carne|meat/i, /duro/i);
const comalMod = groupOption(quesadilla, /tortilla/i, /comal|homemade/i);
const tacoComal = groupOption(taco, /tortilla/i, /comal|homemade/i);
const burritoPastor = groupOption(burrito, /carne|meat/i, /alpastor|pastor/i);
const gorditaPastor = groupOption(gordita, /carne|meat/i, /alpastor|pastor/i);
const gorditaBistec = groupOption(gordita, /carne|meat/i, /bistec|steak/i);
const tacoBistec = groupOption(taco, /carne|meat/i, /bistec|steak/i);
if (!pastorMod || !duroMod || !comalMod || !tacoComal || !burritoPastor || !gorditaPastor || !gorditaBistec || !tacoBistec || !menudo) {
  throw new Error("phone menu is missing a choice used by the spoken-option checks");
}
const duroLine = { itemId: regularDorada, quantity: 1, modifiers: [regularStyle, duroMod], elviNotes: [] as string[] };
noteUnspokenRequiredChoice([duroLine], [
  { speaker: "caller", text: "Quiero una dorada." },
  { speaker: "caller", text: "De duro." },
], menu);
check("duro-without-a-dish-word-binds-to-the-dorada", !meatNote(duroLine), JSON.stringify(duroLine.elviNotes));
const covered = [1, 2].map(() => ({ itemId: quesadilla.id, quantity: 1, modifiers: [comalMod, bistecMod], elviNotes: [] as string[] }));
noteUnspokenRequiredChoice(covered, [
  { speaker: "caller", text: "Dos quesadillas de bistec." },
  { speaker: "caller", text: "Todas de comal." },
], menu);
check("comal-once-covers-every-quesadilla", covered.every((line) => !tortillaNote(line)), JSON.stringify(covered.map((line) => line.elviNotes)));
const coveredTacos = [1, 2].map(() => ({ itemId: taco.id, quantity: 2, modifiers: [tacoComal, tacoBistec], elviNotes: [] as string[] }));
noteUnspokenRequiredChoice(coveredTacos, [
  { speaker: "caller", text: "Cuatro tacos de asada." },
  { speaker: "staff", text: "¿De comal o de harina?" },
  { speaker: "caller", text: "De comal." },
], menu);
check("one-comal-answer-covers-every-taco", coveredTacos.every((line) => !tortillaNote(line) && !meatNote(line)), JSON.stringify(coveredTacos.map((line) => line.elviNotes)));
const homemadeLine = { itemId: quesadilla.id, quantity: 2, modifiers: [comalMod, bistecMod], elviNotes: [] as string[] };
noteUnspokenRequiredChoice([homemadeLine], [
  { speaker: "caller", text: "Two quesadillas." },
  { speaker: "staff", text: "Street or homemade?" },
  { speaker: "caller", text: "Homemade." },
], menu);
check("homemade-after-a-tortilla-question-is-comal", !tortillaNote(homemadeLine), JSON.stringify(homemadeLine.elviNotes));
const pastorForms = [
  ["alpastor-maps-to-pastor", quesadilla.id, pastorMod, "Una quesadilla de Alpastor."],
  ["al-pastor-maps-to-pastor", gordita.id, gorditaPastor, "Una gordita de al pastor."],
  ["el-pastor-maps-to-pastor", burrito.id, burritoPastor, "A burrito of El Pastor."],
] as const;
for (const [name, itemId, mod, text] of pastorForms) {
  const line = { itemId, quantity: 1, modifiers: [mod], elviNotes: [] as string[] };
  noteUnspokenRequiredChoice([line], [{ speaker: "caller", text }], menu);
  check(name, !meatNote(line), JSON.stringify(line.elviNotes));
}
const asadaLine = { itemId: taco.id, quantity: 4, modifiers: [tacoBistec], elviNotes: [] as string[] };
noteUnspokenRequiredChoice([asadaLine], [{ speaker: "caller", text: "Cuatro tacos de asada." }], menu);
check("asada-maps-to-bistec", !meatNote(asadaLine), JSON.stringify(asadaLine.elviNotes));
const menudoFlour = groupOption(menudo, /tortilla/i, /harina|flour/i);
const menudoLine = { itemId: menudo.id, quantity: 1, modifiers: menudoFlour ? [menudoFlour] : [], elviNotes: [] as string[] };
const askedQuesadilla = { itemId: quesadilla.id, quantity: 1, modifiers: [comalMod, bistecMod], elviNotes: [] as string[] };
noteUnspokenRequiredChoice([menudoLine, askedQuesadilla], [
  { speaker: "caller", text: "Un menudo." },
  { speaker: "caller", text: "Y una quesadilla de bistec." },
  { speaker: "staff", text: "¿De maíz en el comal?" },
  { speaker: "caller", text: "Sí, por favor." },
], menu);
check("staff-question-does-not-clear-another-dish", tortillaNote(menudoLine) && !tortillaNote(askedQuesadilla), JSON.stringify({ menudo: menudoLine.elviNotes, quesadilla: askedQuesadilla.elviNotes }));
const cornMenudo = { itemId: menudo.id, quantity: 1, modifiers: [] as any[], elviNotes: ["confirmar (A) Menudo Tortillas"], validation: "unresolved" };
flagUnresolvedRequired([cornMenudo], menu, "ok");
noteUnspokenRequiredChoice([cornMenudo], [{ speaker: "caller", text: "Un menudo." }], menu);
const cornGate = gateTicketAcceptance({ requestedPhase: "final", autoAccepted: false, validation: orderValidation([cornMenudo]), cart: [cornMenudo] });
check("menudo-corn-default-finalizes-clean", cornGate.phase === "final" && orderValidation([cornMenudo]) === "clear" && (cornMenudo.modifiers || []).some((mod: any) => /corn/i.test(mod.option) && /comal/i.test(mod.option)) && !tortillaNote(cornMenudo), JSON.stringify({ phase: cornGate.phase, validation: orderValidation([cornMenudo]), mods: cornMenudo.modifiers, notes: cornMenudo.elviNotes }));
const garnishMenu = menu.map((item) => item.id === menudo.id ? { ...item, modifierGroups: [...(item.modifierGroups || []), { name: "(C) Menudo Garnish", minSelections: 1, maxSelections: 1, options: ["Cebolla", "Cilantro"], defaultOptions: ["Cebolla"] }] } : item);
const garnishLine = { itemId: menudo.id, quantity: 1, modifiers: [{ step: "(A) Menudo Tortillas", option: "4 x (Corn) Comal Tortilla" }, { step: "(C) Menudo Garnish", option: "Cebolla" }], elviNotes: [] as string[] };
noteUnspokenRequiredChoice([garnishLine], [{ speaker: "caller", text: "Un menudo." }], garnishMenu);
check("other-menudo-groups-still-hold", !tortillaNote(garnishLine) && (garnishLine.elviNotes || []).some((note) => /Garnish/i.test(note)), JSON.stringify(garnishLine.elviNotes));
const staffSize = { itemId: burrito.id, quantity: 2, modifiers: [groupOption(burrito, /size/i, /grande/i) || burritoPastor, groupOption(burrito, /carne|meat/i, /lengua/i) || burritoPastor].filter(Boolean), elviNotes: [] as string[] };
noteUnspokenRequiredChoice([staffSize], [
  { speaker: "caller", text: "Two burritos with lengua." },
  { speaker: "staff", text: "I put grande," },
  { speaker: "caller", text: "And two green sauces, please." },
], menu);
check("staff-only-size-stays-held", (staffSize.elviNotes || []).some((note) => /size/i.test(note)), JSON.stringify(staffSize.elviNotes));
const readback = { itemId: burrito.id, quantity: 2, modifiers: [groupOption(burrito, /carne|meat/i, /bistec|steak/i) || burritoPastor], elviNotes: [] as string[] };
noteUnspokenRequiredChoice([readback], [
  { speaker: "caller", text: "Two burritos." },
  { speaker: "staff", text: "Steak." },
  { speaker: "caller", text: "Yep." },
], menu);
check("yep-accepts-a-steak-readback", !meatNote(readback), JSON.stringify(readback.elviNotes));
const unnamed = { itemId: quesadilla.id, quantity: 1, modifiers: [comalMod, bistecMod], elviNotes: [] as string[] };
const namedEight = { itemId: quesadilla.id, quantity: 8, modifiers: [comalMod, bistecMod], elviNotes: [] as string[] };
noteUnspokenRequiredChoice([unnamed, namedEight], [
  { speaker: "caller", text: "I need two of the quesadilla." },
  { speaker: "staff", text: "So two orders." },
  { speaker: "caller", text: "Yep." },
  { speaker: "caller", text: "I need eight of your steak quesadillas." },
], menu);
check("quesadillas-without-a-named-meat-stay-held", meatNote(unnamed) && !meatNote(namedEight), JSON.stringify({ unnamed: unnamed.elviNotes, eight: namedEight.elviNotes }));
const keptPair = [
  { itemId: regularDorada, quantity: 1, modifiers: [regularStyle, bistecMod] },
  { itemId: deluxeDorada, quantity: 1, modifiers: [{ step: "(QD) Style", option: "(QD) DELUXE Preparada" }, bistecMod] },
];
reconcileAcceptedDishParts(keptPair, [
  { speaker: "caller", text: "Una dorada regular de bistec y una dorada preparada de bistec." },
  { speaker: "staff", text: "Repite la orden." },
], menu);
check("retake-keeps-regular-and-deluxe-of-the-same-meat", keptPair.length === 2 && keptPair[0].itemId === regularDorada && keptPair[1].itemId === deluxeDorada);
check("staff-clock-is-not-ready-time", callerReadyTime([{ speaker: "staff", text: "cerramos a las nueve" }, { speaker: "staff", text: "¿A las dos quesos?" }]) === null && callerReadyTime([{ speaker: "caller", text: "si puedo pasar por ellas a las nueve, digo a las once y media" }])?.time === "11:30");
check("person-pickup-is-not-togo", detectFulfillment([{ speaker: "caller", text: "Él lo recoge." }]).fulfillment !== "PICKUP" && detectFulfillment([{ speaker: "caller", text: "Voy a recoger a mi hijo." }]).fulfillment !== "PICKUP" && detectFulfillment([{ speaker: "caller", text: "Para recogerla." }]).fulfillment === "PICKUP");
check("no-tenemos-birria-is-unavailable", staffUnavailable([{ speaker: "caller", text: "Quiero un platillo de birria." }, { speaker: "staff", text: "No tenemos birria." }]).some((dish) => dish.includes("birria")));

const run: any = async () => ({ actions: [], reply: "" });
run.menu = () => menu;
function flow(turns: Array<{ speaker: string; text: string }>) {
  return shadowOrderFromTurns(turns.map((turn) => ({ ...turn, language: "es" })) as any, run);
}
const ronaldMenu = JSON.parse(readFileSync(new URL("../fixtures/CA4bdd506-menu.json", import.meta.url), "utf8"));
const ronaldFixture = JSON.parse(readFileSync(new URL("../fixtures/CA66f2c1-ronald2.json", import.meta.url), "utf8"));
const ronaldRun: any = async (text: string) => {
  const taco = (n: number, meat: string) => ({ type: "add_item", itemId: "sq-taco-TAR7L5", quantity: n, modifiers: [{ step: "(B) T Carnes / Meats Opciones", option: meat }, { step: "(A) T Tortilla Options", option: "(TST) Taco Taquero / Street Taco" }] });
  if (/tres tacos de bistec/i.test(text)) return { actions: [taco(3, "Bistec / Steak")], reply: "" };
  if (/cuatro tacos de pastor/i.test(text)) return { actions: [taco(4, "Alpastor / Roasted Pork")], reply: "" };
  return { actions: [], reply: "" };
};
ronaldRun.menu = () => ronaldMenu;
Promise.all([
  flow([
    { speaker: "caller", text: "Tráeme una Pepsi de bote grande." },
    { speaker: "staff", text: "La coca." },
    { speaker: "caller", text: "Sí." },
  ]),
  flow([
    { speaker: "caller", text: "¿Me puede preparar un platillo?" },
    { speaker: "staff", text: "Claro, un platillo de birria, muy bien, ¿algo más?" },
  ]),
  flow([
    { speaker: "caller", text: "Quiero un platillo de birria." },
    { speaker: "staff", text: "No tenemos birria." },
    { speaker: "caller", text: "Sí, está bien." },
  ]),
  flow([
    { speaker: "caller", text: "Quiero un platillo de birria." },
    { speaker: "staff", text: "Un platillo de birria." },
    { speaker: "caller", text: "Sí." },
  ]),
  shadowOrderFromTurns(ronaldFixture.turns, ronaldRun),
  evaluateCase(CASES.find((row) => row.id === "C07")!),
  evaluateCase(CASES.find((row) => row.id === "C10")!),
  flow(CASES.find((row) => row.id === "C10")!.turns),
  flow([{ speaker: "caller", text: "Quiero una libra de birria." }]),
  evaluateCase(CASES.find((row) => row.id === "C11")!),
  flow([
    { speaker: "caller", text: "Acabo de hacer una orden para entrega. Me pueden adherir una quesadilla de tripa." },
    { speaker: "staff", text: "A que nombre?" },
    { speaker: "caller", text: "A nombre de Ana." },
    { speaker: "staff", text: "Dame quince minutos." },
  ]),
  flow([
    { speaker: "caller", text: "Acabo de hacer una orden. Me pueden adherir una quesadilla de tripa." },
    { speaker: "staff", text: "A que nombre?" },
    { speaker: "caller", text: "A nombre de Ana." },
    { speaker: "staff", text: "Dame quince minutos." },
  ]),
]).then(([order, closing, denied, sized, ronald, c07, c10, c10order, libra, c11, deliveryAdd, plainAdd]: any[]) => {
  const cart = order.cart || [];
  const kept = cart.some((line: any) => line.itemId === pepsi.id) && !cart.some((line: any) => line.itemId === coke.id);
  check("wrong-readback-review-reason", kept && order.reviewReason === STAFF_LIST_REVIEW, JSON.stringify({ reviewReason: order.reviewReason, cart }));
  let diag = "";
  try { diag = readFileSync(process.env.ELVI_COUNTED_DIAG || "", "utf8"); } catch { diag = ""; }
  check("wrong-readback-scratch-diagnostic", diag.includes("staff-list-brand") && diag.includes(pepsi.id) && !/\btráeme\b/i.test(diag));
  check("c07-still-passes", c07.verdict === "pass", c07.failures?.join("; "));
  const closingCart = closing.cart || [];
  check("closing-staff-adds-nothing", !closingCart.some((line: any) => /birria/i.test(`${line.itemId} ${JSON.stringify(line.modifiers || [])}`)) && !!closing.reviewReason && closing.validation === "unresolved", JSON.stringify({ reviewReason: closing.reviewReason, validation: closing.validation, closingCart }));
  const deniedCart = denied.cart || [];
  check("denial-then-yes-adds-nothing", !deniedCart.some((line: any) => /birria/i.test(String(line.itemId))), JSON.stringify(deniedCart));
  const sizedCart = sized.cart || [];
  const sizedLine = sizedCart.find((line: any) => /birria/i.test(String(line.itemId)));
  check("unspoken-size-holds", !!sizedLine && (sizedLine.elviNotes || []).includes("confirmar") && (sized.validation === "unresolved" || !!sized.reviewReason), JSON.stringify({ validation: sized.validation, reviewReason: sized.reviewReason, sizedCart }));
  const ronaldCart = ronald.cart || [];
  const platter = ronaldCart.some((line: any) => /birria-de-chivo/i.test(String(line.itemId)));
  const queso = ronaldCart.some((line: any) => /queso-birria/i.test(String(line.itemId)));
  check("garbled-duplicate-not-added", queso && !platter, JSON.stringify(ronaldCart.map((line: any) => line.itemId)));
  check("c10-pickup", c10.ticket?.fulfillment === "PICKUP" && c10order.readyTime === "11:10" && c10order.addressPresent !== true && !c10.failures.some((line: string) => /fulfillment/.test(line)), `${c10.failures?.join("; ")} time=${c10order.readyTime} fulfillment=${c10order.fulfillment}`);
  const libraLine = (libra.cart || []).find((line: any) => /1-lb-of-birria/i.test(String(line.itemId)));
  check("libra-does-not-hold", !!libraLine && !(libraLine.elviNotes || []).includes("confirmar"), JSON.stringify(libra.cart));
  const c11Menudo = (c11.observedLines || []).find((line: any) => /menudo/i.test(line.name || ""));
  const c11Dorada = (c11.observedLines || []).find((line: any) => /deluxe/i.test(`${line.name} ${(line.modifiers || []).join(" ")}`) && /prensado/i.test((line.modifiers || []).join(" ")));
  check("c11-menudo-uses-corn-default", c11.verdict === "pass" && !!c11Dorada && (c11Menudo?.modifiers || []).some((mod: string) => /corn/i.test(mod) && /comal/i.test(mod)) && !(c11Menudo?.notes || []).some((note: string) => /tortilla/i.test(note)), JSON.stringify({ phase: c11.ticket?.phase, failures: c11.failures, menudo: c11Menudo }));
  check("addon-delivery-is-not-pickup", deliveryAdd.fulfillment !== "PICKUP" && plainAdd.fulfillment !== "PICKUP", JSON.stringify({ delivery: deliveryAdd.fulfillment, plain: plainAdd.fulfillment }));
  if (failures.length) process.exit(1);
});
