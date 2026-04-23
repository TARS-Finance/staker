import { spawnSync } from "node:child_process";

const forwardedArgs = process.argv
  .slice(2)
  .filter((arg) => arg !== "--runInBand");

const result = spawnSync(
  "pnpm",
  ["exec", "vitest", "run", "--config", "vitest.workspace.ts", ...forwardedArgs],
  {
    stdio: "inherit",
    shell: process.platform === "win32"
  }
);

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(1);
