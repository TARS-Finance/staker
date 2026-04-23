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
  now: Date,
  input: {
    requiresStakingGrant?: boolean;
  } = {}
): boolean {
  if (!grant) {
    return false;
  }

  const requiresStakingGrant = input.requiresStakingGrant ?? true;

  return (
    grant.moveGrantStatus === "active"
    && grant.feegrantStatus === "active"
    && !!grant.moveGrantExpiresAt
    && !!grant.feegrantExpiresAt
    && grant.moveGrantExpiresAt > now
    && grant.feegrantExpiresAt > now
    && (
      !requiresStakingGrant
      || (
        grant.stakingGrantStatus === "active"
        && !!grant.stakingGrantExpiresAt
        && grant.stakingGrantExpiresAt > now
      )
    )
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
