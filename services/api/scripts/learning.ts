/** learn2: Elvi learning loop. Usage: npx tsx scripts/learning.ts build | nightly | list | approve <id> | reject <id> [reason]
 *  Local data only (data/learning/, gitignored). Square read-only via the running server's /api/calls/accuracy. No calls/SMS. */
import dotenv from "dotenv"; import fs from "node:fs"; import path from "node:path"; import { execSync } from "node:child_process"; import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") }); dotenv.config({ path: path.join(root, ".env.twilio") });
const K = await import("../src/elvi-knowledge.ts");
const L = await import("../src/learning.ts");
const { scoreOrder, elviLines } = await import("../src/call-accuracy.ts");
const [cmd, arg, ...rest] = process.argv.slice(2);
const dir = K.LEARN_DIR; fs.mkdirSync(dir, { recursive: true });
const J = (f: string, d: any) => fs.writeFileSync(path.join(dir, f), JSON.stringify(d, null, 1));
const MAX_ATTEMPTS = Number(process.env.ELVI_RETRY_ATTEMPTS || 3);

if (cmd === "list") { for (const c of K.readPending()) console.log(c.status.padEnd(8), c.id, c.dish, JSON.stringify(c.key), "→", c.item, c.choices.join("; "), c.reason || ""); process.exit(0); }
if (cmd === "approve" || cmd === "reject") {
  const c = K.readPending().find((x) => x.id === arg);
  if (cmd === "approve" && (!c || c.regression?.replays.some((r) => r.after < r.before) || c.regression?.suite !== "pass")) { console.error("refused: unknown id, or candidate has regressions"); process.exit(1); }
  const r = K.decide(arg, cmd === "approve", "developer (Grok Bot)", rest.join(" ")); console.log(r ? `${cmd}d ${arg}` : "no pending candidate with that id"); process.exit(r ? 0 : 1);
}

async function build() {
  const res = await fetch("http://localhost:4000/api/calls/accuracy?days=90"); const data: any = await res.json();
  const phone = (data.calls || []).filter((r: any) => r.source !== "training").map(L.phoneExample).filter(Boolean);
  const sdir = path.join(root, "data/logs/sessions"); const app: any[] = [];
  for (const f of fs.readdirSync(sdir).filter((x) => x.endsWith(".jsonl") && !/-(call|rescore|probe|replay|expected|test|learn)/.test(x))) {
    const es = fs.readFileSync(path.join(sdir, f), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    if (!es.some((e: any) => /^(app|web-resolve|chat|voice-text|voice-audio)$/.test(String(e.channel)) || e.event === "checkout")) continue;
    const ex = L.appExample(f.replace(/\.jsonl$/, ""), es); if (ex) app.push(ex);
  }
  const all = [...phone, ...app];
  fs.writeFileSync(path.join(dir, "examples.jsonl"), all.map((e) => JSON.stringify({ ...e, truthLines: undefined })).join("\n") + "\n");
  fs.writeFileSync(path.join(dir, "finetune.jsonl"), all.map((e) => JSON.stringify(L.finetuneRow(e))).join("\n") + "\n");
  const patterns = L.staffPatterns(phone as any), acc = L.voiceAccuracy(phone as any);
  const wk = acc.length ? acc[acc.length - 1].week : "";
  J("report.json", { generatedAt: new Date().toISOString(), examples: { phone: phone.length, app: app.length, appPaid: app.filter((a) => a.weight === 1).length, staffCorrected: phone.filter((p: any) => p.corrected.length).length },
    voiceAccuracy: acc, staffPatterns: patterns, coaching: L.coachingPoints(patterns, wk) });
  return { phone: phone as any[], app, data };
}

async function replayer() {
  const { shadowOrderFromTurns } = await import("../src/call-scoring.ts");
  const { chatWithElvi } = await import("../src/elvi.ts");
  const { getMenu, getFullMenu } = await import("../src/square.ts");
  const { resolveTenant } = await import("../src/tenant.ts");
  const tenant = resolveTenant(undefined);
  const cfg: any = { env: tenant.square.env, accessToken: tenant.square.accessToken, locationId: tenant.square.locationId, apiVersion: tenant.square.apiVersion, appPublicUrl: "http://localhost:4000", businessName: tenant.branding.displayName };
  const menu = await getMenu(cfg); const resolverMenu: any[] = await getFullMenu(cfg).catch(() => menu);
  const replay = async (row: any, truth: any[]) => {
    const key = `learn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const run = (t: string, language: "es" | "en", history: any[]) => chatWithElvi({ transcript: t.slice(0, 1000), language, menu, history, resolverMenu, sessionKey: key } as any, { apiKey: tenant.xai.apiKey, baseUrl: tenant.xai.baseUrl, model: tenant.xai.model } as any);
    const r: any = await shadowOrderFromTurns((row.turns || []).map((t: any) => ({ ...t })), run as any);
    const lines = elviLines(r.cart || [], resolverMenu as any);
    return { score: scoreOrder(lines, truth).score, lines: lines.map((l: any) => `${l.quantity}× ${l.name} [${l.choices.join("; ")}]`) };
  };
  return { replay, resolverMenu };
}

async function nightly() {
  const { phone, data } = await build();
  const rows = new Map((data.calls || []).map((r: any) => [L.ref(r.callSid), r]));
  const { replay, resolverMenu } = await replayer();
  const { splitDishClauses } = await import("../src/elvi.ts");
  const { pinnedMenu } = await import("../src/site-catalog.ts");
  // 1) self-eval with the approved memory
  const evals: any[] = [];
  for (const e of phone) { const row = rows.get(e.ref); try { const r = await replay(row, e.truthLines); evals.push({ ref: e.ref, score: r.score }); } catch { evals.push({ ref: e.ref, score: null }); } }
  const ok = evals.filter((x) => x.score != null);
  const mean = ok.length ? Math.round((ok.reduce((a, x) => a + x.score, 0) / ok.length) * 10) / 10 : null;
  fs.appendFileSync(path.join(dir, "nightly.jsonl"), JSON.stringify({ at: new Date().toISOString(), examples: phone.length, replayed: ok.length, elviReplayAccuracy: mean, memoryEntries: K.loadMemory().length, perExample: evals }) + "\n");
  // 2) self-retry: each miss → candidate memory entries from the customer-truth, retried up to N attempts
  const approved = K.loadMemory(); const queue = K.readPending();
  const clausesOf = (e: any) => e.turns.filter((t: any) => t.speaker === "caller").flatMap((t: any) => { const s = splitDishClauses(t.text); return s.length ? s : K.dishOf(t.text) ? [t.text] : []; });
  for (const e of phone) {
    const before = evals.find((x) => x.ref === e.ref)?.score; if (before == null || before >= 100) continue;
    const row = rows.get(e.ref);
    for (const c of clausesOf(e)) {
      const items = pinnedMenu(c, resolverMenu); const dbg = (w: string) => process.env.LEARN_DEBUG && console.error(e.ref, w, c.slice(0, 60)); if (items.length !== 1) { dbg(`items ${items.length}`); continue; }
      const item: any = items[0]; const dish = K.dishOf(c);
      const gt = e.truthLines.filter((l: any) => K.dishOf(l.baseName || l.name) === dish); if (gt.length !== 1) { dbg(`gt ${gt.length}`); continue; } // ambiguous → no candidate
      const opts = new Set((item.modifierGroups || []).flatMap((g: any) => (g.options || []).map((o: any) => typeof o === "string" ? o : o.name)));
      const choices = gt[0].choices.filter((x: string) => opts.has(x)); if (!choices.length) { dbg(`choices ${gt[0].choices}`); continue; }
      const attempts: any[] = []; let win: any = null;
      const shapes: Array<[string, string[], number | null]> = [["clause", K.clauseKey(c, resolverMenu), null], ["alias", K.clauseKey(c, resolverMenu, true), null], ["clause", K.clauseKey(c, resolverMenu), gt[0].quantity]];
      for (let n = 0; n < Math.min(MAX_ATTEMPTS, shapes.length); n++) {
        const [kind, key, q] = shapes[n]; if (!key.length) { attempts.push({ n: n + 1, key, score: null, note: "empty key" }); continue; }
        const id = `cm-${dish}-${key.join("-")}-${q ?? "q"}`.slice(0, 80);
        if (queue.some((x) => x.id === id) || approved.some((x) => x.id === id)) { attempts.push({ n: n + 1, key, score: null, note: "already queued/approved" }); break; }
        const cand: any = { id, dish, key, phrase: c, item: item.name, choices, quantity: q, kind, source: e.ref };
        K.setMemoryOverride([...approved, cand]);
        let r: any = null; try { r = await replay(row, e.truthLines); } catch { /* replay failed */ }
        K.setMemoryOverride(null);
        attempts.push({ n: n + 1, key, score: r?.score ?? null, note: kind });
        if (r && r.score > before) { win = { cand, r }; if (r.score >= 100) break; }
      }
      if (!win) { dbg(`no win ${JSON.stringify(attempts.map((a) => a.score))} before ${before}`); continue; }
      // generalization: other calls with the same dish clause key must agree with their customer-truth
      const sim = { checked: 0, agree: 0, disagree: 0 }; const simRefs: string[] = [];
      for (const o of phone) { if (o.ref === e.ref) continue; for (const oc of clausesOf(o)) { if (K.dishOf(oc) !== dish) continue; const k = K.clauseKey(oc, resolverMenu, win.cand.kind === "alias"); if (k.join() !== win.cand.key.join()) continue; sim.checked++; simRefs.push(o.ref); const g = o.truthLines.filter((l: any) => K.dishOf(l.baseName || l.name) === dish); if (g.some((l: any) => choices.every((x: string) => l.choices.includes(x)))) sim.agree++; else sim.disagree++; } }
      const cand: any = { ...win.cand, status: "pending", callRef: e.ref, before: { score: before, lines: e.elvi }, after: { score: win.r.score, lines: win.r.lines }, attempts, similar: sim, regression: null, createdAt: new Date().toISOString() };
      if (!sim.checked) { cand.status = "rejected"; cand.reason = "auto: memorizes one call (no similar calls to generalize to)"; }
      else if (sim.disagree) { cand.status = "rejected"; cand.reason = `auto: disagrees with ${sim.disagree} similar call(s)`; }
      else {
        let suite = "pass"; try { execSync("node --import tsx --test test/replay/*.test.ts", { cwd: root, stdio: "pipe" }); } catch { suite = "fail"; }
        K.setMemoryOverride([...approved, win.cand]); const replays: any[] = [];
        for (const sr of [...new Set(simRefs)]) { const ex: any = phone.find((x: any) => x.ref === sr); const b = evals.find((x) => x.ref === sr)?.score; try { const a = await replay(rows.get(sr), ex.truthLines); replays.push({ ref: sr, before: b, after: a.score }); } catch { replays.push({ ref: sr, before: b, after: -1 }); } }
        K.setMemoryOverride(null);
        cand.regression = { suite, replays };
        if (suite !== "pass" || replays.some((x) => x.after < x.before)) { cand.status = "rejected"; cand.reason = "auto: regression"; }
      }
      queue.push(cand);
    }
  }
  K.writePending(queue);
  console.log(JSON.stringify({ examples: phone.length, elviReplayAccuracy: mean, pending: queue.filter((x) => x.status === "pending").length, rejected: queue.filter((x) => x.status === "rejected").length }));
}

if (cmd === "build") { const b = await build(); console.log(JSON.stringify({ phone: b.phone.length, app: b.app.length })); }
else if (cmd === "nightly") await nightly();
else console.log("usage: build | nightly | list | approve <id> | reject <id> [reason]");
process.exit(0);
