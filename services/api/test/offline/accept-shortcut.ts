// The drink accept shortcut must wait while a named dish from the recent turns is still off the cart.
import { shadowOrderFromTurns } from "../../src/call-scoring.ts";

const menu = [
  { id: "sq-drink-coca-cola-JJE4KC", name: "Coca Cola", nameEs: "Coca Cola", aliases: ["coca", "coca cola"] },
  { id: "sq-quesadilla-HLT6CR", name: "Quesadilla", nameEs: "Quesadilla (ONLINE)" },
];
const turns = [
  { speaker: "caller" as const, text: "Me puede dar tres quesadillas de bistec.", start: 0, end: 1, language: "es" as const },
  { speaker: "staff" as const, text: "¿Del comal?", start: 2, end: 3, language: "es" as const },
  { speaker: "caller" as const, text: "Sí, hecha a mano. Una coca.", start: 4, end: 5, language: "es" as const },
];
const run: any = async () => ({ reply: "ok", actions: [] });
run.menu = () => menu;
shadowOrderFromTurns(turns, run).then((order: any) => {
  const quesadilla = (order.cart || []).some((line: any) => /quesadilla/i.test(String(line.itemId)));
  if (!quesadilla) {
    console.error("accept shortcut returned before the quesadilla was rung");
    process.exit(1);
  }
  console.log("PASS accept-shortcut");
});
