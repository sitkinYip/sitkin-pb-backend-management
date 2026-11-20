import { execFileSync } from "node:child_process";

// Reuse the frozen executor's exact profile contract before publishing a local
// handoff. This process only reads JSON; it cannot contact Docker or production.
export function verifyPreservedComposeRuntime({ plan, runnerPath, sourceConfig, candidateConfig }) {
  try {
    execFileSync("python3", ["-c", String.raw`
import importlib.util,sys
spec=importlib.util.spec_from_file_location("release_runner",sys.argv[1])
runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)
value=runner._json_loads_strict(sys.stdin.read())
runner._validate_input_plan(value["plan"])
for config in (value["sourceConfig"],value["candidateConfig"]):
    runner._verify_compose_push_contract(value["plan"],config)
`, runnerPath], {
      input: JSON.stringify({ plan, sourceConfig, candidateConfig }),
      encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    throw new Error("Frozen source or candidate Compose does not preserve the reviewed Push runtime profile.");
  }
}
