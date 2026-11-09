// Affirmed staff lists may add a missing line. They never overwrite or delete a caller line.
import { readFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { applyAffirmedStaffList, STAFF_LIST_REVIEW } from "../../src/list-repair.ts";
import { frozenPhoneMenu } from "../../src/phone-menu.ts";
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

const run: any = async () => ({ actions: [], reply: "" });
run.menu = () => menu;
Promise.all([
  shadowOrderFromTurns([
    { speaker: "caller", text: "Tráeme una Pepsi de bote grande.", language: "es" },
    { speaker: "staff", text: "La coca.", language: "es" },
    { speaker: "caller", text: "Sí.", language: "es" },
  ] as any, run),
  evaluateCase(CASES.find((row) => row.id === "C07")!),
]).then(([order, c07]: any[]) => {
  const cart = order.cart || [];
  const kept = cart.some((line: any) => line.itemId === pepsi.id) && !cart.some((line: any) => line.itemId === coke.id);
  check("wrong-readback-review-reason", kept && order.reviewReason === STAFF_LIST_REVIEW, JSON.stringify({ reviewReason: order.reviewReason, cart }));
  let diag = "";
  try { diag = readFileSync(process.env.ELVI_COUNTED_DIAG || "", "utf8"); } catch { diag = ""; }
  check("wrong-readback-scratch-diagnostic", diag.includes("staff-list-brand") && diag.includes(pepsi.id) && !/\btráeme\b/i.test(diag));
  check("c07-still-passes", c07.verdict === "pass", c07.failures?.join("; "));
  if (failures.length) process.exit(1);
});
