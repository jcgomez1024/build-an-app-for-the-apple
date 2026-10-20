// delivery1: READ-ONLY. How Square tickets mark delivery (fulfillment type vs typed in notes). Prints counts only — no addresses.
//   npx tsx scripts/delivery-square-stats.ts [days=30]
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
const { searchOrdersReadOnly } = await import("../src/square.ts");
const { ticketFulfillment } = await import("../src/delivery.ts");
const days = Number(process.argv[2]) || 30;
const orders: any[] = await searchOrdersReadOnly(new Date(Date.now() - days * 86400000).toISOString(), new Date().toISOString());
const types: Record<string, number> = {}, ours: Record<string, number> = {}, bySource: Record<string, number> = {};
let notesOnly = 0, withStructured = 0;
for (const o of orders) {
  for (const f of o.fulfillments || []) types[f.type] = (types[f.type] || 0) + 1;
  const tf = ticketFulfillment(o);
  ours[tf.fulfillment] = (ours[tf.fulfillment] || 0) + 1;
  if (tf.fulfillment !== "DELIVERY") continue;
  const src = o.source?.name || "(none)"; bySource[src] = (bySource[src] || 0) + 1;
  const typed = (o.fulfillments || []).some((f: any) => f.type === "DELIVERY");
  if (!typed) notesOnly++;
  if ((o.fulfillments || []).some((f: any) => f.delivery_details?.recipient?.address?.address_line_1)) withStructured++;
}
console.log(JSON.stringify({ days, orders: orders.length, fulfillmentTypes: types, classified: ours, deliveryBySource: bySource, deliveryOnlyInNotes: notesOnly, deliveryWithStructuredAddress: withStructured }));
process.exit(0);
