type GrantBundle = {
  moveGrantExpiresAt: Date | null;
  stakingGrantExpiresAt: Date | null;
  feegrantExpiresAt: Date | null;
  moveGrantStatus: string;
  stakingGrantStatus: string;
  feegrantStatus: string;
};

export function isGrantBundleActive(
  grant: GrantBundle | null,
  now: Date
): boolean {
  if (!grant) {
    return false;
  }

  return (
    grant.moveGrantStatus === "active"
    && grant.stakingGrantStatus === "active"
    && grant.feegrantStatus === "active"
    && !!grant.moveGrantExpiresAt
    && !!grant.stakingGrantExpiresAt
    && !!grant.feegrantExpiresAt
    && grant.moveGrantExpiresAt > now
    && grant.stakingGrantExpiresAt > now
    && grant.feegrantExpiresAt > now
  );
}

export function computeNextEligibleAt(now: Date, cooldownSeconds: string): Date {
  return new Date(now.getTime() + Number(cooldownSeconds) * 1000);
}

export function minBigIntString(left: string, right: string): string {
  return (BigInt(left) < BigInt(right) ? BigInt(left) : BigInt(right)).toString();
}

export function serializeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
