import { TextDecoder } from "node:util";

const utf8 = new TextDecoder("utf-8", { fatal: true });

function sourceText(source, label) {
  if (typeof source === "string") return source;
  try {
    return utf8.decode(source);
  } catch {
    throw new Error(`${label}: invalid UTF-8 JSON`);
  }
}

// JSON.parse intentionally accepts duplicate object keys with last-value-wins
// semantics. Release inputs are human-reviewed security material, so scan the
// validated JSON grammar and reject duplicates, including escaped aliases such
// as "name" and "na\u006de".
export function parseStrictJson(source, label = "JSON") {
  const text = sourceText(source, label);
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(`${label}: invalid JSON`);
  }

  let index = 0;
  const whitespace = () => {
    while (/\s/.test(text[index] ?? "")) index += 1;
  };
  const stringToken = () => {
    const start = index;
    index += 1;
    while (index < text.length) {
      const character = text[index++];
      if (character === "\\") {
        index += 1;
        continue;
      }
      if (character === '"') return JSON.parse(text.slice(start, index));
    }
    throw new Error(`${label}: invalid JSON`);
  };
  const value = () => {
    whitespace();
    if (text[index] === "{") {
      index += 1;
      whitespace();
      const keys = new Set();
      if (text[index] === "}") {
        index += 1;
        return;
      }
      while (index < text.length) {
        whitespace();
        const key = stringToken();
        if (keys.has(key))
          throw new Error(`${label}: duplicate object keys are forbidden`);
        keys.add(key);
        whitespace();
        index += 1; // colon; native JSON.parse already validated the grammar.
        value();
        whitespace();
        if (text[index] === "}") {
          index += 1;
          return;
        }
        index += 1; // comma
      }
    } else if (text[index] === "[") {
      index += 1;
      whitespace();
      if (text[index] === "]") {
        index += 1;
        return;
      }
      while (index < text.length) {
        value();
        whitespace();
        if (text[index] === "]") {
          index += 1;
          return;
        }
        index += 1; // comma
      }
    } else if (text[index] === '"') stringToken();
    else {
      while (
        index < text.length &&
        !/[\s,\]}]/.test(text[index])
      )
        index += 1;
    }
  };

  value();
  whitespace();
  if (index !== text.length) throw new Error(`${label}: invalid JSON`);
  return result;
}
