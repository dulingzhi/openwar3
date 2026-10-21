// The map's SPRITE/MODEL frames as REAL MODELS (docs/dzapi-port.md follow-up).
//
// DzCreateFrameByTagName("SPRITE", …) + DzFrameSetModel hangs an MDX in a frame's rect, and
// that is the whole of the NGUI look: DSIII's hp/exp/skill bars are `ngui\ui_*bar*.mdx`, its
// cooldown wheels `gui_cooldown.mdx`, its in-map loading screen `loading_inmap.mdx` stretched
// over the screen. The DOM draws none of them, so they must go through the WebGL viewer —
// one extra SCENE on the game's own viewer (never a second GL context), an orthographic
// camera in canvas pixels looking down -Y at the XZ plane, and one instance per frame.
//
// The live knob is `DzFrameSetAnimateOffset` — update() feeds the hp/exp fraction every tick,
// which is the animation POSITION within the clip (0 = empty, 1 = full), so the layer writes
// `instance.frame` directly each frame after the viewer has stepped (the bar's mdx plays one
// clip whose sweep is the fill). The specs arrive from scriptFrameTree once per build; the
// per-frame state (visible/alpha/offset/size) is read out of the FrameModel by handle, so an
// animated bar never bumps the tree's revision.

import type { FrameModel, FrameObj } from "../jass/index";
import type { Solver } from "../render/assetSolver";

/** The slice of the game viewer this layer needs. */
type ModelHost = {
  addScene: () => unknown;
  load: (path: string, solver: Solver) => Promise<unknown>;
};

interface SpriteEntry {
  handle: number;
  name: string;
  modelPath: string;
  instance: SpriteInstance | null;
  model: { sequences: Array<{ name: string; interval?: ArrayLike<number> }>; bounds: { x: number; z: number; r: number } } | null;
  sequence: number;
}

/** The slice of mdx-m3-viewer's ModelInstance this layer drives. */
interface SpriteInstance {
  setScene: (s: unknown) => void;
  setSequence: (i: number) => void;
  setSequenceLoopMode: (m: number) => void;
  setUniformScale: (s: number) => void;
  setLocation: (l: number[]) => void;
  show: () => void;
  hide: () => void;
  frame: number;
}

/** The slice of the viewer's loaded model this layer reads. */
interface SpriteModel {
  addInstance: () => SpriteInstance;
  sequences: Array<{ name: string; interval?: ArrayLike<number> }>;
  bounds: { x: number; z: number; r: number };
}

export class UiModelLayer {
  private scene: {
    camera: {
      ortho: (l: number, r: number, b: number, t: number, near: number, far: number) => void;
      moveToAndFace: (eye: number[], target: number[], up: number[]) => void;
    };
    viewport: Float32Array;
    addInstance: (i: unknown) => void;
    removeInstance: (i: unknown) => void;
  } | null = null;
  private entries = new Map<string, SpriteEntry>();
  private failed = new Set<string>();
  /** Rects the last sync measured, CSS px in the container (name → rect). */
  private rects = new Map<string, DOMRect>();

  constructor(
    private container: HTMLElement,
    private canvas: HTMLCanvasElement,
    private viewer: ModelHost,
    private solver: Solver,
  ) {
    this.scene = viewer.addScene() as UiModelLayer["scene"];
  }

  /** Once per build: which sprite frames exist and what model each holds. */
  sync(specs: Array<{ name: string; handle: number; modelPath: string }>): void {
    const keep = new Set(specs.map((s) => s.name));
    for (const [name, e] of this.entries) {
      if (!keep.has(name)) {
        if (e.instance) this.scene?.removeInstance(e.instance);
        this.entries.delete(name);
      }
    }
    for (const s of specs) {
      if (this.entries.has(s.name) || this.failed.has(s.modelPath)) continue;
      const entry: SpriteEntry = { handle: s.handle, name: s.name, modelPath: s.modelPath, instance: null, model: null, sequence: -1 };
      this.entries.set(s.name, entry);
      void this.viewer
        .load(s.modelPath, this.solver)
        .then((raw) => {
          const model = raw as SpriteModel | null;
          if (!model || typeof model.addInstance !== "function") throw new Error("no model");
          const inst = model.addInstance();
          inst.setScene(this.scene);
          this.scene?.addInstance(inst);
          entry.instance = inst;
          entry.model = { sequences: model.sequences, bounds: model.bounds };
        })
        .catch(() => this.failed.add(s.modelPath));
    }
  }

  /** Every frame, after the viewer has stepped: fill positions and animation offsets.
   *  `model` is read LIVE (an offset moves every tick); a null model takes the layer down. */
  update(model: FrameModel | null): void {
    const scene = this.scene;
    if (!scene) return;
    if (!model) return;
    this.measureRects();
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    // Canvas pixels per CSS pixel: the world canvas is sized by the resolution rung and
    // CSS-scaled into the stage, so DOM rects must be rescaled into the canvas's space.
    const k = cw > 0 && this.container.clientWidth > 0 ? cw / this.container.clientWidth : 1;
    scene.viewport[2] = cw;
    scene.viewport[3] = ch;
    scene.camera.ortho(0, cw, 0, ch, -4096, 4096);
    // Looking down -Y at the XZ plane: x is canvas-right, z is canvas-UP (screen y flips).
    scene.camera.moveToAndFace([cw / 2, -1024, ch / 2], [cw / 2, 0, ch / 2], [0, 0, 1]);

    for (const e of this.entries.values()) {
      const inst = e.instance;
      if (!inst || !e.model) continue;
      const f: FrameObj | undefined = model.frames.get(e.handle);
      const rect = this.rects.get(e.name);
      if (!f || !f.visible || !rect || rect.width < 1 || rect.height < 1) {
        inst.hide();
        continue;
      }
      inst.show();
      // Fit the model's own bounds (a flat bar's extent width is its longest side, which is
      // what bounds.r halves) into the frame's rect, centred on it.
      const half = Math.max(e.model.bounds.r, 1);
      const scale = (rect.width * k) / (half * 2);
      inst.setUniformScale(scale);
      const cx = (rect.left + rect.width / 2) * k;
      const cy = ch - (rect.top + rect.height / 2) * k; // screen y down → world z up
      const b = e.model.bounds;
      inst.setLocation([cx - b.x * scale, 0, cy + b.z * scale]);
      // DzFrameSetAnimate(index)/SetAnimateOffset: the clip index, and the position within
      // it as a fraction — written straight onto the instance clock every tick.
      const seq = Math.max(0, Math.min(e.model.sequences.length - 1, f.animateIndex ?? 0));
      if (seq !== e.sequence) {
        inst.setSequence(seq);
        inst.setSequenceLoopMode(2); // loop — a bar's clip must hold at its offset, not end
        e.sequence = seq;
      }
      const iv = e.model.sequences[seq]?.interval;
      if (iv && iv[1] > iv[0]) inst.frame = iv[0] + (f.animateOffset ?? 0) * (iv[1] - iv[0]);
    }
  }

  /** DOM rects for every sprite frame, read off the mounted screen's elements. */
  private measureRects(): void {
    this.rects.clear();
    const base = this.container.getBoundingClientRect();
    for (const e of this.entries.values()) {
      const el = this.container.querySelector(`[data-frame="${CSS.escape(e.name)}"]`);
      if (!el) continue;
      const r = (el as HTMLElement).getBoundingClientRect();
      this.rects.set(e.name, new DOMRect(r.left - base.left, r.top - base.top, r.width, r.height));
    }
  }

  dispose(): void {
    for (const e of this.entries.values()) if (e.instance) this.scene?.removeInstance(e.instance);
    this.entries.clear();
  }
}
