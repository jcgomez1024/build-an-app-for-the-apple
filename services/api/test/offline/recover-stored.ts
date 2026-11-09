// Fresh process. Loads the scratch ticket file through the app store, then runs recoveryAcceptance.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const scratch = process.argv[2];
const callSid = process.argv[3];
if (!scratch || !callSid) throw new Error("usage: recover-stored.ts <scratch-dir> <callSid>");
process.env.ELVI_CALL_LOG_DIR = scratch;
process.env.ELVI_CALLERS_FILE = path.join(scratch, "callers.json");
process.env.NODE_ENV = "test";

const file = path.join(scratch, "elvi-tickets.json");
const bytes = readFileSync(file);
const hash = createHash("sha256").update(bytes).digest("hex");
const twilio = await import("../../src/twilio.ts");
const stored = twilio.recoverStoredTicket(callSid);
console.log(JSON.stringify({ hash, file, ...stored }));
