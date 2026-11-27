// search1: OFFLINE coverage check for the Square-ticket search. READ-ONLY, local files only (never Square, never the Mac).
//   bun scripts/ticket-search-offline.ts <accuracy.json from GET /api/calls/accuracy> <orders.jsonl> [square-links.json] [out.json]
// accuracy.json = the calls page payload (rows: elvi lines, names, readback); orders.jsonl = Square orders for the same days.
import fs from "node:fs";
import { assignTickets, MATCH_AFTER_END_MS } from "../src/call-accuracy.ts";
import { searchTickets, nameSimilarity, itemMatch, type SearchCall } from "../src/ticket-search.ts";

const [accFile, ordersFile, linksFile, outFile] = process.argv.slice(2);
const acc = JSON.parse(fs.readFileSync(accFile, "utf8"));
const orders = fs.readFileSync(ordersFile, "utf8").split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));
const links: Record<string, { orderId: string }> = linksFile && fs.existsSync(linksFile) ? JSON.parse(fs.readFileSync(linksFile, "utf8")) : {};
const rows: any[] = acc.calls;
const eligible = (r: any) => r.source !== "training" && r.recordingSid && r.answered !== false && !r.followUp && (r.turns || []).length;
const elig = rows.filter(eligible);
const withOrder = elig.filter((r) => !r.noOrder);
const said = (r: any) => (r.turns || []).map((t: any) => t.text).join(" ");
const names = (r: any) => [r.orderName, r.customerName, r.nameCheck?.heard].filter(Boolean);

// before: what the live page shows (capped at 1000 orders)
const liveHas = new Set(rows.filter((r) => r.ticket && r.ticket.id !== "manual").map((r) => r.callSid));
// cap fix only: same matcher, every order in range
const prepared = rows.filter((r) => r.recordingSid && !r.followUp).map((r) => ({ call: { callSid: r.callSid, at: r.at, caller: r.caller, talkSec: r.talkSec, recordingSec: r.recordingSec, recordingSid: r.recordingSid, turns: r.turns, customerName: r.customerName } as any, elvi: r.elvi }));
const assigned = assignTickets(prepared, orders);
const directByOrder = new Map<string, string>(); for (const [sid, m] of assigned) directByOrder.set(String(m.order.id), sid);
const searchItems = elig.filter((r) => !assigned.has(r.callSid)).map((r) => ({ call: { callSid: r.callSid, at: r.at, caller: r.caller, talkSec: r.talkSec, recordingSec: r.recordingSec, names: names(r), readbackText: r.readback?.staffText || null, transcriptText: said(r), callerText: (r.turns || []).filter((t: any) => t.speaker === "caller").map((t: any) => t.text).join(" "), liveLinkOrderId: links[r.callSid]?.orderId || null, liveLinkBy: (links[r.callSid] as any)?.matchedBy || null } as SearchCall, elvi: r.elvi }));
const search = searchTickets(searchItems, orders, directByOrder);

// root causes for every order call the live page shows without a ticket
const bucket = (r: any): string => {
  const m = assigned.get(r.callSid);
  if (m) return "A. orders cut off: page fetches max 1000 Square orders (oldest first) for 30 days";
  const s = search.get(r.callSid)!; const b = s.best;
  if (!b) return s.searched ? "F. no ticket fits (no phone/name/items) — likely nothing rung for this call" : "G. no POS ticket at all within −10/+90 min";
  const end = Date.parse(r.at) + (r.recordingSec || r.talkSec || 0) * 1000, t = Date.parse(b.createdAt);
  if (b.usedBy?.length && [...directByOrder.keys()].includes(b.orderId)) return "E. best ticket already linked to another call (one ticket ↔ one call; calls rung together)";
  if (t > end + MATCH_AFTER_END_MS) return "B. rung after the 10-min window (staff ring late)";
  if (t < Date.parse(r.at)) return "B2. rung before the call started";
  const nm = b.signals.find((x) => x.kind === "name");
  if (nm && nm.value < 1) return "C. name typo / spelling variant on the ticket";
  return "D. items don't reach 50%/details (Elvi missed or staff rang differently)";
};
const causes: Record<string, number> = {}; const ex: Record<string, string[]> = {};
for (const r of withOrder.filter((r) => !liveHas.has(r.callSid))) { const k = bucket(r); causes[k] = (causes[k] || 0) + 1; (ex[k] ||= []).push(r.callSid); }
const causesNoOrder: Record<string, number> = {};
for (const r of elig.filter((r) => r.noOrder && !liveHas.has(r.callSid))) { const s = search.get(r.callSid); const k = !s ? "linked" : s.best ? `searched ${s.status}` : s.runnerUps.length ? "closest only" : "no ticket in window"; causesNoOrder[k] = (causesNoOrder[k] || 0) + 1; }

const cov = (set: any[], has: (r: any) => boolean) => `${set.filter(has).length}/${set.length} (${Math.round(set.filter(has).length / set.length * 1000) / 10}%)`;
const report = {
  callsInPayload: rows.length, ordersOffline: orders.length, liveOrdersSearched: acc.ordersSearched,
  orderCalls: withOrder.length, noOrderCalls: elig.length - withOrder.length,
  before_live: cov(withOrder, (r) => liveHas.has(r.callSid)),
  after_capFix_directOnly: cov(withOrder, (r) => assigned.has(r.callSid)),
  after_search_found: cov(withOrder, (r) => assigned.has(r.callSid) || search.get(r.callSid)?.status === "found"),
  after_search_found_or_weak: cov(withOrder, (r) => assigned.has(r.callSid) || !!search.get(r.callSid)?.best),
  after_search_something_shown: cov(withOrder, (r) => assigned.has(r.callSid) || !!search.get(r.callSid)?.best || !!search.get(r.callSid)?.runnerUps.length),
  noOrderCalls_search: causesNoOrder,
  rootCauses_liveNoTicket: causes,
};
console.log(JSON.stringify(report, null, 2));
if (outFile) fs.writeFileSync(outFile, JSON.stringify({ report, examples: ex, search: Object.fromEntries([...search].map(([k, v]) => [k, { ...v, best: v.best && { ...v.best, lines: v.best.lines.map((l) => `${l.quantity}x ${l.name} [${(l.choices || []).join(", ")}]`) }, runnerUps: v.runnerUps.map((c) => ({ ...c, lines: c.lines.map((l) => `${l.quantity}x ${l.name}`) })) }])) }, null, 1));

// self-check: hide the direct link on calls the matcher DID link (name + items + time) and see if the search finds the same ticket
const known = withOrder.filter((r) => /name/.test(assigned.get(r.callSid)?.by || "") && /items/.test(assigned.get(r.callSid)?.by || ""));
let agree = 0, agreeFound = 0, found = 0; const dis: string[] = [];
for (const r of known) {
  const truth = String(assigned.get(r.callSid)!.order.id);
  const others = new Map([...directByOrder].filter(([, sid]) => sid !== r.callSid));
  const s = searchTickets([{ call: { callSid: r.callSid, at: r.at, caller: r.caller, talkSec: r.talkSec, recordingSec: r.recordingSec, names: names(r), readbackText: r.readback?.staffText || null, transcriptText: said(r), callerText: (r.turns || []).filter((t: any) => t.speaker === "caller").map((t: any) => t.text).join(" "), liveLinkOrderId: links[r.callSid]?.orderId || null, liveLinkBy: (links[r.callSid] as any)?.matchedBy || null }, elvi: r.elvi }], orders, others).get(r.callSid)!;
  if (s.best?.orderId === truth) agree++; else dis.push(r.callSid);
  if (s.status === "found") { found++; if (s.best?.orderId === truth) agreeFound++; }
}
console.log(JSON.stringify({ selfCheck_nameItemsLinked: known.length, searchPicksSameTicket: agree, found, foundAndSame: agreeFound, disagree: dis.slice(0, 10) }));
{ // harder: every direct link, and again with the heard name removed (items/readback/time only)
  for (const noName of [false, true]) {
    let n = 0, same = 0, foundSame = 0, foundWrong = 0; const band: Record<string, [number, number]> = {};
    for (const r of withOrder.filter((r) => assigned.has(r.callSid))) {
      n++; const truth = String(assigned.get(r.callSid)!.order.id); const others = new Map([...directByOrder].filter(([, sid]) => sid !== r.callSid));
      const s = searchTickets([{ call: { callSid: r.callSid, at: r.at, caller: r.caller, talkSec: r.talkSec, recordingSec: r.recordingSec, names: noName ? [] : names(r), readbackText: r.readback?.staffText || null, transcriptText: said(r), callerText: (r.turns || []).filter((t: any) => t.speaker === "caller").map((t: any) => t.text).join(" "), liveLinkOrderId: noName ? null : links[r.callSid]?.orderId || null, liveLinkBy: (links[r.callSid] as any)?.matchedBy || null }, elvi: r.elvi }], orders, others).get(r.callSid)!;
      if (s.best?.orderId === truth) same++;
      if (s.best) { const k = s.best.confidence >= 80 ? "80+" : s.best.confidence >= 60 ? "60-79" : s.best.confidence >= 40 ? "40-59" : "<40"; band[k] ||= [0, 0]; band[k][1]++; if (s.best.orderId === truth) band[k][0]++; } else { band.none ||= [0, 0]; band.none[1]++; }
      if (s.status === "found") { if (s.best?.orderId === truth) foundSame++; else foundWrong++; }
    }
    console.log(JSON.stringify({ allDirect: n, namesHidden: noName, same, foundSame, foundWrong, correctByConfidenceBand: band }));
  }
}
