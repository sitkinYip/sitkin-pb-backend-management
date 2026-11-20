import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { verifyPreservedComposeRuntime } from "../scripts/lib/release-compose.mjs";
import { createComposeCandidate, digestBytes } from "../scripts/lib/release-plan.mjs";

const runnerPath = path.resolve(import.meta.dirname, "../deploy/1panel/release-runner.py");
const example = JSON.parse(readFileSync(new URL("../deploy/1panel/release-plan.example.json", import.meta.url), "utf8"));

function fixture(profile, approved) {
  const plan = structuredClone(example);
  plan.production.pushRuntime = {
    profile, projectId: "101000000000000001",
    secretHostPath: "/opt/1panel/secrets/questions-game-v1/starward-harmony-push.json",
    secretContainerPath: "/run/secrets/starward-harmony-push.json",
    recordedComposeSha256: "a".repeat(64),
  };
  const sourceConfig = { services: { pocketbase: {
    image: plan.source.imageTag,
    environment: {
      STARWARD_PUSH_ENABLED: "1", STARWARD_PUSH_TEST_MODE: "0",
      STARWARD_PUSH_SUBSCRIPTION_APPROVED: approved,
      STARWARD_PUSH_PROJECT_ID: "101000000000000001",
      STARWARD_PUSH_SERVICE_ACCOUNT_FILE: "/run/secrets/starward-harmony-push.json",
    },
    volumes: [
      { type: "bind", source: plan.production.dataHostPath, target: "/pb/pb_data", bind: { create_host_path: false } },
      { type: "bind", source: plan.production.pushRuntime.secretHostPath, target: plan.production.pushRuntime.secretContainerPath, read_only: true, bind: { create_host_path: false } },
    ],
  } } };
  const candidateConfig = structuredClone(sourceConfig);
  candidateConfig.services.pocketbase.image = plan.target.imageTag;
  return { plan, runnerPath, sourceConfig, candidateConfig };
}

for (const [profile, approved] of [["harmony-push-production-v1", "0"], ["harmony-push-production-v2", "1"]]) {
  test(`local packaging ${profile} verifies both frozen Compose profiles with the frozen runner`, () => {
    const value = fixture(profile, approved);
    assert.doesNotThrow(() => verifyPreservedComposeRuntime(value));
    for (const side of ["sourceConfig", "candidateConfig"]) {
      for (const unsafe of [approved === "0" ? "1" : "0", null, true, false, 0, 1, "true", ""]) {
        const invalid = structuredClone(value);
        invalid[side].services.pocketbase.environment.STARWARD_PUSH_SUBSCRIPTION_APPROVED = unsafe;
        assert.throws(() => verifyPreservedComposeRuntime(invalid), /does not preserve/);
      }
      for (const mutate of [
        (service) => delete service.environment.STARWARD_PUSH_SUBSCRIPTION_APPROVED,
        (service) => service.environment.STARWARD_PUSH_OTHER = "1",
        (service) => service.volumes[1].read_only = false,
        (service) => service.volumes[1].read_only = 1,
        (service) => service.volumes[1].source += ".other",
        (service) => service.volumes[1].target = "/pb/pb_data/key.json",
        (service) => service.volumes.push(structuredClone(service.volumes[0])),
      ]) {
        const invalid = structuredClone(value);
        mutate(invalid[side].services.pocketbase);
        assert.throws(() => verifyPreservedComposeRuntime(invalid), /does not preserve/);
      }
    }
  });

  test(`candidate generation ${profile} changes only the exact image line and preserves env, secret and line endings`, () => {
    const { plan } = fixture(profile, approved);
    const source = [
      "# Exact reviewed Compose bytes",
      "services:", "  pocketbase:", `    image: ${plan.source.imageTag}`,
      "    environment:", `      STARWARD_PUSH_SUBSCRIPTION_APPROVED: \"${approved}\"`,
      "      STARWARD_PUSH_ENABLED: \"1\"", "      STARWARD_PUSH_TEST_MODE: \"0\"",
      "    volumes:", `      - type: bind`,
      `        source: ${plan.production.pushRuntime.secretHostPath}`,
      `        target: ${plan.production.pushRuntime.secretContainerPath}`,
      "        read_only: true", "        bind:", "          create_host_path: false", "",
    ].join("\r\n");
    plan.source.composeSha256 = digestBytes(source);
    const candidate = createComposeCandidate(source, plan);
    assert.equal(candidate.content, source.replace(`    image: ${plan.source.imageTag}`, `    image: ${plan.target.imageTag}`));
    assert.equal(candidate.sourceSha256, digestBytes(source));
    assert.equal(candidate.targetSha256, digestBytes(candidate.content));
    assert.throws(() => createComposeCandidate(source + "# drift", plan), /SHA256/);
    for (const invalid of [source + `    image: ${plan.source.imageTag}\r\n`, source + `    image: ${plan.target.imageTag}\r\n`]) {
      const invalidPlan = structuredClone(plan);
      invalidPlan.source.composeSha256 = digestBytes(invalid);
      assert.throws(() => createComposeCandidate(invalid, invalidPlan), /exactly once|already exists/);
    }
  });
}
