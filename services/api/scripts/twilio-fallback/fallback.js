// Voice FALLBACK for both Elvi lines (runs on Twilio when the Mac/tunnel is down).
// Rings the desk number(s) in DESK_NUMBERS (comma list, e.g. "+14405519249,+1440xxxxxxx") with the called Twilio
// number as caller ID. Each leg is screened ("oprima 1") so a carrier voicemail/announcement can't take the call.
// No answer / no "1" → the old backup voicemail (fallback-done).
exports.handler = (context, event, callback) => {
  const twiml = new Twilio.twiml.VoiceResponse();
  const base = `https://${context.DOMAIN_NAME}`;
  // closed1: closed days (CLOSED_DAYS 0=Sun..6=Sat, America/New_York) → message (ES then EN) and hang up. No ring.
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short" }));
  const closedDays = String(context.CLOSED_DAYS || "1").split(",").map((x) => Number(x.trim()));
  const d10 = (p) => String(p || "").replace(/\D/g, "").slice(-10);
  const bypass = String(context.CLOSED_BYPASS || "").split(",").map(d10).filter(Boolean);
  if (String(context.CLOSED_ENABLED || "0") === "1" && closedDays.includes(wd) && !(d10(event.From) && bypass.includes(d10(event.From)))) {
    twiml.play(`${base}/closed-es.mp3`);
    twiml.play(`${base}/closed-en.mp3`);
    twiml.hangup();
    return callback(null, twiml);
  }
  const nums = String(context.DESK_NUMBERS || "").split(",").map((s) => s.trim()).filter((s) => /^\+1\d{10}$/.test(s));
  const record = String(context.RECORD || "1") === "1";
  // autoconnect1: without press 1 a long ring lets carrier voicemail take the call → cap at AUTO_TIMEOUT (18 s).
  const press1 = String(context.PRESS1 || "1") !== "0";
  const timeout = Math.min(press1 ? 60 : Number(context.AUTO_TIMEOUT || 18), Math.max(5, Number(context.RING_TIMEOUT || 25)));
  if (!nums.length) { twiml.redirect({ method: "POST" }, `${base}/fallback-done`); return callback(null, twiml); }
  if (record) {
    twiml.say({ language: "es-MX", voice: "Polly.Mia-Neural" }, "Cocina Elvis. Esta llamada puede ser grabada.");
  }
  // callerid1: show the real caller on the desk/iPhone (Dial may pass the inbound From through). Anonymous/invalid,
  // our own lines (CALLER_ID_BLOCK) or PASS_CALLER_ID=0 → the called Twilio number, as before.
  const from = String(event.From || "").trim();
  const block = String(context.CALLER_ID_BLOCK || "").split(",").map((s) => s.replace(/\D/g, "").slice(-10)).filter(Boolean);
  const pass = String(context.PASS_CALLER_ID || "1") !== "0" && /^\+1[2-9]\d{2}[2-9]\d{6}$/.test(from) && !block.includes(from.slice(-10)) && !nums.includes(from);
  const opts = { timeout, callerId: pass ? from : event.To, action: `${base}/fallback-done`, method: "POST" };
  if (record) opts.record = "record-from-answer-dual";
  const dial = twiml.dial(opts);
  for (const n of nums) dial.number({ url: `${base}/fallback-screen`, method: "POST" }, n);
  callback(null, twiml);
};
