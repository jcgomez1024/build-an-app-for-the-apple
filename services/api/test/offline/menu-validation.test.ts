import { test } from "node:test";
import assert from "node:assert/strict";
import { menuValidationReport } from "./menu-validation.ts";

const report = await menuValidationReport();

for (const check of report) {
  test(`menu-validation ${check.layer}: ${check.id}`, () => {
    assert.equal(check.ok, true, check.detail);
  });
}
