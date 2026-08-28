import { readFile, writeFile, mkdir } from "node:fs/promises";
const source = await readFile(
  new URL("../contracts/game.ts", import.meta.url),
  "utf8",
);
const output =
  "// Generated from sitkin-pb-backend-management/backend/contracts/game.ts.\n" +
  source;
const targets = [
  new URL("../../src/game/contracts.ts", import.meta.url),
];
// GitHub checks out only this repository. The default still checks both copies.
if (!process.argv.includes("--admin-only")) {
  targets.push(
    new URL("../../../questions-web/src/api/game.contracts.ts", import.meta.url),
  );
}
for (const target of targets) {
  if (process.argv.includes("--check")) {
    if ((await readFile(target, "utf8")) !== output)
      throw new Error("Generated contract differs: " + target.pathname);
  } else {
    await mkdir(new URL(".", target), { recursive: true });
    await writeFile(target, output);
  }
}
console.log("Game contract copies are synchronized.");
