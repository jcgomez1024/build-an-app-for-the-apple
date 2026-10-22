// feepick1: read-only staff check — a ticket carrying a delivery fee (catalog "Delivery Fee" line or a Delivery service
// charge) whose fulfillment isn't DELIVERY: staff forgot to switch the ticket to Delivery. Not part of any staff grade.
export const FEE_ON_PICKUP = "delivery fee on a pickup ticket";
const hasFee = (o: any) => (o?.line_items || []).some((l: any) => /^\s*delivery\s*fee\b/i.test(String(l?.name || "")))
  || (o?.service_charges || []).some((c: any) => /deliver|env[ií]o|domicilio/i.test(String(c?.name || "")));
const isDeliveryFulfillment = (o: any) => (o?.fulfillments || []).some((f: any) => f?.type === "DELIVERY" || f?.delivery_details);
export const feeOnPickup = (o: any) => o?.state !== "CANCELED" && hasFee(o) && !isDeliveryFulfillment(o);
const weekOf = (iso: string) => { const d = new Date(new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
/** Weekly counts (and per device, from the order's payment when known). No names, no order contents. */
export function feeOnPickupReport(orders: any[], payments: any[] = []) {
  const dev = new Map<string, string>(); for (const p of payments) if (p?.order_id) dev.set(String(p.order_id), String(p.device_details?.device_name || p.device_details?.device_id || "unknown").replace(/^.*['’]s\s+(iphone|ipad|android|phone)\b.*$/i, "$1 (personal)"));
  const weeks: Record<string, { count: number; devices: Record<string, number> }> = {};
  let total = 0, withFee = 0;
  for (const o of orders) { if (o?.state !== "CANCELED" && hasFee(o)) withFee++; if (!feeOnPickup(o)) continue; total++;
    const w = weekOf(o.created_at), d = dev.get(String(o.id)) || "unknown"; const W = (weeks[w] ||= { count: 0, devices: {} }); W.count++; W.devices[d] = (W.devices[d] || 0) + 1; }
  return { label: FEE_ON_PICKUP, total, ticketsWithFee: withFee, weeks: Object.entries(weeks).sort().map(([week, v]) => ({ week, ...v })) };
}
