// intro3: new callers — "Cocina Elvis" + notice, then Enqueue right away (no speech-language Gather).
import { test } from "node:test";
import assert from "node:assert/strict";
import { introTwiml, NOTICE_NEW } from "../../src/twilio.ts";

test("intro3: opening → notice → enqueue, no language-listening pause", () => {
  const x = introTwiml("https://x.test", "<Say>N</Say>", "<Enqueue>q</Enqueue>");
  assert.doesNotMatch(x, /<Gather|<Redirect/);
  assert.ok(x.indexOf("<Say>N</Say>") < x.indexOf("<Enqueue>"));
  assert.ok(x.indexOf("Cocina Elvis") >= 0 || /opening-es/.test(x));
  assert.equal(NOTICE_NEW.es, "Enseguida le atendemos. Esta llamada puede ser grabada.");
});
