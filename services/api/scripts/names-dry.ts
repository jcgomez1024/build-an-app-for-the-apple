// names1 dry run: shows what saveCallerName would do for sample names. Writes nothing.
import dotenv from "dotenv"; dotenv.config({ path: ".env.twilio" });
const m = await import("../src/caller-memory.ts");
const { nameMatchForCall } = await import("../src/call-accuracy.ts");
const mask = (p: string) => "***-***-" + p.replace(/\D/g, "").slice(-4);
const cases: Array<[string, string, any]> = [
  ["+14402518110", "maria  GARCIA", "ticket"], ["+14402518110", "Receipt #A1B2", "ticket"], ["+14402518110", "Cliente", "ticket"], ["+14402518110", "TO GO", "ticket"],
  ["+14402518110", "J", "ticket"], ["+14402518110", "4405551234", "ticket"], ["+14402518110", "x".repeat(41), "ticket"], ["+14402518110", "josé luis", "square"],
  ["+14404139902", "Pedro", "ticket"], ["+14404139902", "Carlos", "manual"],
];
for (const [p, n, s] of cases) { const r = m.planCallerName(p, n, s); console.log(mask(p), JSON.stringify(n.slice(0, 20)), s, "->", r.save ? `SAVE "${r.name}" (greets: ${m.cleanFirstName(r.name)})` : `skip (${r.reason})`); }
const call = { at: "2026-10-19T15:00:00Z", caller: "+14402518110", talkSec: 60 };
const mk = (t: string, ph: string) => ({ id: "ORD", created_at: t, fulfillments: [{ pickup_details: { recipient: { display_name: "maria garcia", phone_number: ph } } }] });
console.log("match same phone in window:", JSON.stringify(nameMatchForCall(call, [mk("2026-10-19T15:10:00Z", "+14402518110")])?.name));
console.log("match other phone:", nameMatchForCall(call, [mk("2026-10-19T15:10:00Z", "+14405550000")]));
console.log("match outside window:", nameMatchForCall(call, [mk("2026-10-19T18:10:00Z", "+14402518110")]));
process.exit(0);
