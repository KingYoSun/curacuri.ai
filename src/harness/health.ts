export type HarnessHealth = {
  readonly ok: boolean;
  readonly checks: readonly string[];
};

export function getHarnessHealth(checks: readonly string[]): HarnessHealth {
  return {
    ok: checks.length > 0,
    checks,
  };
}
