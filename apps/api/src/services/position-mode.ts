import type { ApiConfig } from "../config.js";

export function getDelegatedLpKind(
  executionMode: ApiConfig["executionMode"]
): "delegated" | "bonded-locked" {
  return executionMode === "single-asset-provide-delegate"
    ? "bonded-locked"
    : "delegated";
}
