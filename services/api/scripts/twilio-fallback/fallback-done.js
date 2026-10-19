// Dial finished. Bridged (desk talked to the caller) → hang up. Otherwise → the old backup voicemail.
exports.handler = (context, event, callback) => {
  const twiml = new Twilio.twiml.VoiceResponse();
  const thanks = () => { twiml.say({ language: "es-MX", voice: "Polly.Mia-Neural" }, "Gracias. Hasta luego."); twiml.hangup(); };
  // After the voicemail <Record> (its action points back here with vm=1): thank and hang up — never loop the prompt.
  // hangup1: bridged FIRST. The Dial's own record-from-answer-dual also sends RecordingUrl, which used to fall into the
  // voicemail "Gracias. Hasta luego." branch and kept the caller on the line ~2 s after the desk hung up.
  const bridged = String(event.DialBridged || "") === "true";
  if (bridged) { twiml.hangup(); return callback(null, twiml); }
  if (event.vm === "1") { thanks(); return callback(null, twiml); }
  twiml.say({ language: "es-MX", voice: "Polly.Mia-Neural" }, "Gracias por llamar a Cocina Elvis. En este momento no podemos contestar. Deje su nombre, su número y su pedido después del tono, y le regresamos la llamada. También puede ordenar en línea en cocinaelvis.com.");
  twiml.say({ language: "en-US", voice: "Polly.Danielle-Neural" }, "Thanks for calling Cocina Elvis. Please leave your name, number and order after the tone, or order online at cocinaelvis.com.");
  twiml.record({ maxLength: 120, timeout: 6, playBeep: true, finishOnKey: "#", action: `https://${context.DOMAIN_NAME}/fallback-done?vm=1`, method: "POST" });
  thanks(); // empty recording: Twilio skips the action and continues here
  callback(null, twiml);
};
