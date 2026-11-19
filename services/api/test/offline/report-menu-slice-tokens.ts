// Token sizes for the counted-suite caller lines. Approximation: UTF-8 bytes / 4, not a BPE tokenizer.
import { readFileSync } from "node:fs";
import { approxTokens, fullCatalogPrompt, promptCatalog, sliceMenu } from "../../src/menu-slice.ts";
import { frozenPhoneMenu } from "../../src/phone-menu.ts";

const source = readFileSync(new URL("./run-counted-cases.ts", import.meta.url), "utf8");
const utterances = [...source.matchAll(/text:\s*"([^"]+)"/g)].map((match) => match[1]);
const menu = frozenPhoneMenu();
const before = approxTokens(fullCatalogPrompt(menu));
const rows = utterances.map((utterance) => {
  const slice = sliceMenu({ menu, utterance });
  const after = approxTokens(promptCatalog(slice));
  return { utterance, before, after, saved: before - after, mode: slice.matched.length ? "matched" : "names-only", items: slice.matched.length || slice.fallbackNames.length };
});
const mean = (values: number[]) => Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
rows.sort((a, b) => a.after - b.after);
const report = {
  tokenizer: "UTF-8 bytes / 4. Not a BPE tokenizer.",
  turns: rows.length,
  fullCatalogTokens: before,
  slicedMeanTokens: mean(rows.map((row) => row.after)),
  slicedMinTokens: rows[0]?.after ?? 0,
  slicedMaxTokens: rows[rows.length - 1]?.after ?? 0,
  fewShotCapUsedForMeasurement: null,
  sample: rows.filter((_, index) => index % Math.ceil(rows.length / 8) === 0).slice(0, 8),
};
console.log(JSON.stringify(report, null, 2));
