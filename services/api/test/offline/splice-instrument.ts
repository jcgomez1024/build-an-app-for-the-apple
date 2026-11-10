// Diagnostic instrumentation only. This does not decide orders.
// A wrapper that forwards an omitted splice deleteCount as undefined deletes nothing.
// Native splice(start) deletes through the end. Empty removal logs from the broken
// wrapper are not evidence that the cart stayed still.
const native = Array.prototype.splice;

function brokenForward(list: unknown[], start: number, deleteCount?: number, ...items: unknown[]) {
  return native.call(list, start, deleteCount, ...items);
}

function correctedSplice(list: unknown[], start: number, deleteCount?: number, ...items: unknown[]) {
  const omitted = arguments.length < 3;
  return omitted ? native.call(list, start) : native.call(list, start, deleteCount as number, ...items);
}

function same(left: unknown[], right: unknown[]) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

const nativeList = ["a", "b", "c", "d"];
const nativeRemoved = nativeList.splice(2);
const brokenList = ["a", "b", "c", "d"];
const brokenRemoved = brokenForward(brokenList, 2);
const fixedList = ["a", "b", "c", "d"];
const fixedRemoved = correctedSplice(fixedList, 2);
const explicit = ["a", "b", "c", "d"];
const explicitRemoved = correctedSplice(explicit, 1, 1, "x");

const checks = [
  { id: "native-omitted-deletes-tail", ok: same(nativeList, ["a", "b"]) && same(nativeRemoved, ["c", "d"]) },
  { id: "broken-forward-deletes-nothing", ok: same(brokenList, ["a", "b", "c", "d"]) && brokenRemoved.length === 0 },
  { id: "corrected-matches-native", ok: same(fixedList, ["a", "b"]) && same(fixedRemoved, ["c", "d"]) },
  { id: "corrected-explicit-count", ok: same(explicit, ["a", "x", "c", "d"]) && same(explicitRemoved, ["b"]) },
];
for (const check of checks) console.log(check.ok ? "PASS" : "FAIL", check.id);
if (checks.some((check) => !check.ok)) process.exit(1);
console.log("EMPTY_SPLICE_LOGS_FROM_BROKEN_WRAPPER_ARE_NOT_CART_EVIDENCE");
