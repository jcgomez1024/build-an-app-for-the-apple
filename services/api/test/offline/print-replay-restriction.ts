// Print buildTicketLines for fixture CA3056f2 (alexandra1). The notes come from that transcript's cart.
import { readFileSync, writeFileSync } from "node:fs";
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";
import { buildTicketLines } from "../../src/twilio.ts";
import { frozenPhoneMenu } from "../../src/phone-menu.ts";

const outPath = process.argv[2];
if (!outPath) throw new Error("usage: print-replay-restriction.ts <out.json>");

const turns = JSON.parse(readFileSync(new URL("../fixtures/CA3056f2-turns.json", import.meta.url), "utf8"));
const GD = "sq-gordita-M647RE";
const HORCH = "sq-drink-agua-fresca-horchata-32oz-HL6HPK";
const stub = async (text: string) => {
  const t = text.toLowerCase();
  if (/wanted to place/.test(t)) return { reply: "Anything else?", actions: [] };
  if (/four of them|steak/.test(t) && /gordita|four|steak/.test(t)) {
    return { reply: "gorditas", actions: [{ type: "add_item", itemId: GD, quantity: 6, modifiers: [
      { step: "(A) Gordita Options", option: "(GD) Gordita" },
      { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" },
    ] }] };
  }
  if (/other two|lengua/.test(t)) {
    return { reply: "lengua", actions: [{ type: "update_item", itemId: GD, modifiers: [
      { step: "(A) Gordita Options", option: "(GD) Gordita" },
      { step: "(B) Q Carnes / Meats", option: "Lengua / Beef Tongue" },
      { step: "(B) Q Carnes / Meats", option: "Bistec / Steak" },
    ] }] };
  }
  if (/horchata|big things/.test(t)) return { reply: "horchata", actions: [{ type: "add_item", itemId: HORCH, quantity: 1, modifiers: [] }] };
  return { reply: "Anything else?", actions: [] };
};
const run: any = stub;
run.menu = () => frozenPhoneMenu();
shadowOrderFromTurns(turns, run).then((order: any) => {
  const menu = frozenPhoneMenu();
  const described = (order.cart || []).map((line: any) => ({
    name: menu.find((item) => item.id === line.itemId)?.name || line.itemId,
    quantity: Number(line.quantity) || 1,
    choices: (line.modifiers || []).map((mod: any) => String(mod.option || "")),
    totalCents: 0,
  }));
  const printed = buildTicketLines(described, order.cart || [], []);
  const body = {
    fixture: "CA3056f2",
    file: "services/api/test/fixtures/CA3056f2-turns.json",
    test: "alexandra1",
    printed: printed.map((line) => ({ name: line.name, quantity: line.quantity, notes: line.notes, flag: line.flag })),
  };
  writeFileSync(outPath, JSON.stringify(body, null, 2));
  const hit = body.printed.find((line) => line.notes.some((note) => /^(?:sin|no|without)\b/i.test(note)));
  if (!hit) {
    console.error("no restriction note on the printed ticket");
    process.exit(1);
  }
  console.log(JSON.stringify(hit));
});
