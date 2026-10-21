import type { NativeCtx, Runtime } from "../../../../jass/runtime";
import { asInt, asNum, asStr, jBool, jHandle, jInt, jReal, jStr, JNULL, type JassValue } from "../../../../jass/values";
import { frameModel, type FrameObj } from "../../../frames";

// DzAPI P2: the core frame pack (docs/dzapi-port.md §3.8; war3japi_gui.cpp).
//
// YD's frame handle is an INTEGER; ours is a `framehandle`. Every entry translates at the
// boundary. Layout/text/show/texture/size/value/parent go straight through the existing
// `BlzFrame*` natives, so the ONE `FrameObj` model and the ONE drawing keep serving both APIs.
// The properties Blz has no setter for (colour, font, alignment, priority, min/max, tex coord)
// are stored on FrameObj and read back — a map's setter/getter pair must agree.
//
// Not here yet: frame scripts/update callbacks, model frames and the engine-frame lookups that
// need an FDF name (they are the next sub-pack, not a second UI system).

type Impl = (ctx: NativeCtx, args: JassValue[]) => JassValue;

/** Integer Dz frame id → the framehandle the Blz natives take. */
const H = (v: JassValue | undefined): JassValue => {
  const id = asInt(v ?? JNULL);
  return id > 0 ? jHandle(id, "framehandle") : JNULL;
};
/** A returned framehandle → the integer Dz id. */
const outId = (v: JassValue): JassValue => (v.k === "handle" ? jInt(v.h) : jInt(0));

const frameAt = (rt: Runtime, v: JassValue | undefined): FrameObj | undefined =>
  rt.data<FrameObj>(H(v) ?? JNULL);

export function frameImpls(rt: Runtime): Record<string, Impl> {
  const call = (ctx: NativeCtx, name: string, args: JassValue[]): JassValue => ctx.call(name, args);

  return {
    // --- TOC and creation -------------------------------------------------------------
    DzLoadToc: (ctx, a) => { call(ctx, "BlzLoadTOCFile", [a[0] ?? JNULL]); return JNULL; },
    DzCreateFrame: (ctx, a) =>
      outId(call(ctx, "BlzCreateFrame", [a[0] ?? JNULL, H(a[1]), jInt(0), a[2] ?? JNULL])),
    DzCreateSimpleFrame: (ctx, a) =>
      outId(call(ctx, "BlzCreateSimpleFrame", [a[0] ?? JNULL, H(a[1]), a[2] ?? JNULL])),
    DzCreateFrameByTagName: (ctx, a) =>
      outId(call(ctx, "BlzCreateFrameByType", [a[0] ?? JNULL, a[1] ?? JNULL, H(a[2]), a[3] ?? JNULL, a[4] ?? JNULL])),
    DzDestroyFrame: (ctx, a) => { call(ctx, "BlzDestroyFrame", [H(a[0])]); return JNULL; },

    // --- find -------------------------------------------------------------------------
    DzFrameFindByName: (ctx, a) => outId(call(ctx, "BlzGetFrameByName", [a[0] ?? JNULL, a[1] ?? JNULL])),
    DzSimpleFrameFindByName: (ctx, a) => outId(call(ctx, "BlzGetFrameByName", [a[0] ?? JNULL, a[1] ?? JNULL])),
    DzSimpleFontStringFindByName: (ctx, a) => outId(call(ctx, "BlzGetFrameByName", [a[0] ?? JNULL, a[1] ?? JNULL])),
    DzSimpleTextureFindByName: (ctx, a) => outId(call(ctx, "BlzGetFrameByName", [a[0] ?? JNULL, a[1] ?? JNULL])),

    // --- the game's own roots ---------------------------------------------------------
    DzGetGameUI: (ctx) => outId(call(ctx, "BlzGetOriginFrame", [jInt(0), jInt(0)])),
    DzGetSimpleUIParent: (ctx) => outId(call(ctx, "BlzGetOriginFrame", [jInt(18), jInt(0)])),
    DzGetCursorFrame: (ctx) => outId(call(ctx, "BlzGetOriginFrame", [jInt(19), jInt(0)])),

    // --- layout -----------------------------------------------------------------------
    // Dz points are raw INTEGERS, while the Blz native takes a `framepointtype` HANDLE
    // (`ConvertFramePointType(4)`), and a Dz frame id is an integer too. So the four point
    // operations write the SAME `FrameObj.points` shape the Blz native writes, directly.
    DzFrameSetPoint: (_ctx, a) => {
      const f = frameAt(rt, a[0]);
      if (f) {
        const point = asInt(a[1] ?? JNULL);
        f.points = f.points.filter((q) => q.point !== point);
        f.points.push({
          point, relative: asInt(a[2] ?? JNULL), relativePoint: asInt(a[3] ?? JNULL),
          x: asNum(a[4] ?? JNULL), y: asNum(a[5] ?? JNULL),
        });
        frameModel(rt).revision++;
      }
      return JNULL;
    },
    DzFrameSetAbsolutePoint: (_ctx, a) => {
      const f = frameAt(rt, a[0]);
      if (f) {
        const point = asInt(a[1] ?? JNULL);
        f.points = f.points.filter((q) => q.point !== point);
        f.points.push({ point, relative: 0, relativePoint: -1, x: asNum(a[2] ?? JNULL), y: asNum(a[3] ?? JNULL) });
        frameModel(rt).revision++;
      }
      return JNULL;
    },
    DzFrameClearAllPoints: (_ctx, a) => {
      const f = frameAt(rt, a[0]);
      if (f) { f.points = []; f.cleared = true; frameModel(rt).revision++; }
      return JNULL;
    },
    DzFrameSetAllPoints: (_ctx, a) => {
      const f = frameAt(rt, a[0]), rel = frameAt(rt, a[1]);
      if (!f || !rel) return jBool(false);
      f.cleared = true;
      f.points = [
        { point: 0, relative: rel.handleId, relativePoint: 0, x: 0, y: 0 },
        { point: 8, relative: rel.handleId, relativePoint: 8, x: 0, y: 0 },
      ];
      frameModel(rt).revision++;
      return jBool(true);
    },
    DzFrameSetSize: (ctx, a) => { call(ctx, "BlzFrameSetSize", [H(a[0]), a[1] ?? JNULL, a[2] ?? JNULL]); return JNULL; },
    DzFrameGetWidth: (_c, a) => jReal(frameAt(rt, a[0])?.width ?? 0),
    DzFrameGetHeight: (_c, a) => jReal(frameAt(rt, a[0])?.height ?? 0),
    DzFrameSetParent: (_ctx, a) => {
      const f = frameAt(rt, a[0]);
      if (f) { f.parent = asInt(a[1] ?? JNULL); frameModel(rt).revision++; }
      return JNULL;
    },
    DzFrameGetParent: (ctx, a) => outId(call(ctx, "BlzFrameGetParent", [H(a[0])])),
    DzFrameGetChildrenCount: (_c, a) => {
      const id = asInt(a[0] ?? JNULL);
      let n = 0;
      for (const f of frameModel(rt).frames.values()) if (f.parent === id) n++;
      return jInt(n);
    },
    DzFrameGetChild: (_c, a) => {
      const id = asInt(a[0] ?? JNULL), index = asInt(a[1] ?? JNULL);
      let n = 0;
      for (const f of frameModel(rt).frames.values()) {
        if (f.parent !== id) continue;
        if (n++ === index) return jInt(f.handleId);
      }
      return jInt(0);
    },

    // --- points read back -------------------------------------------------------------
    DzFrameGetPointValid: (_c, a) => {
      const p = frameAt(rt, a[0])?.points.find((q) => q.point === asInt(a[1] ?? JNULL));
      return jBool(!!p);
    },
    DzFrameGetPointRelative: (_c, a) => {
      const p = frameAt(rt, a[0])?.points.find((q) => q.point === asInt(a[1] ?? JNULL));
      return jInt(p?.relative ?? 0);
    },
    DzFrameGetPointRelativePoint: (_c, a) => {
      const p = frameAt(rt, a[0])?.points.find((q) => q.point === asInt(a[1] ?? JNULL));
      return jInt(p?.relativePoint ?? -1);
    },
    DzFrameGetPointX: (_c, a) => {
      const p = frameAt(rt, a[0])?.points.find((q) => q.point === asInt(a[1] ?? JNULL));
      return jReal(p?.x ?? 0);
    },
    DzFrameGetPointY: (_c, a) => {
      const p = frameAt(rt, a[0])?.points.find((q) => q.point === asInt(a[1] ?? JNULL));
      return jReal(p?.y ?? 0);
    },

    // --- show / enable / alpha --------------------------------------------------------
    DzFrameShow: (ctx, a) => { call(ctx, "BlzFrameSetVisible", [H(a[0]), a[1] ?? JNULL]); return JNULL; },
    DzFrameIsVisible: (ctx, a) => call(ctx, "BlzFrameIsVisible", [H(a[0])]),
    DzFrameSetEnable: (ctx, a) => { call(ctx, "BlzFrameSetEnable", [H(a[0]), a[1] ?? JNULL]); return JNULL; },
    DzFrameGetEnable: (_c, a) => jBool(frameAt(rt, a[0])?.enabled ?? false),
    DzFrameSetAlpha: (ctx, a) => { call(ctx, "BlzFrameSetAlpha", [H(a[0]), a[1] ?? JNULL]); return JNULL; },
    DzFrameGetAlpha: (_c, a) => jInt(frameAt(rt, a[0])?.alpha ?? 0),
    DzFrameSetScale: (ctx, a) => { call(ctx, "BlzFrameSetScale", [H(a[0]), a[1] ?? JNULL]); return JNULL; },

    // --- text -------------------------------------------------------------------------
    DzFrameSetText: (ctx, a) => { call(ctx, "BlzFrameSetText", [H(a[0]), a[1] ?? JNULL]); return JNULL; },
    DzFrameGetText: (ctx, a) => call(ctx, "BlzFrameGetText", [H(a[0])]),
    DzFrameAddText: (ctx, a) => {
      const f = frameAt(rt, a[0]);
      if (f) call(ctx, "BlzFrameSetText", [H(a[0]), jStr(f.text + asStr(a[1] ?? JNULL))]);
      return JNULL;
    },
    DzFrameSetTextColor: (_c, a) => {
      const f = frameAt(rt, a[0]);
      if (f) { f.textColor = asInt(a[1] ?? JNULL); frameModel(rt).revision++; }
      return JNULL;
    },
    DzFrameSetTextSizeLimit: (_c, a) => {
      const f = frameAt(rt, a[0]);
      if (f) f.textSizeLimit = asInt(a[1] ?? JNULL);
      return JNULL;
    },
    DzFrameGetTextSizeLimit: (_c, a) => jInt(frameAt(rt, a[0])?.textSizeLimit ?? 0),
    DzFrameSetTextAlignment: (_c, a) => {
      const f = frameAt(rt, a[0]);
      if (f) { f.textAlignment = asInt(a[1] ?? JNULL); frameModel(rt).revision++; }
      return JNULL;
    },
    DzFrameSetFont: (_c, a) => {
      const f = frameAt(rt, a[0]);
      if (f) {
        f.font = asStr(a[1] ?? JNULL);
        f.fontHeight = asNum(a[2] ?? JNULL);
        f.fontFlags = asInt(a[3] ?? JNULL);
        frameModel(rt).revision++;
      }
      return JNULL;
    },
    DzFrameSetDisabledText: (_c, a) => {
      const f = frameAt(rt, a[0]);
      if (f) f.disabledText = asStr(a[1] ?? JNULL);
      return JNULL;
    },
    DzFrameSetHighlightText: (_c, a) => {
      const f = frameAt(rt, a[0]);
      if (f) f.highlightText = asStr(a[1] ?? JNULL);
      return JNULL;
    },

    // --- texture ----------------------------------------------------------------------
    DzFrameSetTexture: (ctx, a) =>
      { call(ctx, "BlzFrameSetTexture", [H(a[0]), a[1] ?? JNULL, a[2] ?? JNULL, jBool(true)]); return JNULL; },
    DzFrameSetTexCoord: (_c, a) => {
      const f = frameAt(rt, a[0]);
      if (f) {
        f.texCoord = [asNum(a[1] ?? JNULL), asNum(a[2] ?? JNULL), asNum(a[3] ?? JNULL), asNum(a[4] ?? JNULL)];
        frameModel(rt).revision++;
      }
      return JNULL;
    },
    DzFrameSetVertexColor: (_c, a) => {
      const f = frameAt(rt, a[0]);
      if (f) { f.vertexColor = asInt(a[1] ?? JNULL); frameModel(rt).revision++; }
      return JNULL;
    },

    // --- misc -------------------------------------------------------------------------
    DzFrameGetName: (ctx, a) => call(ctx, "BlzFrameGetName", [H(a[0])]),
    DzFrameSetTooltip: (ctx, a) => { call(ctx, "BlzFrameSetTooltip", [H(a[0]), H(a[1])]); return JNULL; },
    DzFrameSetValue: (ctx, a) => { call(ctx, "BlzFrameSetValue", [H(a[0]), a[1] ?? JNULL]); return JNULL; },
    DzFrameGetValue: (_c, a) => jReal(frameAt(rt, a[0])?.value ?? 0),
    DzFrameSetMinMaxValue: (_c, a) => {
      const f = frameAt(rt, a[0]);
      if (f) { f.minValue = asNum(a[1] ?? JNULL); f.maxValue = asNum(a[2] ?? JNULL); }
      return JNULL;
    },
    DzFrameSetStepValue: (_c, a) => {
      const f = frameAt(rt, a[0]);
      if (f) f.step = asNum(a[1] ?? JNULL);
      return JNULL;
    },
    DzFrameSetPriority: (_c, a) => {
      const f = frameAt(rt, a[0]);
      if (f) { f.priority = asInt(a[1] ?? JNULL); frameModel(rt).revision++; }
      return JNULL;
    },
    DzFrameGetPriority: (_c, a) => jInt(frameAt(rt, a[0])?.priority ?? 0),
    DzGetColor: (_c, a) => {
      const al = asInt(a[0] ?? JNULL) & 0xff, r = asInt(a[1] ?? JNULL) & 0xff;
      const g = asInt(a[2] ?? JNULL) & 0xff, b = asInt(a[3] ?? JNULL) & 0xff;
      return jInt((al << 24) | (r << 16) | (g << 8) | b);
    },
    DzFrameHideInterface: (ctx) => { call(ctx, "BlzHideOriginFrames", [jBool(true)]); return JNULL; },
    DzFrameEditBlackBorders: () => JNULL,
    DzFrameClick: (ctx, a) => { call(ctx, "BlzFrameClick", [H(a[0])]); return JNULL; },
    DzFrameSetFocus: () => JNULL,

    // --- engine frames that ARE origin frames -----------------------------------------
    DzFrameGetPortrait: (ctx) => outId(call(ctx, "BlzGetOriginFrame", [jInt(16), jInt(0)])),
    DzFrameGetMinimap: (ctx) => outId(call(ctx, "BlzGetOriginFrame", [jInt(8), jInt(0)])),
    DzFrameGetMinimapButton: (ctx, a) => outId(call(ctx, "BlzGetOriginFrame", [jInt(9), a[0] ?? JNULL])),
    DzFrameGetTooltip: (ctx) => outId(call(ctx, "BlzGetOriginFrame", [jInt(11), jInt(0)])),
    DzFrameGetUnitMessage: (ctx) => outId(call(ctx, "BlzGetOriginFrame", [jInt(14), jInt(0)])),
    DzFrameGetTopMessage: (ctx) => outId(call(ctx, "BlzGetOriginFrame", [jInt(15), jInt(0)])),
    DzFrameGetChatMessage: (ctx) => outId(call(ctx, "BlzGetOriginFrame", [jInt(13), jInt(0)])),
    DzFrameGetWorldFrameMessage: (ctx) => outId(call(ctx, "BlzGetOriginFrame", [jInt(17), jInt(0)])),
    DzFrameGetHeroBarButton: (ctx, a) => outId(call(ctx, "BlzGetOriginFrame", [jInt(3), a[0] ?? JNULL])),
    DzFrameGetHeroHPBar: (ctx, a) => outId(call(ctx, "BlzGetOriginFrame", [jInt(4), a[0] ?? JNULL])),
    DzFrameGetHeroManaBar: (ctx, a) => outId(call(ctx, "BlzGetOriginFrame", [jInt(5), a[0] ?? JNULL])),
    DzFrameGetItemBarButton: (ctx, a) => outId(call(ctx, "BlzGetOriginFrame", [jInt(7), a[0] ?? JNULL])),
    DzFrameGetCommandBarButton: (ctx, a) =>
      outId(call(ctx, "BlzGetOriginFrame", [jInt(1), jInt(asInt(a[0] ?? JNULL) * 4 + asInt(a[1] ?? JNULL))])),
    DzFrameGetUpperButtonBarButton: (ctx, a) => outId(call(ctx, "BlzGetOriginFrame", [jInt(10), a[0] ?? JNULL])),
  };
}
