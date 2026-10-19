// ringsms1 dry run: renders the ring-time text WITHOUT sending anything.
//   npx tsx scripts/ring-sms-dry.mjs [CallSid]   (default: Carlos's 11:45 test call)
import fs from "node:fs";
const { ringSmsText, smsNumbers } = await import("../src/twilio.ts");
const sid = process.argv[2] || "CA6981240451bd5b241d6437c672f35484";
const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const evs = fs.readFileSync(new URL(`../data/logs/calls/${day}.jsonl`, import.meta.url), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.callSid === sid);
const inc = evs.find((e) => e.event === "incoming") || {};
const name = (evs.find((e) => e.event === "caller_name") || {}).name || null;
console.log("TWILIO_RING_SMS =", process.env.TWILIO_RING_SMS, "| to:", smsNumbers().join(", ") || "(none)", "| NOT SENT (dry run)");
console.log(ringSmsText({ name, from: inc.caller || "", at: Date.parse(inc.ts || Date.now()), forwardedFrom: inc.forwardedFrom }));
console.log(ringSmsText({ name: "Carlos", from: "+14404139902", at: Date.parse(inc.ts || Date.now()), forwardedFrom: "+14402898504" }), " <- if forwarded via 289");
console.log(ringSmsText({ name: null, from: "anonymous", at: Date.parse(inc.ts || Date.now()), forwardedFrom: "+14405519122" }), " <- private via 551");
process.exit(0);
