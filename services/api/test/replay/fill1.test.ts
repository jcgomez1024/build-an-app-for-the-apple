// fill1: "Meat" group with cheese/potato options is labelled Filling / Relleno (synthetic data).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const src = readFileSync(new URL("../../../../apps/web/ui1.js", import.meta.url), "utf8");
const grab = (re: RegExp) => { const m = src.match(re); assert.ok(m, `missing ${re}`); return m![0]; };
const mk = (lang: string) => { const c: any = { L: lang }; vm.createContext(c); vm.runInContext(`const lang = () => L; const t = (es, en) => (lang() === "es" ? es : en);\n${grab(/function cleanOpt[\s\S]*?\n}\n/)}${grab(/const isSkuOption = [^\n]*\n/)}${grab(/function groupLabel[\s\S]*?\n}\n/)}this.gl = groupLabel;`, c); return c.gl; };
const fill = { name: "(A) Enchiladas Carne Options (ONLINE)", options: [{ name: "Queso / Cheese" }, { name: "Papas / Potatoes" }, { name: "Pollo / Chicken" }] };
const meat = { name: "Carne / Meat", options: [{ name: "Pollo / Chicken" }, { name: "Bistec / Steak" }] };
test("fill1: EN 'Filling (Relleno)', ES 'Relleno' when cheese/potato offered", () => { assert.equal(mk("en")(fill), "Filling (Relleno)"); assert.equal(mk("es")(fill), "Relleno"); });
test("fill1: meat-only groups stay Meat / Carne", () => { assert.equal(mk("en")(meat), "Meat"); assert.equal(mk("es")(meat), "Carne"); });
