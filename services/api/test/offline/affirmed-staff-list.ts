// Affirmed staff lists may add a missing line. They never overwrite or delete a caller line.
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { reconcileCountedRequests, resolveConversationIntent } from "../../src/conversation-intent.ts";
import { flagUnresolvedRequired, gateTicketAcceptance, orderValidation } from "../../src/offline-evidence.ts";
import { callerReadyTime, detectFulfillment, spokenClock } from "../../src/delivery.ts";
import { applyAffirmedStaffList, applyDishScopedParts, applySettledQdConTodo, noteUnspokenRequiredChoice, reconcileAcceptedDishParts, reconcileSpokenExtras, STAFF_LIST_REVIEW } from "../../src/list-repair.ts";
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
check("fajitas-elvis-corn-default-clears", !(fajitaLine.elviNotes || []).some((note) => /tortilla/i.test(note)) && (fajitaLine.modifiers || []).some((mod: any) => mod.option === "3 x (Corn) Corn Tortilla") && !(fajitaLine.modifiers || []).some((mod: any) => /EXTRA/i.test(String(mod.option || ""))), JSON.stringify({ notes: fajitaLine.elviNotes, mods: fajitaLine.modifiers }));

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
check("menudo-corn-default-finalizes-clean", cornGate.phase === "final" && orderValidation([cornMenudo]) === "clear" && (cornMenudo.modifiers || []).some((mod: any) => mod.option === "4 x (Corn) Comal Tortilla") && !tortillaNote(cornMenudo), JSON.stringify({ phase: cornGate.phase, validation: orderValidation([cornMenudo]), mods: cornMenudo.modifiers, notes: cornMenudo.elviNotes }));
const spokenFlour = { itemId: menudo.id, quantity: 1, modifiers: menudoFlour ? [menudoFlour] : [], elviNotes: ["confirmar (A) Menudo Tortillas"] as string[] };
noteUnspokenRequiredChoice([spokenFlour], [{ speaker: "caller", text: "Un menudo de harina." }], menu);
check("spoken-tortilla-wins", !tortillaNote(spokenFlour) && (spokenFlour.modifiers || []).some((mod: any) => /harina|flour/i.test(mod.option)) && !(spokenFlour.modifiers || []).some((mod: any) => /comal/i.test(mod.option)), JSON.stringify(spokenFlour));
const quietQuesadilla = { itemId: quesadilla.id, quantity: 1, modifiers: [bistecMod], elviNotes: [] as string[] };
noteUnspokenRequiredChoice([quietQuesadilla], [{ speaker: "caller", text: "Una quesadilla de bistec." }], menu);
check("quesadilla-without-a-spoken-tortilla-holds", tortillaNote(quietQuesadilla), JSON.stringify(quietQuesadilla.elviNotes));
const quietTaco = { itemId: taco.id, quantity: 1, modifiers: [tacoBistec], elviNotes: [] as string[] };
noteUnspokenRequiredChoice([quietTaco], [{ speaker: "caller", text: "Un taco de bistec." }], menu);
check("taco-without-a-spoken-tortilla-holds", tortillaNote(quietTaco), JSON.stringify(quietTaco.elviNotes));
for (const [checkName, nameRe, spoken] of [
  ["guisado-defaults-to-regular-corn", /platillo de guisado/i, "Un platillo de guisado."],
  ["mole-defaults-to-regular-corn", /mole tradicional/i, "Un mole tradicional."],
  ["rellenos-defaults-to-regular-corn", /chiles rellenos/i, "Unos chiles rellenos."],
  ["fajitas-elvis-defaults-to-regular-corn", /^fajitas elvis/i, "Unas fajitas."],
] as const) {
  const item = menu.find((row) => nameRe.test(row.name) && !/platter|pack|combo|fiesta/i.test(row.name));
  if (!item) throw new Error(`phone menu is missing ${checkName}`);
  const line = { itemId: item.id, quantity: 1, modifiers: [] as any[], elviNotes: [] as string[] };
  noteUnspokenRequiredChoice([line], [{ speaker: "caller", text: spoken }], menu);
  const mods = JSON.stringify(line.modifiers || []);
  check(checkName, (line.modifiers || []).some((mod: any) => mod.option === "3 x (Corn) Corn Tortilla") && !/EXTRA/i.test(mods) && !tortillaNote(line), JSON.stringify({ notes: line.elviNotes, mods: line.modifiers }));
}
const flourFajita = menu.find((row) => /^fajitas elvis/i.test(row.name));
if (!flourFajita) throw new Error("phone menu is missing fajitas for the flour test");
const flourFajitaLine = { itemId: flourFajita.id, quantity: 1, modifiers: [] as any[], elviNotes: [] as string[] };
noteUnspokenRequiredChoice([flourFajitaLine], [{ speaker: "caller", text: "Unas fajitas de harina." }], menu);
check("fajitas-spoken-flour-stays-flour", (flourFajitaLine.modifiers || []).some((mod: any) => /harina|flour/i.test(String(mod.option || ""))) && !(flourFajitaLine.modifiers || []).some((mod: any) => /corn tortilla/i.test(String(mod.option || ""))) && !tortillaNote(flourFajitaLine), JSON.stringify(flourFajitaLine.modifiers));
const extraFajita = { itemId: flourFajita.id, quantity: 1, modifiers: [] as any[], elviNotes: [] as string[] };
noteUnspokenRequiredChoice([extraFajita], [{ speaker: "caller", text: "Unas fajitas y más tortillas de comal." }], menu);
check("extra-tortillas-when-the-caller-asks", (extraFajita.modifiers || []).some((mod: any) => mod.option === "3 x (Corn) Corn Tortilla") && (extraFajita.modifiers || []).some((mod: any) => /EXTRA/i.test(String(mod.option || "")) && /comal/i.test(String(mod.option || ""))) && !(extraFajita.elviNotes || []).some((note) => /EXTRA/i.test(note)), JSON.stringify(extraFajita));
const plainFajita = { itemId: flourFajita.id, quantity: 1, modifiers: [] as any[], elviNotes: [] as string[] };
noteUnspokenRequiredChoice([plainFajita], [{ speaker: "caller", text: "Unas fajitas de pollo." }], menu);
check("plain-order-does-not-add-extra-tortillas", (plainFajita.modifiers || []).some((mod: any) => mod.option === "3 x (Corn) Corn Tortilla") && !(plainFajita.modifiers || []).some((mod: any) => /EXTRA/i.test(String(mod.option || ""))), JSON.stringify(plainFajita.modifiers));
const acceptedExtra = { itemId: flourFajita.id, quantity: 1, modifiers: [] as any[], elviNotes: [] as string[] };
noteUnspokenRequiredChoice([acceptedExtra], [
  { speaker: "caller", text: "Unas fajitas de pollo." },
  { speaker: "staff", text: "¿Le pongo tortillas extra de comal?" },
  { speaker: "caller", text: "Sí." },
], menu);
check("caller-yes-adds-the-named-extra", (acceptedExtra.modifiers || []).some((mod: any) => /EXTRA/i.test(String(mod.option || "")) && /comal/i.test(String(mod.option || ""))), JSON.stringify(acceptedExtra.modifiers));
const acceptedUntyped = { itemId: flourFajita.id, quantity: 1, modifiers: [] as any[], elviNotes: [] as string[] };
noteUnspokenRequiredChoice([acceptedUntyped], [
  { speaker: "caller", text: "Unas fajitas de pollo." },
  { speaker: "staff", text: "¿Quiere tortillas extra?" },
  { speaker: "caller", text: "Ok." },
], menu);
check("caller-yes-without-a-type-holds-the-extra", (acceptedUntyped.elviNotes || []).some((note) => /EXTRA/i.test(note)) && !(acceptedUntyped.modifiers || []).some((mod: any) => /EXTRA/i.test(String(mod.option || ""))), JSON.stringify(acceptedUntyped));
const staffExtra = { itemId: flourFajita.id, quantity: 1, modifiers: [] as any[], elviNotes: [] as string[] };
noteUnspokenRequiredChoice([staffExtra], [
  { speaker: "caller", text: "Unas fajitas de pollo." },
  { speaker: "staff", text: "¿Le pongo tortillas extra de comal?" },
], menu);
check("staff-only-extra-tortillas-are-not-added", !(staffExtra.modifiers || []).some((mod: any) => /EXTRA/i.test(String(mod.option || ""))) && !(staffExtra.elviNotes || []).some((note) => /EXTRA/i.test(note)), JSON.stringify(staffExtra));
const unspecifiedExtra = { itemId: flourFajita.id, quantity: 1, modifiers: [] as any[], elviNotes: [] as string[] };
noteUnspokenRequiredChoice([unspecifiedExtra], [{ speaker: "caller", text: "Unas fajitas y más tortillas." }], menu);
check("extra-tortillas-without-a-type-stay-held", (unspecifiedExtra.elviNotes || []).some((note) => /EXTRA/i.test(note)) && !(unspecifiedExtra.modifiers || []).some((mod: any) => /EXTRA/i.test(String(mod.option || ""))), JSON.stringify(unspecifiedExtra));
const fiesta = menu.find((row) => /fiesta fajitas/i.test(row.name));
if (fiesta) {
  const fiestaLine = { itemId: fiesta.id, quantity: 1, modifiers: [] as any[], elviNotes: [] as string[] };
  noteUnspokenRequiredChoice([fiestaLine], [{ speaker: "caller", text: "Unas fajitas fiesta." }], menu);
  check("fiesta-fajitas-tortilla-stays-held", tortillaNote(fiestaLine) && !(fiestaLine.modifiers || []).some((mod: any) => /corn tortilla|comal tortilla/i.test(String(mod.option || ""))), JSON.stringify(fiestaLine));
}
const birriaCart: any[] = [];
applyDishScopedParts(birriaCart, [
  { speaker: "caller", text: "¿Tiene birria?" },
  { speaker: "staff", text: "Sí, un platillo de birria." },
  { speaker: "caller", text: "Un platillo." },
], menu);
check("birria-defaults-to-consome-and-tortillas", birriaCart.length === 1 && /NHFHDD/.test(String(birriaCart[0].itemId)) && /consome/.test(String(birriaCart[0].itemId)) && /tortilla/.test(String(birriaCart[0].itemId)) && !(birriaCart[0].elviNotes || []).includes("confirmar tamaño"), JSON.stringify(birriaCart));
const aguas = menu.filter((item) => /agua fresca/i.test(item.name));
const horchataDrink = aguas.find((item) => /horchata/i.test(item.name));
const otherAgua = aguas.filter((item) => item.id !== horchataDrink?.id);
if (!horchataDrink || otherAgua.length !== 1) throw new Error("phone menu should have horchata and one other agua fresca");
const oneOther: any[] = [];
applyDishScopedParts(oneOther, [
  { speaker: "caller", text: "Two of those large red drinks." },
  { speaker: "staff", text: "The horchata?" },
  { speaker: "caller", text: "The one next to the horchata." },
], menu);
check("one-other-agua-fresca-resolves", oneOther.length === 1 && oneOther[0].itemId === otherAgua[0].id && oneOther[0].quantity === 2 && !oneOther.some((line) => /horchata/i.test(String(line.itemId))), JSON.stringify(oneOther));
const alLado: any[] = [];
applyDishScopedParts(alLado, [
  { speaker: "caller", text: "Dos aguas." },
  { speaker: "staff", text: "¿La horchata?" },
  { speaker: "caller", text: "La de al lado de la horchata." },
], menu);
check("al-lado-de-resolves-the-other-agua", alLado.length === 1 && alLado[0].itemId === otherAgua[0].id && alLado[0].quantity === 2 && !alLado.some((line) => /horchata/i.test(String(line.itemId))), JSON.stringify(alLado));
const qCorn = groupOption(quesadilla, /tortilla/i, /comal/i);
const qSteak = groupOption(quesadilla, /carne|meat/i, /bistec|steak/i);
const qBeans = groupOption(quesadilla, /con \/ with/i, /frijol|bean/i);
function extraGate(turns: Array<{ speaker: string; text: string }>, modifiers: any[]) {
  const cart = [{ itemId: quesadilla.id, quantity: 1, modifiers: modifiers.map((mod) => ({ ...mod })), elviNotes: [] as string[] }];
  const unnamed = reconcileSpokenExtras(cart, turns, menu);
  const gate = gateTicketAcceptance({ requestedPhase: "final", validation: unnamed.length ? "unresolved" : "clear", reviewReason: unnamed.length ? `confirmar ${unnamed.join(", ")}` : null, cart });
  return { cart, unnamed, gate };
}
for (const [name, turns, seeded, expectBeans, expectHold] of [
  ["modifier-applied-is-final", [{ speaker: "caller", text: "One quesadilla with beans." }], true, true, false],
  ["modificador-aplicado-queda-final", [{ speaker: "caller", text: "Una quesadilla con frijoles." }], true, true, false],
  ["modifier-unmappable-holds", [{ speaker: "caller", text: "One quesadilla with glitter." }], false, false, "glitter"],
  ["modificador-sin-catalogo-queda-en-revision", [{ speaker: "caller", text: "Una quesadilla con purpurina." }], false, false, "purpurina"],
  ["modifier-withdrawn-is-final-without-it", [{ speaker: "caller", text: "One quesadilla with beans." }, { speaker: "caller", text: "Without beans." }], true, false, false],
  ["modificador-retirado-queda-final-sin-el", [{ speaker: "caller", text: "Una quesadilla con frijoles." }, { speaker: "caller", text: "Sin frijoles." }], true, false, false],
] as const) {
  const result = extraGate(turns as any, [qCorn, qSteak, ...(seeded && qBeans ? [qBeans] : [])]);
  const hasBeans = (result.cart[0].modifiers || []).some((mod: any) => /frijol|bean/i.test(String(mod.option || "")));
  const held = expectHold ? result.gate.phase === "review" && String(result.gate.reviewReason || "").includes(String(expectHold)) : result.gate.phase === "final" && !result.unnamed.length;
  check(name, held && hasBeans === expectBeans, JSON.stringify({ phase: result.gate.phase, reason: result.gate.reviewReason, mods: result.cart[0].modifiers, unnamed: result.unnamed }));
}
const riceEn = extraGate([{ speaker: "caller", text: "One quesadilla and a side of rice." }], [qCorn, qSteak]);
const riceEs = extraGate([{ speaker: "caller", text: "Una quesadilla y un lado de arroz." }], [qCorn, qSteak]);
const ricePresent = (cart: any[]) => cart.some((line) => /sq-sides-arroz-rice-26S6E6/.test(String(line.itemId)));
check("side-ordered-is-present-or-held", (ricePresent(riceEn.cart) && riceEn.gate.phase === "final") || (riceEn.gate.phase === "review" && /rice/.test(String(riceEn.gate.reviewReason || ""))), JSON.stringify({ phase: riceEn.gate.phase, reason: riceEn.gate.reviewReason, ids: riceEn.cart.map((line) => line.itemId) }));
check("lado-pedido-esta-o-queda-en-revision", (ricePresent(riceEs.cart) && riceEs.gate.phase === "final") || (riceEs.gate.phase === "review" && /arroz/.test(String(riceEs.gate.reviewReason || ""))), JSON.stringify({ phase: riceEs.gate.phase, reason: riceEs.gate.reviewReason, ids: riceEs.cart.map((line) => line.itemId) }));
const countedMissing = reconcileCountedRequests([], [{ speaker: "caller", text: "Tres tacos de bistec." }], menu);
check("missing-spoken-count-holds", countedMissing.reviewReason === "revisar pedido contado" && countedMissing.lines.length === 0, JSON.stringify(countedMissing));
const countedPresent = reconcileCountedRequests([{ itemId: taco.id, quantity: 3, modifiers: [tacoBistec] }], [{ speaker: "caller", text: "Tres tacos de asada de bistec." }], menu);
check("same-meat-two-words-are-covered", countedPresent.reviewReason !== "revisar pedido contado", JSON.stringify(countedPresent));
const bistecOption = (taco.modifierGroups || []).flatMap((group: any) => group.options || []).find((option: any) => option?.name === "Bistec / Steak");
const optionAliases = JSON.parse(readFileSync(new URL("../../data/option-aliases.json", import.meta.url), "utf8"));
const asadaRow = (optionAliases.options || []).find((row: any) => row.optionId === bistecOption?.id);
check("asada-alias-is-the-bistec-option-id", !!bistecOption?.id && asadaRow?.name === "Bistec / Steak" && (asadaRow.aliases || []).includes("asada") && !(optionAliases.options || []).some((row: any) => (row.aliases || []).includes("pastor") || (row.aliases || []).includes("chicken")), JSON.stringify({ id: bistecOption?.id, row: asadaRow }));
const asadaOnly = reconcileCountedRequests([{ itemId: taco.id, quantity: 3, modifiers: [tacoBistec] }], [{ speaker: "caller", text: "Tres tacos de asada." }], menu);
check("asada-option-id-covers-spoken-asada", asadaOnly.reviewReason !== "revisar pedido contado", JSON.stringify(asadaOnly));
const tacoPollo = groupOption(taco, /carne|meat/i, /pollo|chicken/i);
const asadaOnPollo = reconcileCountedRequests([{ itemId: taco.id, quantity: 3, modifiers: tacoPollo ? [tacoPollo] : [] }], [{ speaker: "caller", text: "Tres tacos de asada." }], menu);
check("asada-does-not-cover-a-different-meat", !!tacoPollo && asadaOnPollo.reviewReason === "revisar pedido contado", JSON.stringify(asadaOnPollo));
const countedRestated = reconcileCountedRequests([{ itemId: "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L", quantity: 3, modifiers: [{ step: "(QD) Style", option: "(QD) DELUXE Preparada" }, { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }] }], [
  { speaker: "caller", text: "Tres quesadillas de aceite de bistec." },
  { speaker: "caller", text: "Dame las tres, tres quesadillas nada más." },
], menu);
check("restated-count-is-not-another-order", countedRestated.reviewReason !== "revisar pedido contado", JSON.stringify(countedRestated));
const manyMenu = [...menu, { id: "sq-drink-agua-fresca-pina-32oz-TEST01", name: "Agua Fresca Pina 32oz", modifierGroups: [] }];
const many: any[] = [];
applyDishScopedParts(many, [
  { speaker: "caller", text: "Two of those large red drinks." },
  { speaker: "staff", text: "The horchata?" },
  { speaker: "caller", text: "The one next to the horchata." },
], manyMenu);
check("two-or-more-aguas-frescas-hold", many.length === 1 && /horchata/i.test(String(many[0].itemId)) && many[0].quantity === 2 && (many[0].elviNotes || []).includes("confirmar") && !many.some((line) => /pina|jamaica/i.test(String(line.itemId))), JSON.stringify(many));
const bothDrinks: any[] = [];
applyDishScopedParts(bothDrinks, [
  { speaker: "caller", text: "Two horchatas." },
  { speaker: "caller", text: "And the one next to the horchata." },
], menu);
check("ordered-landmark-agua-fresca-stays", bothDrinks.some((line) => /horchata/i.test(String(line.itemId))) && bothDrinks.some((line) => line.itemId === otherAgua[0].id), JSON.stringify(bothDrinks.map((line) => line.itemId)));
const horchata = menu.find((item) => item.id === "sq-drink-agua-fresca-horchata-32oz-HL6HPK");
if (!horchata) throw new Error("phone menu is missing horchata");
function drinkSize(text: string) {
  const line = { itemId: horchata.id, quantity: 1, modifiers: [] as any[], elviNotes: [] as string[] };
  noteUnspokenRequiredChoice([line], [{ speaker: "caller", text }], menu);
  return line.elviNotes || [];
}
check("spoken-ounce-size-is-not-a-hold", !drinkSize("Two 32-ounce horchatas.").some((note) => /tamaño/.test(note)) && !drinkSize("Dos horchatas de treinta y dos onzas.").some((note) => /tamaño/.test(note)));
check("single-size-drink-does-not-hold", !drinkSize("Una horchata.").some((note) => /tamaño/.test(note)) && !drinkSize("Un agua de jamaica.").some((note) => /tamaño/.test(note)));
check("unavailable-drink-size-stays-a-mismatch", drinkSize("Una horchata chica.").some((note) => /tamaño distinto/.test(note)));
check("flour-menudo-stays-held", tortillaNote(menudoLine), JSON.stringify(menudoLine.elviNotes));
const extraReason = { itemId: menudo.id, quantity: 1, modifiers: [] as any[], elviNotes: ["confirmar (A) Menudo Tortillas", "confirmar otra cosa"], validation: "unresolved" as const };
noteUnspokenRequiredChoice([extraReason], [{ speaker: "caller", text: "Un menudo." }], menu);
check("menudo-validation-stays-when-another-reason-remains", extraReason.validation === "unresolved" && (extraReason.elviNotes || []).includes("confirmar otra cosa") && !tortillaNote(extraReason), JSON.stringify(extraReason));
const handmade = { itemId: quesadilla.id, quantity: 1, modifiers: [comalMod, bistecMod], elviNotes: [] as string[] };
noteUnspokenRequiredChoice([handmade], [
  { speaker: "caller", text: "Una quesadilla de bistec." },
  { speaker: "staff", text: "¿De qué tortilla?" },
  { speaker: "caller", text: "Hecha a mano." },
], menu);
check("hecha-a-mano-is-comal", !tortillaNote(handmade), JSON.stringify(handmade.elviNotes));
const carnita = { itemId: taco.id, quantity: 1, modifiers: [groupOption(taco, /carne|meat/i, /carnitas/i) || tacoBistec], elviNotes: [] as string[] };
noteUnspokenRequiredChoice([carnita], [
  { speaker: "caller", text: "Tiene tacos, pero tortilla hecha a mano." },
  { speaker: "caller", text: "Uno de carnita." },
], menu);
check("carnita-and-hecha-a-mano-clear-the-taco", !meatNote(carnita) && !tortillaNote(carnita), JSON.stringify(carnita.elviNotes));
const nudito = { itemId: gordita.id, quantity: 1, modifiers: [gorditaBistec], elviNotes: [] as string[] };
noteUnspokenRequiredChoice([nudito], [
  { speaker: "caller", text: "Seis nuditos, por favor." },
  { speaker: "caller", text: "Uno de bistec." },
], menu);
check("dish-alias-binds-the-meat", !meatNote(nudito), JSON.stringify(nudito.elviNotes));
const flourA = { itemId: quesadilla.id, quantity: 1, modifiers: [groupOption(quesadilla, /tortilla/i, /harina|flour/i) || comalMod, bistecMod], elviNotes: [] as string[] };
const flourB = { itemId: quesadilla.id, quantity: 1, modifiers: [groupOption(quesadilla, /tortilla/i, /harina|flour/i) || comalMod, pastorMod], elviNotes: [] as string[] };
noteUnspokenRequiredChoice([flourA, flourB], [{ speaker: "caller", text: "Two flour quesadillas: one steak, one pastor." }], menu);
check("split-list-covers-every-line", !tortillaNote(flourA) && !tortillaNote(flourB) && !meatNote(flourA) && !meatNote(flourB), JSON.stringify({ a: flourA.elviNotes, b: flourB.elviNotes }));
const six = { itemId: quesadilla.id, quantity: 6, modifiers: [comalMod, bistecMod], elviNotes: [] as string[] };
const laterTwo = { itemId: quesadilla.id, quantity: 2, modifiers: [comalMod, pastorMod], elviNotes: [] as string[] };
noteUnspokenRequiredChoice([six, laterTwo], [
  { speaker: "caller", text: "Seis quesadillas de bistec." },
  { speaker: "caller", text: "De maíz." },
  { speaker: "staff", text: "En el comal." },
  { speaker: "caller", text: "Sí." },
  { speaker: "caller", text: "Deme dos de pastor." },
], menu);
check("later-order-keeps-its-own-tortilla-hold", !tortillaNote(six) && tortillaNote(laterTwo), JSON.stringify({ six: six.elviNotes, two: laterTwo.elviNotes }));
const earlier = { itemId: taco.id, quantity: 2, modifiers: [tacoComal, groupOption(taco, /carne|meat/i, /pollo|chicken/i) || tacoBistec], elviNotes: [] as string[] };
const addedOne = { itemId: taco.id, quantity: 1, modifiers: [groupOption(taco, /tortilla/i, /harina|flour/i) || tacoComal, groupOption(taco, /carne|meat/i, /pollo|chicken/i) || tacoBistec], elviNotes: [] as string[] };
noteUnspokenRequiredChoice([earlier, addedOne], [
  { speaker: "caller", text: "Two street steak tacos." },
  { speaker: "caller", text: "Plus one flour chicken taco." },
  { speaker: "caller", text: "Swap the earlier line for the same number of homemade comal tacos, steak or chicken." },
  { speaker: "caller", text: "Chicken, not steak." },
], menu);
const earlierEs = { itemId: taco.id, quantity: 2, modifiers: [tacoComal, groupOption(taco, /carne|meat/i, /pollo|chicken/i) || tacoBistec], elviNotes: [] as string[] };
const addedEs = { itemId: taco.id, quantity: 1, modifiers: [groupOption(taco, /tortilla/i, /harina|flour/i) || tacoComal, groupOption(taco, /carne|meat/i, /pollo|chicken/i) || tacoBistec], elviNotes: [] as string[] };
noteUnspokenRequiredChoice([earlierEs, addedEs], [
  { speaker: "caller", text: "Dos tacos taqueros de bistec." },
  { speaker: "caller", text: "Más un taco de harina de pollo." },
  { speaker: "caller", text: "Cambia la primera línea por la misma cantidad de tacos de comal, de bistec o de pollo." },
  { speaker: "caller", text: "De pollo, no de bistec." },
], menu);
check("same-number-covers-the-earlier-line", !tortillaNote(earlier) && !meatNote(earlier) && !tortillaNote(addedOne) && !meatNote(addedOne) && !tortillaNote(earlierEs) && !meatNote(earlierEs) && !tortillaNote(addedEs) && !meatNote(addedEs), JSON.stringify({ earlier: earlier.elviNotes, added: addedOne.elviNotes, earlierEs: earlierEs.elviNotes, addedEs: addedEs.elviNotes }));
const bareHandmade = { itemId: quesadilla.id, quantity: 1, modifiers: [comalMod, bistecMod], elviNotes: [] as string[] };
noteUnspokenRequiredChoice([bareHandmade], [
  { speaker: "caller", text: "Una quesadilla de bistec." },
  { speaker: "staff", text: "¿De qué tortilla?" },
  { speaker: "caller", text: "Hecha mano." },
], menu);
check("hecha-mano-without-a-is-comal", !tortillaNote(bareHandmade), JSON.stringify(bareHandmade.elviNotes));
const realPicadillo = "Picadillo / Ground Beef with Potatoes";
const comalPicadillo = { itemId: quesadilla.id, quantity: 3, modifiers: [{ step: "(B) Q Carnes / Meats", option: realPicadillo }, comalMod], elviNotes: [] as string[] };
const bistecDorada = { itemId: "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L", quantity: 2, modifiers: [{ step: "(QD) Style", option: "(QD) DELUXE Preparada" }, { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }], elviNotes: [] as string[] };
const extraDorada = { itemId: "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L", quantity: 1, modifiers: [{ step: "(QD) Style", option: "(QD) DELUXE Preparada" }, { step: "(B) Q Carnes / Meats", option: realPicadillo }], elviNotes: [] as string[] };
const oneDorada = [comalPicadillo, bistecDorada, extraDorada];
applyDishScopedParts(oneDorada, [
  { speaker: "caller", text: "Una de dos quesadillas doradas de bistec preparadas." },
  { speaker: "caller", text: "Unas tres quesadillas de comal de picadillo." },
], menu);
check("one-spoken-dorada-drops-the-other-meat", oneDorada.length === 2 && oneDorada.some((line) => line.itemId === quesadilla.id) && oneDorada.some((line) => /bistec|steak/i.test(JSON.stringify(line.modifiers))) && !oneDorada.some((line) => /qd-deluxe/.test(String(line.itemId)) && /picadillo/i.test(JSON.stringify(line.modifiers))), JSON.stringify(oneDorada.map((line) => ({ id: line.itemId, mods: line.modifiers }))));
const orderedDorada = { itemId: "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L", quantity: 1, modifiers: [{ step: "(QD) Style", option: "(QD) DELUXE Preparada" }, { step: "(B) Q Carnes / Meats", option: "Picadillo / Ground Beef with Potatoes" }], elviNotes: [] as string[] };
const orderedComal = { itemId: quesadilla.id, quantity: 3, modifiers: [{ step: "(B) Q Carnes / Meats", option: "Picadillo / Ground Beef" }, comalMod], elviNotes: [] as string[] };
const bothPicadillo = [orderedComal, orderedDorada];
applyDishScopedParts(bothPicadillo, [
  { speaker: "caller", text: "Una quesadilla dorada de picadillo." },
  { speaker: "caller", text: "Y tres quesadillas de comal de picadillo." },
], menu);
check("dorada-and-comal-of-the-same-meat-both-stay", bothPicadillo.length === 2 && bothPicadillo.some((line) => line.itemId === quesadilla.id) && bothPicadillo.some((line) => /qd-deluxe/.test(String(line.itemId))), JSON.stringify(bothPicadillo.map((line) => line.itemId)));
const personA = { itemId: taco.id, quantity: 2, modifiers: [tacoComal, tacoBistec], elviNotes: [] as string[] };
const personB = { itemId: taco.id, quantity: 2, modifiers: [tacoComal, tacoBistec], elviNotes: [] as string[] };
const identical = [personA, personB];
applyDishScopedParts(identical, [
  { speaker: "caller", text: "Para mí, dos tacos de bistec al comal." },
  { speaker: "caller", text: "Y para él, dos tacos de bistec al comal." },
], menu);
check("two-people-order-the-identical-dish", identical.length === 2 && identical.every((line) => line.quantity === 2 && line.itemId === taco.id), JSON.stringify(identical.map((line) => line.quantity)));
const streetLine = { itemId: taco.id, quantity: 2, modifiers: [groupOption(taco, /tortilla/i, /street|taquer|TST/i) || tacoComal, tacoBistec], elviNotes: [] as string[] };
const comalLine = { itemId: taco.id, quantity: 2, modifiers: [tacoComal, tacoBistec], elviNotes: [] as string[] };
const streetAndComal = [streetLine, comalLine];
applyDishScopedParts(streetAndComal, [
  { speaker: "caller", text: "Dos tacos taqueros de bistec." },
  { speaker: "caller", text: "Y dos tacos de bistec al comal." },
], menu);
check("street-and-comal-of-the-same-meat-both-stay", streetAndComal.length === 2, JSON.stringify(streetAndComal));
const firstOrder = { itemId: taco.id, quantity: 2, modifiers: [tacoComal, groupOption(taco, /carne|meat/i, /pastor/i) || tacoBistec], elviNotes: [] as string[] };
const secondOrder = { itemId: taco.id, quantity: 2, modifiers: [tacoComal, groupOption(taco, /carne|meat/i, /cabeza/i) || tacoBistec], elviNotes: [] as string[] };
const twoOrders = [firstOrder, secondOrder];
applyDishScopedParts(twoOrders, [{ speaker: "caller", text: "Cuatro tacos de comal, dos de pastor y dos de cabeza." }], menu);
check("two-orders-of-the-same-dish-both-stay", twoOrders.length === 2, JSON.stringify(twoOrders.map((line) => line.quantity)));
const regularDoradaLine = { itemId: "sq-qd-quesadilla-dorada-qd-regular-dorada-T5STUH", quantity: 1, modifiers: [{ step: "(QD) Style", option: "(QD) REGULAR Dorada" }, { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }], elviNotes: [] as string[] };
const deluxeDoradaLine = { itemId: "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L", quantity: 1, modifiers: [{ step: "(QD) Style", option: "(QD) DELUXE Preparada" }, { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }], elviNotes: [] as string[] };
const bothStyles = [regularDoradaLine, deluxeDoradaLine];
applyDishScopedParts(bothStyles, [{ speaker: "caller", text: "Una quesadilla dorada regular de bistec y una preparada de bistec." }], menu);
check("regular-and-deluxe-of-the-same-meat-both-stay", bothStyles.length === 2, JSON.stringify(bothStyles.map((line) => line.itemId)));
const otherRegular = [
  { itemId: "sq-qd-quesadilla-dorada-qd-regular-dorada-T5STUH", quantity: 1, modifiers: [{ step: "(QD) Style", option: "(QD) REGULAR Dorada" }, { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }], elviNotes: [] as string[] },
  { itemId: "sq-qd-quesadilla-dorada-qd-deluxe-preparada-ZZAV3L", quantity: 2, modifiers: [{ step: "(QD) Style", option: "(QD) DELUXE Preparada" }, { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" }], elviNotes: [] as string[] },
];
applyDishScopedParts(otherRegular, [
  { speaker: "caller", text: "Una coca regular." },
  { speaker: "caller", text: "Dos quesadillas doradas de bistec preparadas." },
], menu);
check("regular-on-another-dish-does-not-keep-the-dorada", otherRegular.length === 1 && /deluxe/.test(String(otherRegular[0].itemId)), JSON.stringify(otherRegular.map((line) => line.itemId)));
const splitA = { itemId: quesadilla.id, quantity: 1, modifiers: [comalMod, bistecMod], elviNotes: [] as string[] };
const splitB = { itemId: quesadilla.id, quantity: 1, modifiers: [comalMod, pastorMod], elviNotes: [] as string[] };
noteUnspokenRequiredChoice([splitA, splitB], [
  { speaker: "caller", text: "Dos quesadillas de comal." },
  { speaker: "caller", text: "Una de bistec y una de pastor." },
], menu);
check("split-total-covers-each-line", !tortillaNote(splitA) && !tortillaNote(splitB), JSON.stringify({ a: splitA.elviNotes, b: splitB.elviNotes }));
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
  flow([
    { speaker: "caller", text: "Cuatro tacos de comal, dos de pastor y dos de cabeza." },
    { speaker: "caller", text: "Sí, el normal. Uno de lengua." },
  ]),
  flow([
    { speaker: "caller", text: "Sopes de los normales." },
    { speaker: "caller", text: "De chorizo." },
  ]),
]).then(async ([order, closing, denied, sized, ronald, c07, c10, c10order, libra, c11, deliveryAdd, plainAdd, tacoNormal, namedSope]: any[]) => {
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
  check("unspoken-size-holds", !!sizedLine && /NHFHDD|consome/.test(String(sizedLine.itemId)) && /tortilla/.test(String(sizedLine.itemId)) && !/solo-only-consome/.test(String(sizedLine.itemId)) && !(sizedLine.elviNotes || []).includes("confirmar tamaño"), JSON.stringify(sizedLine));
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
  check("normal-during-tacos-does-not-add-a-sope", !(tacoNormal.cart || []).some((line: any) => /sope/i.test(String(line.itemId))), JSON.stringify((tacoNormal.cart || []).map((line: any) => line.itemId)));
  check("named-small-sope-still-lands", (namedSope.cart || []).some((line: any) => /sope/i.test(String(line.itemId))), JSON.stringify((namedSope.cart || []).map((line: any) => line.itemId)));
  const c05 = await evaluateCase(CASES.find((row) => row.id === "C05")!);
  check("c05-counted-hold-cleared", c05.verdict === "pass" && c05.ticket?.phase === "final" && c05.ticket?.reviewReason == null, JSON.stringify({ phase: c05.ticket?.phase, reason: c05.ticket?.reviewReason, failures: c05.failures }));
  check("c07-counted-hold-cleared", c07.verdict === "pass" && c07.ticket?.phase === "final" && c07.ticket?.reviewReason == null, JSON.stringify({ phase: c07.ticket?.phase, reason: c07.ticket?.reviewReason, failures: c07.failures }));
  const c09 = await evaluateCase(CASES.find((row) => row.id === "C09")!);
  const dip = (c09.observedLines || []).find((line: any) => /elvis|dip/i.test(line.name || ""));
  check("c09-chorizo-clears-the-meat-hold", c09.verdict === "pass" && (dip?.notes || []).some((note: string) => /Elvis Dip Side/.test(note)) && !(dip?.notes || []).some((note: string) => /Nachos Carne/.test(note)), JSON.stringify(dip));
  const deniedTaco = await flow([
    { speaker: "caller", text: "¿Hay tacos?" },
    { speaker: "staff", text: "No hay tacos." },
    { speaker: "caller", text: "Entonces quiero un taco taquero de pollo." },
  ]);
  check("staff-no-hay-does-not-add-that-dish", !(deniedTaco.cart || []).some((line: any) => /taco/i.test(String(line.itemId))), JSON.stringify((deniedTaco.cart || []).map((line: any) => line.itemId)));
  const compound = await flow([
    { speaker: "caller", text: "One street chicken taco." },
    { speaker: "caller", text: "Add two homemade comal steak tacos and change the earlier taco." },
  ]);
  const optionText = (line: any) => (line.modifiers || []).map((modifier: any) => modifier.option).join(" ");
  const chickenLine = (compound.cart || []).find((line: any) => /pollo|chicken/i.test(optionText(line)));
  const addedLine = (compound.cart || []).find((line: any) => /bistec|steak/i.test(optionText(line)));
  const compoundReply = ((compound.steps || []).filter((step: any) => step.source === "conversation-intent").at(-1) || {}).reply || "";
  check("unspecified-change-adds-and-keeps-the-earlier-line", Number(chickenLine?.quantity) === 1 && Number(addedLine?.quantity) === 2 && /Pollo \/ Chicken/.test(compoundReply) && /\(A\) T Tortilla Options/.test(compoundReply), JSON.stringify({ cart: (compound.cart || []).map((line: any) => `${line.quantity} ${optionText(line)}`), reply: compoundReply }));
  const settled = await flow([
    { speaker: "caller", text: "One street chicken taco." },
    { speaker: "caller", text: "Add two homemade comal steak tacos and change the earlier taco." },
    { speaker: "caller", text: "Leave the earlier taco exactly as it was; only add those two homemade comal steak tacos." },
  ]);
  const settledTacos = (settled.cart || []).filter((line: any) => /taco/i.test(String(line.itemId)));
  const settledChicken = settledTacos.find((line: any) => /pollo|chicken/i.test(optionText(line)));
  const settledSteak = settledTacos.find((line: any) => /bistec|steak/i.test(optionText(line)));
  check("leave-earlier-does-not-add-them-again", settledTacos.length === 2 && Number(settledChicken?.quantity) === 1 && Number(settledSteak?.quantity) === 2, JSON.stringify(settledTacos.map((line: any) => `${line.quantity} ${optionText(line)}`)));
  const spanish = await flow([
    { speaker: "caller", text: "Un taco taquero de pollo." },
    { speaker: "caller", text: "Agrega dos tacos de comal de bistec y cambia el taco anterior." },
  ]);
  const spanishChicken = (spanish.cart || []).find((line: any) => /pollo|chicken/i.test(optionText(line)));
  const spanishSteak = (spanish.cart || []).find((line: any) => /bistec|steak/i.test(optionText(line)));
  check("cambio-anterior-agrega-y-deja-la-linea", Number(spanishChicken?.quantity) === 1 && Number(spanishSteak?.quantity) === 2, JSON.stringify((spanish.cart || []).map((line: any) => `${line.quantity} ${optionText(line)}`)));
  const intentAdd = resolveConversationIntent({
    transcript: "Leave the earlier taco exactly as it was; only add those two homemade comal steak tacos.",
    language: "en",
    menu,
    cart: [{ itemId: taco.id, quantity: 1, modifiers: [groupOption(taco, /tortilla/i, /street|taquer|TST/i) || tacoComal, groupOption(taco, /carne|meat/i, /pollo|chicken/i) || tacoBistec] }],
    history: [{ role: "customer", text: "Add two homemade comal steak tacos and change the earlier taco." }],
  });
  check("leave-earlier-intent-adds", (intentAdd?.actions || []).some((action) => action.type === "add_item" && action.quantity === 2), JSON.stringify(intentAdd));
  if (failures.length) process.exit(1);
});
