import type { NativeCtx, Runtime } from "../../../../jass/runtime";
import { asInt, jInt, jReal, jBool, asStr, JNULL, type JassValue } from "../../../../jass/values";

// DzAPI: the mouse/keyboard read-outs the browser can answer (docs/dzapi-port.md §3.9;
// war3japi_hardware.cpp). The registrations live in input.ts; this file is the getters.

type Impl = (ctx: NativeCtx, args: JassValue[]) => JassValue;

export function hardwareImpls(rt: Runtime): Record<string, Impl> {
  const mouse = () => rt.hooks?.mouseState?.();

  return {
    DzGetMouseTerrainX: () => jReal(mouse()?.terrainX ?? 0),
    DzGetMouseTerrainY: () => jReal(mouse()?.terrainY ?? 0),
    DzGetMouseTerrainZ: () => jReal(mouse()?.terrainZ ?? 0),
    DzGetMouseX: () => jInt(mouse()?.x ?? 0),
    DzGetMouseY: () => jInt(mouse()?.y ?? 0),
    DzGetMouseXRelative: () => jInt(mouse()?.relativeX ?? 0),
    DzGetMouseYRelative: () => jInt(mouse()?.relativeY ?? 0),
    DzIsMouseOverUI: () => jBool(mouse()?.overUI ?? false),
    DzSetMousePos: () => JNULL, // no forced pointer position in a browser

    DzGetUnitUnderMouse: () => rt.hooks?.unitUnderMouse?.() ?? JNULL,
    DzGetMouseFocus: () => jInt(rt.hooks?.mouseFocusFrame?.() ?? 0),
    DzSetUnitTexture: (_c, a) => {
      const sim = rt.data<{ simId?: number }>(a[0] ?? JNULL)?.simId;
      // The path arrives as a string; the renderer's hook wants a decoded texture, so this
      // answers (the map's hero customization proceeds with the default art until that lands).
      if (sim !== undefined && sim >= 0) rt.hooks?.setUnitTexture?.(sim, asStr(a[1] ?? JNULL), asInt(a[2] ?? JNULL));
      return JNULL;
    },
  };
}
