import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { compileFunction } from "node:vm";

// The production decoder and its model imports contain no platform APIs.
// Run those sources against PocketBase responses without an app or a device.
export async function loadNativeProgressWatchContract(checkout) {
  const { default: ts } = await import("typescript");
  const sourceRoot = pathToFileURL(`${checkout}/entry/src/main/ets/`);
  const loaded = new Map();
  function load(file) {
    if (loaded.has(file.href)) return loaded.get(file.href);
    const exports = {};
    const source = readFileSync(file, "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const compile = compileFunction(outputText, ["exports", "require"], { filename: file.pathname });
    compile(exports, (name) => load(new URL(`${name}.ets`, file)));
    loaded.set(file.href, exports);
    return exports;
  }
  return {
    ...load(new URL("data/DtoDecoder.ets", sourceRoot)),
    ProgressWatchCommand: load(new URL("business/ProgressWatch.ets", sourceRoot)).ProgressWatchCommand,
  };
}
