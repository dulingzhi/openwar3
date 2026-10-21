// The compact JASS signature YD passes to `japi_add` — "(Hunit;I)Hability;" — parsed once
// (docs/lua-engine-port.md §6.4; ydbase/base/warcraft3/jass/func_value.cpp).
//
// A malformed declaration is a bug in OUR table, so it throws at module load and a unit test
// runs the parser over every row. It never reaches a match.

export interface Signature {
  params: string[];
  returns: string;
}

const SIMPLE: Record<string, string> = {
  I: "integer",
  R: "real",
  B: "boolean",
  S: "string",
  C: "code",
  V: "nothing",
};

function readType(s: string, at: number): { type: string; next: number } {
  const c = s[at];
  if (c === undefined) throw new Error(`signature ends early: ${s}`);
  if (c === "H") {
    const end = s.indexOf(";", at + 1);
    if (end < 0) throw new Error(`handle type is not terminated: ${s}`);
    const name = s.slice(at + 1, end);
    if (!name) throw new Error(`empty handle type: ${s}`);
    return { type: name, next: end + 1 };
  }
  const simple = SIMPLE[c];
  if (simple === undefined) throw new Error(`unknown type '${c}' in ${s}`);
  return { type: simple, next: at + 1 };
}

export function parseSignature(s: string): Signature {
  if (!s.startsWith("(")) throw new Error(`signature must start with '(': ${s}`);
  const params: string[] = [];
  let i = 1;
  while (s[i] !== ")") {
    if (i >= s.length) throw new Error(`signature has no ')': ${s}`);
    const t = readType(s, i);
    params.push(t.type);
    i = t.next;
  }
  i++; // ')'
  if (i >= s.length) throw new Error(`signature has no return type: ${s}`);
  const ret = readType(s, i);
  if (ret.next !== s.length) throw new Error(`trailing text after the return type: ${s}`);
  return { params, returns: ret.type };
}
