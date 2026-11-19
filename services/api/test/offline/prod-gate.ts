process.env.NODE_ENV = "production";
process.env.ELVI_FROZEN_PHONE_MENU = "1";
process.env.ELVI_RECONCILE_TRACE = process.argv[2] || "/tmp/elvi-prod-trace-must-not-exist.jsonl";
const scoring = await import("../../src/call-scoring.ts");
const order: any = await scoring.shadowOrderFromTurns(
  [{ speaker: "caller", text: "Una coca.", language: "es", start: 0, end: 1 }],
  (async () => ({ actions: [], reply: "" })) as any,
);
console.log(JSON.stringify({ reviewReason: order.reviewReason || null, lines: (order.cart || []).length }));
