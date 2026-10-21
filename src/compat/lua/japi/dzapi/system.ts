import type { JassPlayer, NativeCtx, Runtime } from "../../../../jass/runtime";
import { intToRawcode } from "../../../../jass/lexer";
import { asInt, asStr, jStr, JNULL, type JassValue } from "../../../../jass/values";

// DzAPI P1: the system/misc functions that have a real local answer
// (docs/dzapi-port.md §3.12; war3japi_plus.cpp, war3japi.cpp).
//
// Process-memory/window functions are deliberately NOT here: they answer 0/no-op in their own
// pack. This file only handles what a browser can answer honestly.

type Impl = (ctx: NativeCtx, args: JassValue[]) => JassValue;

export function systemImpls(rt: Runtime): Record<string, Impl> {
  const log = (text: string): void => {
    if (rt.hooks?.showMessage) rt.hooks.showMessage(text);
    else console.info(text);
  };

  return {
    // The original calls ExecuteFunc through a desync-safe wrapper; ours is the same door.
    DzExecuteFunc: (ctx, args) => ctx.call("ExecuteFunc", args),

    DzDebugString: (_c, args) => {
      log(`[MapLog]: ${asStr(args[0] ?? JNULL)}`);
      return JNULL;
    },
    DzWriteLog: (_c, args) => {
      log(`[MAPLOG] ${asStr(args[0] ?? JNULL)}`);
      return JNULL;
    },

    DzGetLocale: () => jStr(rt.hooks?.locale?.() ?? "enUS"),
    // The source lower-cases the path; ours is already the map's label/path.
    DzGetMapFilePath: () => jStr((rt.hooks?.mapFilePath?.() ?? "").toLowerCase()),

    // A `code` value in this engine IS its name; the source resolves a code handle to one.
    DzGetCodeName: (_c, args) => {
      const v = args[0];
      if (v?.k === "code") return jStr(v.fn);
      return jStr(v?.k === "string" ? v.s : "");
    },

    DzGetItemAbility: (ctx, args) => ctx.call("BlzGetItemAbilityByIndex", args),

    DzRemovePlayerTechResearched: (_c, args) => {
      const p = rt.data<JassPlayer>(args[0] ?? JNULL);
      if (p) {
        rt.hooks?.removePlayerTechResearched?.(
          p.index, intToRawcode(asInt(args[1] ?? JNULL)), asInt(args[2] ?? JNULL),
        );
      }
      return JNULL;
    },

    DzBlockSelectModeCommand: () => {
      rt.hooks?.blockSelectModeCommand?.();
      return JNULL;
    },
  };
}
