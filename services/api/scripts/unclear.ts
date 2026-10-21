// unclear1: node --import tsx scripts/unclear.ts list | on <CallSid> [note…] | off <CallSid>
import { loadUnclear, setUnclear } from "../src/unclear.ts";
const [cmd, sid, ...rest] = process.argv.slice(2);
if (cmd === "on" && sid) console.log(JSON.stringify(setUnclear(sid, true, { by: "cli", note: rest.join(" ") || undefined })[sid]));
else if (cmd === "off" && sid) { setUnclear(sid, false); console.log("cleared", sid); }
else console.log(JSON.stringify(loadUnclear(), null, 1));
