// WC3's point-light attenuation, as the ENGINE computes it (WC3 1.27 `Game.dll`).
//
// `GxLightingSetFalloff(0.0, 0.00050000002)` is called exactly ONCE, at device init
// (`Game.dll.c:268329`), and never changed afterwards — so the falloff is GLOBAL for the
// whole game, not a property of the model that carries the light.
// `CGxDeviceD3d::IStateSyncLights` (`Game.dll.c:472600`) then uploads it to D3D as
// `Attenuation1` (linear) and `Attenuation2` (quadratic), with `Attenuation0 = 1`, so a
// point light contributes
//
//   colour × intensity × 1 / (1 + linear·d + quadratic·d²) × N·L
//
// and the MDX `LITE` chunk's own `AttenuationStart`/`AttenuationEnd` never reach the light
// at all: the engine's `struct CLight` (`Game.dll.h:133364`) carries no range field.
//
// The consequence for a lamp is a WIDE, soft pool — at 144 units the attenuation is still
// 0.088, and the light is a warm wash rather than a disc cut off at a window's edge.

/** The linear term of the global falloff — `m_lightLinearFalloff` in the engine. */
export const OMNI_FALLOFF_LINEAR = 0;

/** The quadratic term of the global falloff — `m_lightQuadraticFalloff` in the engine. */
export const OMNI_FALLOFF_QUADRATIC = 0.0005;

/** Write one light's falloff pair into a MAX_OMNI × 2 array. */
export function writeOmniFalloff(out: Float32Array, slot: number): void {
  out[slot * 2] = OMNI_FALLOFF_LINEAR;
  out[slot * 2 + 1] = OMNI_FALLOFF_QUADRATIC;
}
