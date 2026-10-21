import type { JassPlayer, Runtime } from "../../../jass/runtime";
import { asInt, asStr, JNULL, type JassValue } from "../../../jass/values";
import type { JapiImpl } from "./registry";

// `EXDisplayChat` (docs/lua-engine-port.md §6.3; yd_jass_api/DisplayChat.cpp).
//
// The original calls the game's own InGameChatWhat with the sender's slot, so the line reads
// as that player's chat. Recipients are the four ids YDWE documents (YDWEJapiOther.j):
// 0 all, 1 allies, 2 observers/referees, 3 private. It is a DISPLAY, not a send: no chat
// trigger fires (the original never routes through the chat-send path either).

const playerIndex = (rt: Runtime, v: JassValue | undefined): number => {
  const p = rt.data<JassPlayer>(v ?? JNULL);
  return p && typeof p.index === "number" ? p.index : 0;
};

export function chatImpls(rt: Runtime): Record<string, JapiImpl> {
  return {
    EXDisplayChat: (_c, args) => {
      const player = playerIndex(rt, args[0]);
      const recipient = asInt(args[1] ?? JNULL);
      const message = asStr(args[2] ?? JNULL);
      rt.hooks?.displayChat?.(player, recipient, message);
      return JNULL;
    },
  };
}
