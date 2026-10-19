// Desk pressed a key: "1" → empty response = connect the caller; anything else → hang up this leg.
exports.handler = (context, event, callback) => {
  const twiml = new Twilio.twiml.VoiceResponse();
  if (String(event.Digits || "") !== "1") twiml.hangup();
  callback(null, twiml);
};
