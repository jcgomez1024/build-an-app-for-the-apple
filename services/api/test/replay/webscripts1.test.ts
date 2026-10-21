// webscripts1: every inline <script> in apps/web/*.html must parse. A stray "//" in a one-line function
// once commented out the rest of calls.html's script and the page showed nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import path from "node:path";
const web = path.resolve(import.meta.dirname, "../../../../apps/web");
for (const f of fs.readdirSync(web).filter((x) => x.endsWith(".html"))) {
  test(`webscripts1: ${f} inline scripts parse`, () => {
    const html = fs.readFileSync(path.join(web, f), "utf8");
    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => !/type="(application\/json|importmap)"/.test(m[1]));
    for (const [i, m] of scripts.entries()) {
      const mod = /type="module"/.test(m[1]);
      assert.doesNotThrow(() => { if (mod) new Function(`return async () => {}`); else new Function(m[2]); }, `${f} script #${i}`);
    }
  });
}
test("webscripts1: avgOf one-liner keeps its return", () => {
  const s = fs.readFileSync(path.join(web, "calls.html"), "utf8");
  assert.ok(!/const avgOf[^\n]*\/\/[^\n]*return/.test(s));
});
