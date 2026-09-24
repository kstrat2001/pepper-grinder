// The suite has to pass in more than one environment.
//
// The agent works inside a container where the repo is mounted at an
// absolute path. Verification may run somewhere else, where that path does
// not exist. A test that embeds the container's path passes for the agent
// and fails for everyone else -- the worst kind of green, because the author
// never sees it go red.
//
// These two checks make that failure visible where the work happens.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));

const SELF = "portability.test.js";

function testFiles() {
  // Excluding this file is not a convenience. Both checks below contain the
  // very patterns they search for, inside their own regex literals, so a
  // self-scan reports itself and nothing else -- a guard that can only ever
  // fail on itself is worse than no guard.
  return readdirSync(here)
    .filter((f) => f.endsWith(".test.js") && f !== SELF)
    .map((f) => [f, readFileSync(join(here, f), "utf8")]);
}

describe("suite portability", () => {
  it("no test embeds an absolute filesystem path", () => {
    // Matches a quoted POSIX absolute path. Deliberately not limited to one
    // mount point: /workspace today, something else on the next harness.
    const offenders = [];
    for (const [name, body] of testFiles()) {
      for (const m of body.matchAll(/["'`](\/[A-Za-z0-9._-]+\/[^"'`\n]*)["'`]/g)) {
        offenders.push(`${name}: ${m[1]}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "resolve paths from `import.meta.url` instead, so the suite runs anywhere:\n" +
        "  new URL('../src/tokenRotation.js', import.meta.url)\n" +
        `found:\n  ${offenders.join("\n  ")}`,
    );
  });

  it("no test spawns a bare `node` executable", () => {
    // `spawn("node", ...)` resolves through PATH, which is not the same in a
    // container and on a host with a version manager. `process.execPath` is
    // the interpreter already running this suite.
    const offenders = [];
    for (const [name, body] of testFiles()) {
      if (/\b(spawn|spawnSync|exec|execSync|execFile|execFileSync)\s*\(\s*["'`]node["'`]/.test(body)) {
        offenders.push(name);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "use `process.execPath` instead of the string \"node\":\n" +
        `found in:\n  ${offenders.join("\n  ")}`,
    );
  });
});
