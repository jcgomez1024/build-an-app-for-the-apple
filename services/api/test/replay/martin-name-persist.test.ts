// martin-pozole1 name: the repeated "de" correction is caller-sourced, so the listen-only
// save (shouldPersistOrderName + rememberHeardNameIfNone) can store it when this number
// has no name yet. An existing saved name is not replaced. A bare staff "Martín" is not saved.
// The store is a temp file. No production callers.json is opened.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "martin-name-"));
process.env.ELVI_CALLERS_FILE = path.join(dir, "callers.json");
const mem = await import("../../src/caller-memory.ts");
const on = await import("../../src/order-name.ts");

const d = JSON.parse(readFileSync(new URL("../fixtures/CA0655b2-martin-pozole1.json", import.meta.url), "utf8"));
const correction = d.turns.filter((t: { text: string }) => t.text !== "Martín." && t.text !== "Sí.");
const EMPTY = "2165550198";
const HAS_LUIS = "2165550199";

function listenOnlySave(phone: string, turns: Array<{ speaker: "caller" | "staff"; text: string }>, hasOrder: boolean) {
  const info = on.nameFromTranscriptInfo(turns);
  const heard0 = info?.name && !on.isNumberName(info.name) && !on.deniedVocative(turns, info.name) && !on.isFoodNameBlocked(info.name, info.source, turns) ? info.name : null;
  const known = mem.savedCallerName(phone);
  const heard = on.snapToKnownName(heard0, [known?.name], turns);
  if (!heard || !info) return { heard: heard || null, source: info?.source || null, saved: false, reason: "no-name" };
  if (info.thirdPerson || (info.group?.length || 0) >= 2) return { heard, source: info.source, saved: false, reason: "not-caller" };
  if (!on.shouldPersistOrderName(hasOrder, info.source, turns, heard)) return { heard, source: info.source, saved: false, reason: "not-eligible" };
  const saved = on.rememberHeardNameIfNone(phone, heard);
  return { heard, source: info.source, saved, reason: saved ? "saved" : "existing-name-kept" };
}

test("martin-name: repeated de correction is caller-sourced and saves on an empty number", () => {
  assert.equal(on.callerNameCorrection(correction), "Martín");
  const r = listenOnlySave(EMPTY, correction, true);
  assert.equal(r.heard, "Martín");
  assert.equal(r.source, "volunteer");
  assert.equal(r.saved, true, r.reason);
  assert.deepEqual(mem.savedCallerName(EMPTY), { name: "Martín", source: "elvi" });
});

test("martin-name: a saved Luis is not replaced by the correction", () => {
  mem.saveCallerName(HAS_LUIS, "Luis", "elvi");
  const r = listenOnlySave(HAS_LUIS, correction, true);
  assert.equal(r.heard, "Martín");
  assert.equal(r.source, "volunteer");
  assert.equal(r.saved, false);
  assert.equal(r.reason, "existing-name-kept");
  assert.deepEqual(mem.savedCallerName(HAS_LUIS), { name: "Luis", source: "elvi" });
});

test("martin-name: yes to Luis stays Luis", () => {
  const turns = [
    { speaker: "caller" as const, text: "Me puede poner tres pozoles." },
    { speaker: "staff" as const, text: "Al nombre de Luis, ¿verdad?" },
    { speaker: "caller" as const, text: "Sí." },
  ];
  const fresh = "2165550197";
  const r = listenOnlySave(fresh, turns, true);
  assert.equal(r.heard, "Luis");
  assert.notEqual(r.source, "volunteer");
  assert.equal(r.saved, true);
  assert.equal(mem.savedCallerName(fresh)?.name, "Luis");
  const again = listenOnlySave(HAS_LUIS, turns, true);
  assert.equal(again.heard, "Luis");
  assert.equal(again.saved, false);
  assert.equal(mem.savedCallerName(HAS_LUIS)?.name, "Luis");
});

test("martin-name: a bare staff Martín does not overwrite", () => {
  const turns = [
    { speaker: "caller" as const, text: "Me puede poner tres pozoles." },
    { speaker: "staff" as const, text: "Martín." },
  ];
  const before = mem.savedCallerName(HAS_LUIS);
  const r = listenOnlySave(HAS_LUIS, turns, true);
  assert.equal(r.heard, null);
  assert.equal(r.saved, false);
  assert.deepEqual(mem.savedCallerName(HAS_LUIS), before);
  const bare = "2165550196";
  assert.equal(listenOnlySave(bare, turns, true).saved, false);
  assert.equal(mem.savedCallerName(bare), null);
  assert.equal(on.rememberHeardNameIfNone(HAS_LUIS, "Martín"), false);
  assert.equal(mem.savedCallerName(HAS_LUIS)?.name, "Luis");
});
