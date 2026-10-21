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
  const staffGrades: Record<string, string | null> = {}; // staffgrade1
  const grades: Record<string, string> = {}; // grade1: CallSid → grade (for calls.html badges)
  const phone = (data.calls || []).filter((r: any) => r.source !== "training").map((r: any) => { const e = L.phoneExample(r); if (e?.grade) grades[r.callSid] = e.grade; if (e) staffGrades[r.callSid] = e.staffGrade ?? null; return e; }).filter(Boolean);
  fs.writeFileSync(path.join(dir, "grades.json"), JSON.stringify(grades, null, 1));
  fs.writeFileSync(path.join(dir, "staff-grades.json"), JSON.stringify(staffGrades, null, 1));
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
  const readbacks = L.readbackStats(phone as any); // readback1
  fs.writeFileSync(path.join(dir, "readback-phrases.json"), JSON.stringify(L.readbackPhrases((data.calls || []).filter((r: any) => r.source !== "training")), null, 1));
  const wk = acc.length ? acc[acc.length - 1].week : "";
  J("report.json", { generatedAt: new Date().toISOString(), readbacks, grades: L.gradeStats(phone as any), staffGrades: L.staffGradeByDevice(phone as any), gradeWeights: L.gradeWeights(), examples: { phone: phone.length, app: app.length, appPaid: app.filter((a) => a.weight === 1).length, staffCorrected: phone.filter((p: any) => p.corrected.length).length },
    // live1: same definition as calls.html / Comparar — against the correct order, clear calls only
    elviScoreDefinition: "Elvi hoy = median of 3 fresh replays with current code (scripts/learning.ts replay3) vs correct order; Elvi en la llamada = first processing that day",
    replay3: (() => { try { const r = JSON.parse(fs.readFileSync(path.join(dir, "replay3.json"), "utf8")); return { at: r.at, runs: r.runs, customers: r.customers, training: r.training }; } catch { return null; } })(),
    elviLiveVsToday: (() => { const cs = (data.calls || []).filter((r: any) => r.compare && !r.unclear && r.source !== "training" && r.compare.elviScore != null);
      const av = (a: number[]) => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length * 10) / 10 : null;
      return { calls: cs.length, live: av(cs.map((r: any) => r.compare.elviLiveScore)), today: av(cs.map((r: any) => r.compare.elviScore)), staff: av(cs.map((r: any) => r.compare.staffScore).filter((x: any) => x != null)) }; })(),
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
  const { loadPosCatalog, toPosLines } = await import("../src/pos-catalog.ts"); const { withIncludedToppings } = await import("../src/standard-toppings.ts");
  const { deliveryFeeLine } = await import("../src/call-accuracy.ts"); const posCat = await loadPosCatalog(cfg);
  // a3: deterministic replays — each turn's result is cached by (code version, text after slang, memory hit, history).
  // Same code + same memory → same answer every night; a candidate only changes the turns it touches (and those after).
  const { createHash } = await import("node:crypto");
  const head = (() => { try { return execSync("git rev-parse HEAD", { cwd: root }).toString().trim(); } catch { return "nogit"; } })();
  const cf = path.join(dir, "replay-cache.json"); let cache: Record<string, any> = {}; try { const c = JSON.parse(fs.readFileSync(cf, "utf8")); if (c.head === head) cache = c.turns || {}; } catch { /* fresh */ }
  const saveCache = () => fs.writeFileSync(cf, JSON.stringify({ head, turns: cache }));
  const replay = async (row: any, truth: any[], opts: { fresh?: boolean } = {}) => {
    const key = `learn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const live = (t: string, language: "es" | "en", history: any[]) => chatWithElvi({ transcript: t.slice(0, 1000), language, menu, history, resolverMenu, sessionKey: key } as any, { apiKey: tenant.xai.apiKey, baseUrl: tenant.xai.baseUrl, model: tenant.xai.model } as any);
    const run = async (t: string, language: "es" | "en", history: any[]) => {
      const tt = K.rewriteSlang(t), hit = K.recall(tt, resolverMenu);
      const k = createHash("sha256").update(JSON.stringify([tt, language, history, hit?.map((h) => h.memoryId) || null])).digest("hex");
      if (cache[k] && !opts.fresh) return cache[k]; // replay3: fresh = real AI answers, no cache
      const r: any = await live(t, language, history); const { audioBase64, audioMimeType, ...keep } = r || {}; cache[k] = keep; return keep;
    };
    const r: any = await shadowOrderFromTurns((row.turns || []).map((t: any) => ({ ...t })), run as any);
    // a2: score exactly like /api/calls/accuracy — POS names, delivery fee line, included toppings (was: menu names → 40 on a perfect order)
    const lines: any[] = toPosLines(elviLines(r.cart || [], resolverMenu as any), posCat);
    if (r.fulfillment === "DELIVERY" && lines.length) lines.push(deliveryFeeLine(row.deliveryFeeCents ?? r.deliveryFeeCents));
    return { score: scoreOrder(lines.map(withIncludedToppings), truth.map(withIncludedToppings)).score, lines: lines.map((l: any) => `${l.quantity}× ${l.name} [${l.choices.join("; ")}]`), raw: r };
  };
  return { replay, resolverMenu, saveCache, tenant };
}

async function nightly() {
  const { phone, data } = await build();
  const rows = new Map((data.calls || []).map((r: any) => [L.ref(r.callSid), r]));
  const { replay, resolverMenu, saveCache, tenant } = await replayer();
  const { splitDishClauses } = await import("../src/elvi.ts");
  const { pinnedMenu } = await import("../src/site-catalog.ts");
  // 1) self-eval with the approved memory
  const evals: any[] = [];
  for (const e of phone) { const row = rows.get(e.ref); try { const r = await replay(row, e.truthLines); evals.push({ ref: e.ref, score: r.score }); } catch { evals.push({ ref: e.ref, score: null }); } }
  // unclear1: messy calls (relayed orders, crosstalk) are replayed and trained on, but reported as their own number
  const messy = new Set(phone.filter((e: any) => e.difficulty === "messy").map((e: any) => e.ref));
  // readback1: confirmed read-backs weigh more (example weight 1.5)
  const wOf = (x: any) => Number(phone.find((e: any) => e.ref === x.ref)?.weight) || 1;
  const avg = (xs: any[]) => { const W = xs.reduce((a, x) => a + wOf(x), 0); return xs.length ? Math.round((xs.reduce((a, x) => a + x.score * wOf(x), 0) / W) * 10) / 10 : null; };
  const ok = evals.filter((x) => x.score != null && !messy.has(x.ref)), okMessy = evals.filter((x) => x.score != null && messy.has(x.ref));
  const mean = avg(ok), messyMean = avg(okMessy);
  // train1: training calls (staff test calls) are replayed too — tracked as their own number, never in customer accuracy,
  // and guarded: a candidate may not regress them, and a drop vs the last nightly is listed as a regression
  const trainEx: any[] = (data.calls || []).filter((r: any) => r.source === "training").map((r: any) => { try { return L.phoneExample(r); } catch { return null; } }).filter(Boolean);
  for (const e of trainEx) rows.set(e.ref, (data.calls || []).find((r: any) => L.ref(r.callSid) === e.ref));
  const trainEvals: any[] = [];
  for (const e of trainEx) { try { const r = await replay(rows.get(e.ref), e.truthLines); trainEvals.push({ ref: e.ref, score: r.score }); } catch { trainEvals.push({ ref: e.ref, score: null }); } }
  const trainRefs = new Set(trainEx.map((e: any) => e.ref));
  const tAvg = (xs: any[]) => { const v = xs.filter((x) => x.score != null); return v.length ? Math.round(v.reduce((a, x) => a + x.score, 0) / v.length * 10) / 10 : null; };
  const prevNight = (() => { try { const ls = fs.readFileSync(path.join(dir, "nightly.jsonl"), "utf8").trim().split("\n"); return JSON.parse(ls[ls.length - 1]); } catch { return null; } })();
  const trainingRegressions = trainEvals.filter((x) => { const b = prevNight?.training?.perExample?.find((p: any) => p.ref === x.ref)?.score; return b != null && x.score != null && x.score < b; })
    .map((x) => ({ ref: x.ref, before: prevNight.training.perExample.find((p: any) => p.ref === x.ref).score, after: x.score }));
  const gradeOf = (ref: string) => (phone.find((e: any) => e.ref === ref) as any)?.grade || "medium";
  const perGrade: Record<string, any> = {}; for (const g of ["best", "good", "medium", "bad"]) { const xs = evals.filter((x) => x.score != null && gradeOf(x.ref) === g); perGrade[g] = { replayed: xs.length, elviReplayAccuracy: avg(xs) }; }
  fs.appendFileSync(path.join(dir, "nightly.jsonl"), JSON.stringify({ at: new Date().toISOString(), examples: phone.length, replayed: ok.length, elviReplayAccuracy: mean, messy: { replayed: okMessy.length, elviReplayAccuracy: messyMean }, training: { replayed: trainEvals.filter((x) => x.score != null).length, elviReplayAccuracy: tAvg(trainEvals), regressions: trainingRegressions, perExample: trainEvals }, perGrade, memoryEntries: K.loadMemory().length, perExample: evals }) + "\n");
  // 2) self-retry: each miss → candidate memory entries from the customer-truth, retried up to N attempts
  const approved = K.loadMemory(); const queue = K.readPending();
  /** unclear1 gates (after the normal ones): every messy call is replayed too and may not regress; a candidate that comes
   *  from a messy call must also help or not hurt at least one CLEAR call (messy truth alone is not enough). */
  const messyGate = async (cand: any, mem: any, replays: any[]) => {
    if (cand.status === "rejected") return;
    K.setMemoryOverride([...approved, mem]);
    const guard = new Set([...messy, ...trainRefs, ...phone.filter((e: any) => e.grade === "best" || e.grade === "good").map((e: any) => e.ref)]); // grade1 + train1
    for (const ref of guard) { if (ref === cand.callRef || replays.some((x: any) => x.ref === ref)) continue; const ex: any = phone.find((x: any) => x.ref === ref) || trainEx.find((x: any) => x.ref === ref); const b = (evals.find((x) => x.ref === ref) || trainEvals.find((x) => x.ref === ref))?.score; try { const a = await replay(rows.get(ref), ex.truthLines); replays.push({ ref, before: b, after: a.score, messy: messy.has(ref), grade: gradeOf(ref) }); } catch { replays.push({ ref, before: b, after: -1, messy: messy.has(ref), grade: gradeOf(ref) }); } }
    K.setMemoryOverride(null);
    for (const x of replays) x.grade = x.grade || gradeOf(x.ref);
    if (replays.some((x: any) => (x.grade === "best" || x.grade === "good") && x.before != null && x.after < x.before)) { cand.status = "rejected"; cand.reason = "auto: regresses a best/good call"; return; }
    if (replays.some((x: any) => x.messy && x.before != null && x.after < x.before)) { cand.status = "rejected"; cand.reason = "auto: regresses a messy call"; return; }
    if (replays.some((x: any) => trainRefs.has(x.ref) && x.before != null && x.after < x.before)) { cand.status = "rejected"; cand.reason = "auto: regresses a training call"; return; } // train1
    if (messy.has(cand.callRef) && !replays.some((x: any) => !messy.has(x.ref) && x.before != null && x.after >= x.before)) { cand.status = "rejected"; cand.reason = "auto: based only on a messy call (no clear call helped or held)"; }
  };
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
        for (const x of replays) if (messy.has(x.ref)) x.messy = true;
        await messyGate(cand, win.cand, replays);
      }
      queue.push(cand);
    }
  }
  // a1: LLM-proposed slang / alias mappings and clause hints, per missed call, up to N attempts; same gates.
  for (const e of phone) {
    const before = evals.find((x) => x.ref === e.ref)?.score; if (before == null || before >= 100) continue;
    const row = rows.get(e.ref); const tried: any[] = []; let win: any = null; const attempts: any[] = [];
    for (let n = 0; n < MAX_ATTEMPTS && !win; n++) {
      const p = await proposeLLM(tenant, e, resolverMenu, tried); if (!p) { attempts.push({ n: n + 1, key: [], score: null, note: "llm: no valid proposal" }); continue; }
      tried.push(p);
      const id = p.kind === "slang" ? `sl-${K.dishOf(p.to) || "x"}-${p.from}`.replace(/\s+/g, "_").slice(0, 80) : `cm-llm-${p.dish}-${p.key.join("-")}`.slice(0, 80);
      if (queue.some((x) => x.id === id) || approved.some((x) => x.id === id)) { attempts.push({ n: n + 1, key: p.key || [p.from], score: null, note: "already queued/approved" }); continue; }
      const cand: any = { id, ...p, source: e.ref + " (llm)" };
      K.setMemoryOverride([...approved, cand]); let r: any = null; try { r = await replay(row, e.truthLines); } catch { /* */ } K.setMemoryOverride(null);
      attempts.push({ n: n + 1, key: p.key || [p.from + " → " + p.to], score: r?.score ?? null, note: `llm ${p.kind}` });
      if (r && r.score > before) win = { cand, r };
    }
    if (!win) continue;
    const c = win.cand; const fold = (x: string) => String(x).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const simRefs = phone.filter((o: any) => o.ref !== e.ref && o.turns.some((t: any) => t.speaker === "caller" && (c.kind === "slang" ? fold(t.text).includes(fold(c.from)) : K.clauseKey(t.text, resolverMenu).join() === c.key.join()))).map((o: any) => o.ref);
    const cand: any = { ...c, status: "pending", callRef: e.ref, before: { score: before, lines: e.elvi }, after: { score: win.r.score, lines: win.r.lines }, attempts, similar: { checked: simRefs.length, agree: 0, disagree: 0 }, regression: null, createdAt: new Date().toISOString() };
    if (!simRefs.length) { cand.status = "rejected"; cand.reason = "auto: memorizes one call (no similar calls to generalize to)"; }
    else {
      let suite = "pass"; try { execSync("node --import tsx --test test/replay/*.test.ts", { cwd: root, stdio: "pipe" }); } catch { suite = "fail"; }
      K.setMemoryOverride([...approved, c]); const replays: any[] = [];
      for (const sr of simRefs) { const ex: any = phone.find((x: any) => x.ref === sr); const b = evals.find((x) => x.ref === sr)?.score; try { const a = await replay(rows.get(sr), ex.truthLines); replays.push({ ref: sr, before: b, after: a.score }); } catch { replays.push({ ref: sr, before: b, after: -1 }); } }
      K.setMemoryOverride(null);
      cand.similar.agree = replays.filter((x) => x.after >= x.before).length; cand.similar.disagree = replays.length - cand.similar.agree;
      cand.regression = { suite, replays };
      if (suite !== "pass" || cand.similar.disagree) { cand.status = "rejected"; cand.reason = "auto: regression"; }
      for (const x of replays) if (messy.has(x.ref)) x.messy = true;
      await messyGate(cand, c, replays);
    }
    queue.push(cand);
  }
  saveCache();
  K.writePending(queue);
  console.log(JSON.stringify({ examples: phone.length, elviReplayAccuracy: mean, messyReplayAccuracy: messyMean, trainingReplayAccuracy: tAvg(trainEvals), trainingRegressions: trainingRegressions.length, perGrade, pending: queue.filter((x) => x.status === "pending").length, rejected: queue.filter((x) => x.status === "rejected").length }));
}

/** replay3 (Carlos): "Elvi hoy" = the real result of FRESH replays with current code (no cache, no hand-picked scores).
 *  Each scored call (customers + training) is replayed N times (default 3); the median run's order is written as the call's
 *  latest processing (so calls.html / Comparar / weekly report all show it) with every run's score and a varies flag.
 *  Usage: replay3 [--runs N] [--dry] [--only CallSid,…]. Local data only; no calls/SMS. */
async function replay3() {
  const runs = Number(process.argv[process.argv.indexOf("--runs") + 1]) || 3, dry = process.argv.includes("--dry");
  const only = process.argv.includes("--only") ? new Set(String(process.argv[process.argv.indexOf("--only") + 1]).split(",")) : null;
  const res = await fetch("http://localhost:4000/api/calls/accuracy?days=90"); const data: any = await res.json();
  const { replay } = await replayer();
  const logDir = path.join(root, "data/logs/calls"); const out: any[] = [];
  for (const row of data.calls || []) {
    if (!row.compare || (only && !only.has(row.callSid))) continue;
    const truth = row.compare.truth; const rs: any[] = [];
    for (let i = 0; i < runs; i++) { try { rs.push(await replay(row, truth, { fresh: true })); } catch (e) { rs.push({ score: 0, lines: [], raw: null, error: String(e).slice(0, 120) }); } }
    const sorted = [...rs].sort((a, b) => a.score - b.score), med = sorted[Math.floor((sorted.length - 1) / 2)];
    const scores = rs.map((r) => r.score), varies = Math.min(...scores) !== Math.max(...scores);
    out.push({ callSid: row.callSid, at: row.at, source: row.source, unclear: !!row.unclear, scores, min: sorted[0].score, median: med.score, max: sorted[sorted.length - 1].score, varies, runs: rs.map((r) => r.lines) });
    if (!dry && med.raw) {
      // append to the file holding the call's latest recording event (same as rescore-call.ts)
      let rec: any = null, file = "";
      for (const f of fs.readdirSync(logDir).filter((x) => /^\d{4}-\d\d-\d\d\.jsonl$/.test(x)).sort()) for (const l of fs.readFileSync(path.join(logDir, f), "utf8").split("\n")) { if (!l.trim()) continue; let e: any; try { e = JSON.parse(l); } catch { continue; } if (e.callSid === row.callSid && e.event === "recording") { rec = e; file = f; } }
      if (rec) fs.appendFileSync(path.join(logDir, file), JSON.stringify({ ...rec, ts: new Date().toISOString(), elviOrder: med.raw, rescoredBy: "replay3", replayScores: scores, replayVaries: varies, replayHead: execSync("git rev-parse --short HEAD", { cwd: root }).toString().trim() }) + "\n");
    }
    console.error(`${row.at} ${row.source} runs=${scores.join("/")} median=${med.score}${varies ? " VARIES" : ""}`);
  }
  const cust = out.filter((x) => x.source !== "training" && !x.unclear), med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
  const avg = (xs: number[]) => xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length * 10) / 10 : null;
  const summary = { at: new Date().toISOString(), runs, customers: { calls: cust.length, avgOfMedians: avg(cust.map((x) => x.median)), avgMin: avg(cust.map((x) => x.min)), avgMax: avg(cust.map((x) => x.max)), varies: cust.filter((x) => x.varies).length },
    training: { calls: out.filter((x) => x.source === "training").length, avgOfMedians: avg(out.filter((x) => x.source === "training").map((x) => x.median)) }, calls: out };
  if (!dry) fs.writeFileSync(path.join(dir, "replay3.json"), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify({ ...summary, calls: undefined }));
  void med;
}

if (cmd === "replay3") await replay3();
else if (cmd === "build") { const b = await build(); console.log(JSON.stringify({ phone: b.phone.length, app: b.app.length })); }
else if (cmd === "nightly") await nightly();
else console.log("usage: build | nightly | list | approve <id> | reject <id> [reason]");
process.exit(0);

/** a1: ask the LLM (temperature 0) for ONE general fix — a slang/alias mapping or a clause hint — from the customer-truth. */
async function proposeLLM(tenant: any, e: any, menu: any[], tried: any[]): Promise<any | null> {
  const caller = e.turns.filter((t: any) => t.speaker === "caller").map((t: any) => t.text).join("\n");
  const vocabWords = [...K.vocab(menu)].slice(0, 400).join(", ");
  const sys = "You improve a Spanish/English restaurant order parser. Given the customer's words, what the parser rang, and the correct order, propose ONE GENERAL fix that would help other customers too (never names, never one-off numbers). " +
    "Either {\"kind\":\"slang\",\"from\":\"<1-3 words exactly as the customer said>\",\"to\":\"<menu words the parser understands>\"} or " +
    "{\"kind\":\"clause\",\"dish\":\"<taco|torta|quesadilla|...>\",\"key\":[<menu words from the clause>],\"item\":\"<menu item name>\",\"choices\":[<exact option names>]}. Reply ONLY JSON. Use only these menu words for 'to'/'key': " + vocabWords;
  const user = `Customer said:\n${caller}\n\nParser rang:\n${e.elvi.join("\n")}\n\nCorrect order:\n${e.truth.join("\n")}\n\nAlready tried (failed): ${JSON.stringify(tried)}`;
  try {
    const r = await fetch("https://api.x.ai/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${tenant.xai.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.ELVI_LEARN_MODEL || tenant.xai.model, temperature: 0, max_tokens: 200, response_format: { type: "json_object" }, messages: [{ role: "system", content: sys }, { role: "user", content: user }] }) });
    if (!r.ok) return null;
    const o = JSON.parse(String(((await r.json()) as any)?.choices?.[0]?.message?.content || "{}"));
    return validProposal(o, caller, menu);
  } catch { return null; }
}
export function validProposal(o: any, caller: string, menu: any[]): any | null {
  const fold = (x: string) => String(x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  if (o?.kind === "slang") {
    const from = fold(o.from), to = String(o.to || "").trim();
    if (!from || from.split(/\s+/).length > 3 || !fold(caller).includes(from) || !to || from === fold(to) || /<|\d{3,}/.test(from + to)) return null;
    return { kind: "slang", from, to, dish: K.dishOf(to) || "", key: [], phrase: from, item: "", choices: [], quantity: null };
  }
  if (o?.kind === "clause") {
    const item = (menu || []).find((m: any) => fold(m.name) === fold(o.item)); if (!item) return null;
    const opts = new Set((item.modifierGroups || []).flatMap((g: any) => (g.options || []).map((x: any) => (typeof x === "string" ? x : x.name))));
    const choices = (o.choices || []).filter((c: string) => opts.has(c)); const key = [...new Set((o.key || []).map((w: string) => fold(w).replace(/e?s$/, "")))].sort() as string[];
    if (!choices.length || !key.length || !key.every((w) => fold(caller).includes(w))) return null;
    return { kind: "clause", dish: K.dishOf(item.name) || fold(o.dish), key, phrase: key.join(" "), item: item.name, choices, quantity: null };
  }
  return null;
}
