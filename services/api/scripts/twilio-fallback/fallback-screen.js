// Runs on the desk leg when it answers, before the caller is connected. Only a "1" connects.
exports.handler = (context, event, callback) => {
  const twiml = new Twilio.twiml.VoiceResponse();
  // autoconnect1: PRESS1=0 → short whisper, then connect (an empty end of TwiML bridges this leg). No keypress.
  if (String(context.PRESS1 || "1") === "0") {
    twiml.say({ language: "es-MX", voice: "Polly.Mia-Neural" }, "Llamada de Cocina Elvis.");
    return callback(null, twiml);
  }
  const g = twiml.gather({ input: "dtmf", numDigits: 1, timeout: 6, action: `https://${context.DOMAIN_NAME}/fallback-accept`, method: "POST" });
  const say = { language: "es-MX", voice: "Polly.Mia-Neural" };
  g.say(say, "Llamada de Cocina Elvis. Oprima uno para contestar.");
  g.say(say, "Oprima uno para contestar.");
  twiml.hangup();
  callback(null, twiml);
};
