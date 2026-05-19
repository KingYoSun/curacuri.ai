import { describe, expect, it } from "vitest";

import { getHarnessHealth } from "../../src/harness/health.js";

describe("getHarnessHealth", () => {
  it("reports healthy when at least one check is registered", () => {
    expect(getHarnessHealth(["typecheck"])).toEqual({
      ok: true,
      checks: ["typecheck"],
    });
  });

  it("reports unhealthy when no checks are registered", () => {
    expect(getHarnessHealth([])).toEqual({
      ok: false,
      checks: [],
    });
  });
});
