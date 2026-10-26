// time1 (Carlos 10/22): order timing — ASAP or a scheduled 15-min slot, for pickup and delivery, open or closed.
// Pickup: the slot is the READY time (≥ now/opening + prep, ≤ close). Delivery: the slot is the ARRIVAL center
// (ready + drive), shown as a ±pad window; kitchen-ready must be ≤ close. Same rules on the client and the server.
import { loadSiteCatalog, currentTime, itemAvailability } from "./site-catalog.js";
import { zoned, toMin, fmt, openWindow, DAY_ES, DAY_EN } from "./menu-v3.js"; // m40: full day names from menu-v3
export type Fulfillment = "PICKUP" | "DELIVERY";
export const timingConfig = (catalog = loadSiteCatalog()) => ({
  prep: Number(process.env.ELVI_PREP_MINUTES || (catalog as any)?.store?.prepMinutes || 20),
  drive: Number(process.env.ELVI_DRIVE_MINUTES || 20),
  pad: Number(process.env.ELVI_ETA_PAD_MINUTES || 5),
  step: 15,
});
export type Slot = { at: string; label: { es: string; en: string }; window?: { from: string; to: string; es: string; en: string } };
export type DayOpts = { day: string; es: string; en: string; slots: Slot[] };
export type Timing = { open: boolean; asap: Slot & { readyAt: string; scheduled: boolean }; days: DayOpts[]; prep: number; drive: number; pad: number };

function mk(now: Date, tz: string) {
  const base = new Date(now); base.setUTCSeconds(0, 0); const z = zoned(base, tz);
  return { z, at: (dayOff: number, min: number) => new Date(base.getTime() + (dayOff * 1440 + min - z.minutes) * 60000) };
}
const lbl = (min: number) => ({ es: fmt(min), en: fmt(min) });
function slotFor(f: Fulfillment, dayOff: number, min: number, at: (d: number, m: number) => Date, c: ReturnType<typeof timingConfig>, dayLbl?: { es: string; en: string }): Slot {
  const pre = dayLbl ? { es: dayLbl.es + " ", en: dayLbl.en + " " } : { es: "", en: "" };
  if (f === "PICKUP") return { at: at(dayOff, min).toISOString(), label: { es: pre.es + fmt(min), en: pre.en + fmt(min) } };
  const a = min - c.pad, b = min + c.pad;
  return { at: at(dayOff, min).toISOString(), label: { es: `${pre.es}${fmt(a)}–${fmt(b)}`, en: `${pre.en}${fmt(a)}–${fmt(b)}` },
    window: { from: at(dayOff, a).toISOString(), to: at(dayOff, b).toISOString(), es: `${fmt(a)}–${fmt(b)}`, en: `${fmt(a)}–${fmt(b)}` } };
}

/** ASAP + scheduled slots for the next open days (today first when there's time left). */
export function timingOptions(f: Fulfillment, now = currentTime(), catalog = loadSiteCatalog(), nDays = 2): Timing | null {
  const store: any = catalog?.store; if (!store) return null;
  const c = timingConfig(catalog), tz = store.timezone || "America/New_York", { z, at } = mk(now, tz);
  const lead = c.prep + (f === "DELIVERY" ? c.drive : 0);
  const days: DayOpts[] = []; let open = false; let asap: Timing["asap"] | null = null;
  for (let i = 0; i <= 7 && days.length < nDays; i++) {
    const d = (z.day + i) % 7, w = openWindow(d, catalog); if (!w) continue;
    const o = toMin(w.open), cl = toMin(w.close);
    const start = i === 0 ? Math.max(z.minutes, o) : o; // kitchen can start at
    if (start + c.prep > cl) continue; // too late today (past last order)
    if (i === 0 && z.minutes >= o) open = true;
    const dl = i === 0 ? { es: "hoy", en: "today" } : { es: DAY_ES[d], en: DAY_EN[d] };
    if (!asap) { const m = start + lead; const s = slotFor(f, i, m, at, c, i === 0 ? undefined : dl);
      asap = { ...s, readyAt: at(i, start + c.prep).toISOString(), scheduled: !open }; }
    const first = Math.ceil((start + lead) / c.step) * c.step, last = cl + (f === "DELIVERY" ? c.drive : 0);
    const slots: Slot[] = []; for (let m = first; m <= last; m += c.step) slots.push(slotFor(f, i, m, at, c));
    if (slots.length) days.push({ day: at(i, o).toISOString().slice(0, 10), es: dl.es, en: dl.en, slots });
  }
  if (!asap) return null;
  return { open, asap, days, prep: c.prep, drive: c.drive, pad: c.pad };
}

export type TimingReq = { mode?: "asap" | "scheduled"; at?: string };
export type TimingCheck = { ok: true; scheduleType: "ASAP" | "SCHEDULED"; at: string; readyAt: string; window?: Slot["window"]; label: { es: string; en: string } }
  | { ok: false; error: { es: string; en: string }; unavailable?: Array<{ id: string; name: string }> };

/** Server-side: the requested time must be one we'd offer, and every item must be available at that ready time. */
export function validateTiming(f: Fulfillment, req: TimingReq | undefined, items: Array<{ id: string; name: string; squareCatalogObjectId?: string }>, now = currentTime(), catalog = loadSiteCatalog(),
  avail: (id: string | undefined, at: Date) => { available: boolean } = itemAvailability): TimingCheck {
  const t = timingOptions(f, now, catalog, 7); const c = timingConfig(catalog);
  if (!t) return { ok: false, error: { es: "No hay horario disponible.", en: "No ordering times available." } };
  let pick: Slot & { readyAt?: string }; let sched: boolean;
  if (!req?.mode || req.mode === "asap") { pick = t.asap; sched = t.asap.scheduled; }
  else {
    const want = Date.parse(String(req.at || "")); const hit = t.days.flatMap((d) => d.slots).find((s) => Math.abs(Date.parse(s.at) - want) < 60000);
    if (!hit) return { ok: false, error: { es: "Esa hora no está disponible. Escoge otra dentro del horario.", en: "That time isn't available. Pick another within our hours." } };
    pick = hit; sched = true;
  }
  const ready = pick.readyAt ? new Date(pick.readyAt) : new Date(Date.parse(pick.at) - (f === "DELIVERY" ? c.drive : 0) * 60000);
  const kitchenNow = new Date(ready.getTime() - c.prep * 60000); // itemAvailability checks now+prep
  const bad = items.filter((m) => !avail(m.squareCatalogObjectId, kitchenNow).available).map((m) => ({ id: m.id, name: m.name }));
  if (bad.length) return { ok: false, unavailable: bad, error: { es: `No disponible a esa hora: ${bad.map((b) => b.name).join(", ")}.`, en: `Not available at that time: ${bad.map((b) => b.name).join(", ")}.` } };
  return { ok: true, scheduleType: sched ? "SCHEDULED" : "ASAP", at: pick.at, readyAt: ready.toISOString(), window: pick.window, label: pick.label };
}
