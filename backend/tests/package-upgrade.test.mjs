import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
  new URL("../scripts/package-1panel.mjs", import.meta.url),
);
function invalid(args, image, pattern) {
  const output = path.join(
    os.tmpdir(),
    `questions-invalid-upgrade-${randomUUID()}`,
  );
  const env = { ...process.env };
  if (image === undefined) delete env.PB_DOCKER_IMAGE;
  else env.PB_DOCKER_IMAGE = image;
  const result = spawnSync(process.execPath, [script, output, ...args], {
    env,
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, pattern);
  assert.equal(
    existsSync(output),
    false,
    "invalid input must not create release output",
  );
}

test("upgrade packaging requires an explicit matching AMD64 release tag", () => {
  for (const image of [
    undefined,
    "untrusted/example:latest",
    "questions-pocketbase:0.40.1-latest-arm64",
    "questions-pocketbase:0.41.0-next-amd64",
  ]) {
    invalid(["--upgrade"], image, /explicit, versioned/);
  }
});

test("upgrade packaging rejects reusing the original release and unknown flags", () => {
  invalid(
    ["--upgrade"],
    "questions-pocketbase:0.40.1-v1.1-amd64",
    /new upgrade image tag/,
  );
  invalid(["--unknown"], undefined, /Usage:/);
});
