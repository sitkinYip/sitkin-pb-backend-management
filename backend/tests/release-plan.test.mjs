import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  canonicalJson,
  createComposeCandidate,
  digestBytes,
  releaseOperationSheetMarkers,
  validateAllowedDelta,
  validateOperationSheet,
  validateReleasePlan,
} from "../scripts/lib/release-plan.mjs";
import { parseStrictJson } from "../scripts/lib/strict-json.mjs";

const digest = (character) => character.repeat(64);

function planFixture(overrides = {}) {
  const plan = {
    schemaVersion: 1,
    status: "pending",
    releaseId: "release-test-20260901",
    transport: {
      sshTarget: "root@203.0.113.10",
      sshPort: 22,
    },
    server: {
      expectedHostname: "questions-prod-1",
      expectedMachineIdSha256: digest("a"),
      releaseRoot: "/opt/1panel/apps/questions-game-v1/releases",
      backupRoot: "/opt/1panel/backups/questions-game-v1",
      uploadRoot: "/opt/1panel/uploads/questions-game-v1",
      minimumFreeBytes: 1_073_741_824,
    },
    production: {
      projectDirectory: "/opt/1panel/apps/questions-game-v1",
      composePath: "/opt/1panel/apps/questions-game-v1/compose.yaml",
      composeService: "pocketbase",
      containerName: "questions-game-v1",
      dataHostPath: "/opt/1panel/apps/questions-game-v1/pb_data",
      dataContainerPath: "/pb/pb_data",
      databaseRelativePath: "data.db",
      hostIp: "127.0.0.1",
      hostPort: 8090,
      containerPort: 8090,
      rootReleasePath: "/opt/1panel/apps/questions-game-v1/release.json",
      rootChecksumsPath: "/opt/1panel/apps/questions-game-v1/SHA256SUMS",
    },
    source: {
      imageTag: "questions-pocketbase:0.40.1-source-20260831-amd64",
      imageId: `sha256:${digest("b")}`,
      composeSha256: digest("c"),
      releaseJsonSha256: digest("d"),
      migrationLedgerSha256: digest("e"),
      requiredMigrationFiles: ["1787788800_game_schema.js"],
    },
    target: {
      imageTag: "questions-pocketbase:0.40.1-release-test-20260901-amd64",
      pocketbaseVersion: "0.40.1",
      platform: "linux/amd64",
    },
    migration: {
      mode: "none",
      newFiles: [],
      verifier: "additive-empty-collections-v1",
    },
    verification: {
      healthUrl: "https://api.example.test/api/health",
      probes: [
        {
          path: "/api/questions/v1/admin/me",
          expectedStatus: 401,
        },
      ],
      healthTimeoutSeconds: 90,
    },
    activation: {
      executorMayActivate: false,
    },
  };
  return Object.assign(plan, overrides);
}

const emptyDelta = {
  schemaVersion: 1,
  verifier: "additive-empty-collections-v1",
  newMigrationFiles: [],
  newCollections: [],
  newSchemaObjects: [],
  emptyTables: [],
};

test("strict release JSON rejects duplicate and escaped-equivalent keys", () => {
  assert.deepEqual(parseStrictJson('{"a":1,"nested":{"b":2}}'), {
    a: 1,
    nested: { b: 2 },
  });
  assert.throws(() => parseStrictJson('{"a":1,"a":2}'), /duplicate/i);
  assert.throws(
    () => parseStrictJson('{"name":1,"na\\u006de":2}'),
    /duplicate/i,
  );
});

test("release plan freezes production identity and supports a no-migration release", () => {
  const plan = validateReleasePlan(planFixture(), {
    expectedPocketbaseVersion: "0.40.1",
    expectedTargetImageTag:
      "questions-pocketbase:0.40.1-release-test-20260901-amd64",
  });
  assert.equal(plan.transport.sshTarget, "root@203.0.113.10");
  assert.equal(plan.activation.executorMayActivate, false);
  assert.deepEqual(validateAllowedDelta(emptyDelta, plan), emptyDelta);
});

test("release plan rejects broad paths, unknown fields, drift and activation", () => {
  assert.throws(
    () =>
      validateReleasePlan(
        planFixture({
          server: { ...planFixture().server, backupRoot: "/opt/1panel" },
        }),
      ),
    /too broad|outside/i,
  );
  assert.throws(
    () => validateReleasePlan({ ...planFixture(), unreviewed: true }),
    /unknown fields/i,
  );
  assert.throws(
    () =>
      validateReleasePlan({
        ...planFixture(),
        activation: { executorMayActivate: true },
      }),
    /must be false/i,
  );
  assert.throws(
    () =>
      validateReleasePlan(planFixture(), {
        expectedTargetImageTag:
          "questions-pocketbase:0.40.1-other-release-amd64",
      }),
    /does not match/i,
  );
  assert.throws(
    () =>
      validateReleasePlan({
        ...planFixture(),
        transport: { sshTarget: "operator@203.0.113.10", sshPort: 22 },
      }),
    /root@host|root-only/i,
  );
  assert.throws(
    () =>
      validateReleasePlan({
        ...planFixture(),
        target: {
          ...planFixture().target,
          imageTag: "questions-pocketbase:0.40.1-unrelated-name-amd64",
        },
      }),
    /release identity|must be questions-pocketbase/i,
  );
  assert.throws(
    () =>
      validateReleasePlan({
        ...planFixture(),
        verification: {
          ...planFixture().verification,
          healthTimeoutSeconds: 30,
        },
      }),
    /90|integer/i,
  );
  assert.throws(
    () =>
      validateReleasePlan({
        ...planFixture(),
        verification: {
          ...planFixture().verification,
          probes: [{ path: "/api/health", expectedStatus: 200 }],
        },
      }),
    /authentication-boundary|401/i,
  );
  const deepProject = "/srv/company/tenant/one/apps/questions-game-v1";
  assert.throws(
    () =>
      validateReleasePlan({
        ...planFixture(),
        server: {
          ...planFixture().server,
          releaseRoot: `${deepProject}/releases`,
          backupRoot: "/srv/company/backups/questions-game-v1",
          // This is a multi-level ancestor of deepProject and must not be
          // treated as an unrelated upload directory.
          uploadRoot: "/srv/company/tenant",
        },
        production: {
          ...planFixture().production,
          projectDirectory: deepProject,
          composePath: `${deepProject}/compose.yaml`,
          dataHostPath: `${deepProject}/pb_data`,
          rootReleasePath: `${deepProject}/release.json`,
          rootChecksumsPath: `${deepProject}/SHA256SUMS`,
        },
      }),
    /outside|isolated/i,
  );
});

test("additive verifier requires an explicit, empty and private collection delta", () => {
  const migration = "1789000000_new_clues.js";
  const plan = validateReleasePlan(
    planFixture({
      migration: {
        mode: "required",
        newFiles: [migration],
        verifier: "additive-empty-collections-v1",
      },
    }),
  );
  const delta = {
    schemaVersion: 1,
    verifier: "additive-empty-collections-v1",
    newMigrationFiles: [migration],
    newCollections: [{ name: "game_new_clues", requirePrivate: true }],
    newSchemaObjects: [
      {
        type: "index",
        name: "idx_game_new_clues_query",
        table: "game_new_clues",
      },
      {
        type: "table",
        name: "game_new_clues",
        table: "game_new_clues",
      },
    ],
    emptyTables: ["game_new_clues"],
  };
  assert.deepEqual(validateAllowedDelta(delta, plan), delta);
  assert.throws(
    () =>
      validateAllowedDelta(
        { ...delta, newCollections: [{ ...delta.newCollections[0], requirePrivate: false }] },
        plan,
      ),
    /must be true/i,
  );
  assert.throws(
    () => validateAllowedDelta({ ...delta, emptyTables: [] }, plan),
    /required empty|not required empty/i,
  );
  assert.throws(
    () =>
      validateAllowedDelta(
        {
          ...delta,
          newSchemaObjects: [
            ...delta.newSchemaObjects,
            { type: "table", name: "unrelated_raw", table: "unrelated_raw" },
          ].sort((left, right) =>
            `${left.type}:${left.name}`.localeCompare(`${right.type}:${right.name}`),
          ),
          emptyTables: [...delta.emptyTables, "unrelated_raw"],
        },
        plan,
      ),
    /private collection table/i,
  );
});

test("operation sheet markers and Compose image-only candidate are deterministic", () => {
  const source = [
    "services:",
    "  pocketbase:",
    "    image: questions-pocketbase:0.40.1-source-20260831-amd64",
    "    restart: unless-stopped",
    "",
  ].join("\n");
  const plan = planFixture({
    source: {
      ...planFixture().source,
      composeSha256: digestBytes(source),
    },
  });
  const markers = releaseOperationSheetMarkers(plan);
  assert.equal(markers.length, 4);
  assert.equal(validateOperationSheet(markers.join("\n"), plan), markers.join("\n"));
  assert.throws(
    () => validateOperationSheet(markers.slice(1).join("\n"), plan),
    /release-status/i,
  );
  assert.throws(
    () =>
      validateOperationSheet(
        `${markers.join("\n")}\n<!-- release-status: completed -->`,
        plan,
      ),
    /stale alternatives|exactly one/i,
  );

  const candidate = createComposeCandidate(source, plan);
  assert.match(candidate.content, /release-test-20260901/);
  assert.doesNotMatch(candidate.content, /source-20260831/);
  assert.equal(candidate.sourceSha256, digestBytes(source));
  assert.equal(candidate.targetSha256, digestBytes(candidate.content));
  assert.equal(
    canonicalJson({ z: 1, a: [2, { y: true, x: null }] }),
    '{"a":[2,{"x":null,"y":true}],"z":1}',
  );
});

const pushRuntime = {
  profile: "harmony-push-production-v1", projectId: "101000000000000001",
  secretHostPath: "/opt/1panel/secrets/questions-game-v1/starward-harmony-push.json",
  secretContainerPath: "/run/secrets/starward-harmony-push.json", recordedComposeSha256: digest("f"),
};
test("both preserved Push profiles require the exact declaration and forbid executor activation in JS and Python", () => {
  const cases = [];
  for (const profile of ["harmony-push-production-v1", "harmony-push-production-v2"]) {
    const plan = planFixture();
    plan.production.pushRuntime = { ...pushRuntime, profile };
    assert.deepEqual(validateReleasePlan(plan), plan);
    cases.push({ plan, valid: true });
    for (const mutate of [
      (p) => delete p.production.pushRuntime.profile,
      ...[null, true, false, 0, 1, [], {}, "harmony-push-production-v3"].map((value) =>
        (p) => { p.production.pushRuntime.profile = value; }),
      (p) => p.production.pushRuntime.secretHostPath += ".other",
      (p) => p.production.pushRuntime.secretContainerPath = "/pb/pb_data/key.json",
      (p) => p.production.pushRuntime.recordedComposeSha256 = "",
      (p) => p.production.pushRuntime.projectId = 101000000000000001,
      (p) => p.production.pushRuntime.approved = true,
      (p) => p.production.pushRuntime.enabled = true,
      (p) => p.activation.executorMayActivate = true,
      (p) => p.activation.executorMayActivate = 0,
      (p) => delete p.activation.executorMayActivate,
    ]) {
      const invalid = structuredClone(plan);
      mutate(invalid);
      assert.throws(() => validateReleasePlan(invalid));
      cases.push({ plan: invalid, valid: false });
    }
  }
  const result = spawnSync("python3", ["-c", String.raw`
import importlib.util,json,sys
spec=importlib.util.spec_from_file_location("runner",sys.argv[1])
runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)
for case in json.load(sys.stdin):
    try: runner._validate_input_plan(case["plan"])
    except runner.ReleaseError as error:
        assert not case["valid"] and error.code=="invalid_schema",error.code
    else: assert case["valid"],"invalid Push plan accepted"
`, path.resolve(import.meta.dirname, "../deploy/1panel/release-runner.py")], {
    encoding: "utf8", input: JSON.stringify(cases),
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  assert.equal(result.status, 0, result.stderr);
});
const contextDelta = {
  schemaVersion: 1, verifier: "personal-journey-context-v1",
  newMigrationFiles: ["1795075320_push_personal_journey_notices.js"],
  newCollections: [], newSchemaObjects: [], emptyTables: [],
  contextEvolution: { collection: "game_push_notice_contexts", sessionRequired: false,
    kindValues: ["session", "account"], legacyKind: "session" },
};
test("context release accepts only the frozen single migration and the existing dedicated Push profile", () => {
  const plan = planFixture();
  plan.production.pushRuntime = structuredClone(pushRuntime);
  plan.migration = { mode: "required", newFiles: contextDelta.newMigrationFiles, verifier: contextDelta.verifier };
  assert.deepEqual(validateReleasePlan(plan), plan);
  assert.deepEqual(validateAllowedDelta(contextDelta, plan), contextDelta);
  for (const mutate of [
    (p) => p.production.pushRuntime.secretHostPath += ".other",
    (p) => p.production.pushRuntime.secretContainerPath = "/pb/pb_data/key.json",
    (p) => p.production.pushRuntime.enabled = true,
    (p) => p.migration.newFiles.push("1795075380_other.js"),
    (p) => p.migration.mode = "none",
  ]) { const invalid = structuredClone(plan); mutate(invalid); assert.throws(() => validateReleasePlan(invalid)); }
  for (const mutate of [
    (d) => d.contextEvolution.kindValues.reverse(),
    (d) => d.contextEvolution.sessionRequired = 0,
    (d) => d.contextEvolution.other = true,
    (d) => d.newCollections.push({ name: "unreviewed", requirePrivate: true }),
    (d) => d.emptyTables.push("game_players"),
  ]) { const invalid = structuredClone(contextDelta); mutate(invalid); assert.throws(() => validateAllowedDelta(invalid, plan)); }
});
