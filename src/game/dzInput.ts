import type { Interpreter } from "../jass/interpreter";
import type { Runtime } from "../jass/runtime";
import { jInt, type JassValue } from "../jass/values";

// `DzTriggerRegister{Key,Mouse,MouseWheel,MouseMove}Event` dispatch (docs/dzapi-port.md §3.9;
// war3japi_hardware.cpp). The renderer's DOM handlers call this; it is a pure function over
// `Runtime.dzInputRegs` so a headless test can drive it too.
//
// The original runs non-sync registrations through `CallJExecuteFunc_desync(func)` (a named
// function), and sync ones through a network packet that executes the trigger on peers. In a
// single-player match there are no peers, so a `sync` registration is a no-op here; a local one
// calls its function with the event responses pushed.

export interface DzInputEvent {
  kind: "key" | "mouse" | "wheel" | "move";
  key: number;
  /** 1 = down, 0 = up (the source's WM_KEYDOWN/UP split). */
  status: number;
  /** Wheel notch delta (Windows: ±120). */
  delta?: number;
  player: number;
}

export function fireDzInput(rt: Runtime, interp: Interpreter, ev: DzInputEvent): void {
  if (!rt.dzInputRegs.length) return;
  for (const reg of [...rt.dzInputRegs]) {
    if (reg.kind !== ev.kind) continue;
    if ((ev.kind === "key" || ev.kind === "mouse") && (reg.key !== ev.key || reg.status !== ev.status)) continue;
    if (reg.sync) continue; // peers only; the local sender already acted
    const player = rt.playerHandle(ev.player);
    const responses = new Map<string, JassValue>([
      ["DzKey", jInt(ev.key)],
      ["DzWheelDelta", jInt(ev.delta ?? 0)],
      ["DzKeyPlayer", player],
      ["TriggerPlayer", player],
    ]);
    rt.eventStack.push(responses);
    try {
      if (reg.fn) interp.callFunction(reg.fn, []);
      else interp.callFunction("TriggerExecute", [reg.trig]);
    } catch (err) {
      rt.warnOnce(reg.fn || "dz-input", `input callback threw: ${(err as Error).message}`);
    } finally {
      rt.eventStack.pop();
    }
  }
}

/** `DzSyncData` — the original sends a packet through WC3's lockstep command stream, which
 *  loops back to EVERY player INCLUDING the sender (`DoCNetCommandTeamChangeAlliance` →
 *  `DispatchSyncData` → `TriggerExecute`; war3japi_packet.cpp:78-90). So the local
 *  dispatch here is not an approximation: a single-player match is the one-player case of
 *  the same echo. */
export function dispatchDzSync(rt: Runtime, interp: Interpreter, prefix: string, data: string, server: boolean, player: number): void {
  if (!rt.dzSyncRegs.length) return;
  for (const reg of [...rt.dzSyncRegs]) {
    if (reg.prefix !== prefix) continue;
    // The source's match: a `server` registration only hears `server` packets.
    if (reg.server && !server) continue;
    const responses = new Map<string, JassValue>([
      ["DzSyncData", { k: "string", s: data }],
      ["DzSyncPlayer", rt.playerHandle(player)],
      ["DzSyncPrefix", { k: "string", s: prefix }],
      ["TriggerPlayer", rt.playerHandle(player)],
    ]);
    rt.eventStack.push(responses);
    try {
      interp.callFunction("TriggerExecute", [reg.trig]);
    } catch (err) {
      rt.warnOnce(`sync:${prefix}`, `sync trigger threw: ${(err as Error).message}`);
    } finally {
      rt.eventStack.pop();
    }
  }
}
