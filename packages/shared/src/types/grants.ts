import { z } from "zod";

export const grantStatusSchema = z.enum([
  "pending",
  "active",
  "revoked",
  "expired"
]);

export type GrantStatus = z.infer<typeof grantStatusSchema>;

export type GrantBundleState = {
  move: GrantStatus;
  staking: GrantStatus;
  feegrant: GrantStatus;
  expiresAt: string | null;
};
