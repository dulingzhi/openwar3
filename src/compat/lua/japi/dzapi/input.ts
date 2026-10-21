import type { NativeCtx, Runtime } from "../../../../jass/runtime";
import { dispatchDzSync } from "../../../../game/dzInput";
import type { Interpreter } from "../../../../jass/interpreter";
import { asInt, asStr, jBool, jInt, jReal, jStr, JNULL, type JassValue } from "../../../../jass/values";

// DzAPI P3: input, window and sync registrations (docs/dzapi-port.md §3.9-3.10;
// war3japi_hardware.cpp, war3japi_packet.cpp).
//
// The registrations live in Runtime.dzInputRegs / dzSyncRegs; the renderer's DOM handlers call
// game/dzInput.fireDzInput. `sync=false` is the local form the source runs through a named
// function; `sync=true` is a peer packet, and a single-player match has no peers.
//
// Sync DATA is likewise a network surface: DzSyncData sends to peers, and in a single-player
// match nothing is sent. The registrations are stored so a future match link can deliver into
// them; the getters read the event responses that delivery would set.

type Impl = (ctx: NativeCtx, args: JassValue[]) => JassValue;
const trig = (v: JassValue | undefined): JassValue => v ?? JNULL;
const codeName = (v: JassValue | undefined): string => (v?.k === "code" ? v.fn : "");

export function inputImpls(rt: Runtime, interp?: Interpreter): Record<string, Impl> {
  const register = (
    kind: "key" | "mouse" | "wheel" | "move" | "resize",
    a: JassValue[], fnAt: number, syncAt: number,
  ): JassValue => {
    rt.dzInputRegs.push({
      kind: kind === "resize" ? "move" : kind, // resize is dispatched as a "move"-bucket event
      key: kind === "key" || kind === "mouse" ? asInt(a[1] ?? JNULL) : -1,
      status: kind === "key" || kind === "mouse" ? asInt(a[2] ?? JNULL) : 0,
      trig: trig(a[0]),
      sync: a[syncAt]?.k === "bool" ? a[syncAt].b : false,
      fn: asStr(a[fnAt] ?? JNULL) || "",
    });
    return JNULL;
  };

  return {
    DzTriggerRegisterKeyEvent: (_c, a) => register("key", a, 4, 3),
    DzTriggerRegisterKeyEventByCode: (_c, a) => {
      rt.dzInputRegs.push({ kind: "key", key: asInt(a[1] ?? JNULL), status: asInt(a[2] ?? JNULL), trig: trig(a[0]), sync: a[3]?.k === "bool" ? a[3].b : false, fn: codeName(a[4]) });
      return JNULL;
    },
    DzTriggerRegisterMouseEvent: (_c, a) => register("mouse", a, 4, 3),
    DzTriggerRegisterMouseEventByCode: (_c, a) => {
      rt.dzInputRegs.push({ kind: "mouse", key: asInt(a[1] ?? JNULL), status: asInt(a[2] ?? JNULL), trig: trig(a[0]), sync: a[3]?.k === "bool" ? a[3].b : false, fn: codeName(a[4]) });
      return JNULL;
    },
    DzTriggerRegisterMouseWheelEvent: (_c, a) => register("wheel", a, 2, 1),
    DzTriggerRegisterMouseWheelEventByCode: (_c, a) => {
      rt.dzInputRegs.push({ kind: "wheel", key: -1, status: 0, trig: trig(a[0]), sync: a[1]?.k === "bool" ? a[1].b : false, fn: codeName(a[2]) });
      return JNULL;
    },
    DzTriggerRegisterMouseMoveEvent: (_c, a) => register("move", a, 2, 1),
    DzTriggerRegisterMouseMoveEventByCode: (_c, a) => {
      rt.dzInputRegs.push({ kind: "move", key: -1, status: 0, trig: trig(a[0]), sync: a[1]?.k === "bool" ? a[1].b : false, fn: codeName(a[2]) });
      return JNULL;
    },
    DzTriggerRegisterWindowResizeEvent: (_c, a) => register("resize", a, 2, 1),
    DzTriggerRegisterWindowResizeEventByCode: (_c, a) => {
      rt.dzInputRegs.push({ kind: "move", key: -1, status: 0, trig: trig(a[0]), sync: a[1]?.k === "bool" ? a[1].b : false, fn: codeName(a[2]) });
      return JNULL;
    },

    // --- the event a callback reads ----------------------------------------------------
    DzGetTriggerKey: () => {
      const v = rt.eventResponse("DzKey");
      return v.k === "int" || v.k === "real" ? jInt(Math.trunc(v.n)) : jInt(0);
    },
    DzGetWheelDelta: () => {
      const v = rt.eventResponse("DzWheelDelta");
      return v.k === "int" || v.k === "real" ? jInt(Math.trunc(v.n)) : jInt(0);
    },
    DzGetTriggerKeyPlayer: () => {
      const v = rt.eventResponse("DzKeyPlayer");
      return v.k === "handle" ? v : JNULL;
    },
    DzIsKeyDown: (_c, a) => jBool(rt.hooks?.isKeyDown?.(asInt(a[0] ?? JNULL)) ?? false),

    // --- hardware read-outs ------------------------------------------------------------
    DzGetWindowWidth: () => jInt(rt.hooks?.viewport?.().width ?? 0),
    DzGetWindowHeight: () => jInt(rt.hooks?.viewport?.().height ?? 0),
    DzGetClientWidth: () => jInt(rt.hooks?.viewport?.().width ?? 0),
    DzGetClientHeight: () => jInt(rt.hooks?.viewport?.().height ?? 0),
    DzGetWindowX: () => jInt(0),
    DzGetWindowY: () => jInt(0),
    DzIsWindowActive: () => jBool(rt.hooks?.windowActive?.() ?? true),
    DzIsWindowMode: () => jBool(true),
    DzChangeWindowSize: (_c, a) => jBool(rt.hooks?.changeWindowSize?.(asInt(a[0] ?? JNULL), asInt(a[1] ?? JNULL)) ?? false),

    DzGetMouseX: () => jInt(rt.hooks?.mouseState?.().x ?? 0),
    DzGetMouseY: () => jInt(rt.hooks?.mouseState?.().y ?? 0),
    DzGetMouseXRelative: () => jInt(rt.hooks?.mouseState?.().relativeX ?? 0),
    DzGetMouseYRelative: () => jInt(rt.hooks?.mouseState?.().relativeY ?? 0),
    DzGetMouseTerrainX: () => { const s = rt.hooks?.mouseState?.(); return jReal(s?.terrainX ?? 0); },
    DzGetMouseTerrainY: () => { const s = rt.hooks?.mouseState?.(); return jReal(s?.terrainY ?? 0); },
    DzGetMouseTerrainZ: () => { const s = rt.hooks?.mouseState?.(); return jReal(s?.terrainZ ?? 0); },
    DzIsMouseOverUI: () => jBool(rt.hooks?.mouseState?.().overUI ?? false),
    DzSetMousePos: () => JNULL,

    // --- sync -------------------------------------------------------------------------
    DzTriggerRegisterSyncData: (_c, a) => {
      rt.dzSyncRegs.push({ trig: trig(a[0]), prefix: asStr(a[1] ?? JNULL), server: a[2]?.k === "bool" ? a[2].b : false });
      return JNULL;
    },
    // The original's packet loops back to the sender through the lockstep stream (see
    // game/dzInput.dispatchDzSync), so these FIRE the registered triggers locally — the
    // one-player case of the same echo, not an approximation.
    DzSyncData: (_c, a) => {
      if (interp) dispatchDzSync(rt, interp, asStr(a[0] ?? JNULL), asStr(a[1] ?? JNULL), false, rt.localPlayer);
      return JNULL;
    },
    DzSyncDataImmediately: (_c, a) => {
      if (interp) dispatchDzSync(rt, interp, asStr(a[0] ?? JNULL), asStr(a[1] ?? JNULL), false, rt.localPlayer);
      return JNULL;
    },
    DzSyncBuffer: (_c, a) => {
      if (interp) dispatchDzSync(rt, interp, asStr(a[0] ?? JNULL), asStr(a[1] ?? JNULL), false, rt.localPlayer);
      return JNULL;
    },
    DzGetTriggerSyncData: () => {
      const v = rt.eventResponse("DzSyncData");
      return v.k === "string" ? v : jStr("");
    },
    DzGetTriggerSyncPlayer: () => {
      const v = rt.eventResponse("DzSyncPlayer");
      return v.k === "handle" ? v : JNULL;
    },
    DzGetTriggerSyncPrefix: () => {
      const v = rt.eventResponse("DzSyncPrefix");
      return v.k === "string" ? v : jStr("");
    },
  };
}

