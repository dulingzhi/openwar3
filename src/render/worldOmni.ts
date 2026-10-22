// The world's MODEL lights, as one array the shaders read (docs/lighting.md).
//
// WC3's MDX models carry their own omni lights in the LITE chunk — a campfire, a lamppost,
// DSIII's login lamp (`HFMLampLight.mdx`, orange, intensity 10). In the real game these shade
// the model's own additive glow AND pool warm light onto the ground around them; without them
// the glow texture (a white radial in the file) draws at full white and the ground keeps the
// flat day/night look. The glue screens already do this in `menuScene.ts`'s updateOmniLights —
// this is the same evaluation for the world scene, where the lights belong to many instances.
//
// Two caps keep it cheap: only lights of instances the viewer CULLED IN this frame are
// evaluated (`scene.visibleInstances` — the front of the array), and at most MAX_OMNI reach
// the shaders, chosen nearest the camera. Everything is evaluated into preallocated arrays so
// a match allocates nothing here per frame.

/** Must match the terrain shaders' `u_omni*` and menuScene's MAX_OMNI. */
const MAX_OMNI = 8;

export interface WorldOmniLights {
  count: number;
  /** Σ ambient over the lights — the world keeps this at ZERO: its base wash is the
   *  day/night rig's job, and every model light here is a point source. The field must
   *  EXIST though — the batchgroup uploads it, and `uniform3fv(undefined, …)` throws. */
  ambient: Float32Array;
  positions: Float32Array; // MAX_OMNI × 3, world space
  colors: Float32Array; // MAX_OMNI × 3, Color × Intensity (BGR-swizzled like menuScene)
  attenuations: Float32Array; // MAX_OMNI × 2, (start, end)
}

interface Candidate {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  att0: number;
  att1: number;
  /** Squared distance from the camera — the picker sorts on it. */
  d2: number;
}

export class WorldOmniLightsCollector {
  readonly lights: WorldOmniLights = {
    count: 0,
    ambient: new Float32Array(3),
    positions: new Float32Array(MAX_OMNI * 3),
    colors: new Float32Array(MAX_OMNI * 3),
    attenuations: new Float32Array(MAX_OMNI * 2),
  };
  private candidates: Candidate[] = [];

  /** Evaluate every visible instance's LITE lights for this frame. Call after the viewer
   *  has stepped (the light nodes are keyframed and parented into the skeleton) and before
   *  render. `camera` is only used to rank the lights. */
  update(scene: { instances: unknown[]; visibleInstances: number }, camera: { location: ArrayLike<number> }): void {
    const list = this.candidates;
    list.length = 0;
    const instances = scene.instances;
    const n = Math.min(scene.visibleInstances ?? 0, instances.length);
    for (let i = 0; i < n; i++) {
      const inst = instances[i] as WorldInstance | undefined;
      if (!inst || !inst.rendered) continue;
      const model = inst.model as WorldModel | undefined;
      const lights = model?.lights;
      if (!lights?.length || !inst.nodes || !model) continue;
      this.collectInstance(inst, model, lights, camera, list);
    }

    // Nearest MAX_OMNI win. A fight's worth of lights is a handful; the sort is tiny.
    list.sort((a, b) => a.d2 - b.d2);
    const o = this.lights;
    const slots = Math.min(MAX_OMNI, list.length);
    for (let s = 0; s < slots; s++) {
      const c = list[s];
      o.positions[s * 3] = c.x;
      o.positions[s * 3 + 1] = c.y;
      o.positions[s * 3 + 2] = c.z;
      o.colors[s * 3] = c.r;
      o.colors[s * 3 + 1] = c.g;
      o.colors[s * 3 + 2] = c.b;
      o.attenuations[s * 2] = c.att0;
      o.attenuations[s * 2 + 1] = c.att1;
    }
    o.count = slots;
  }

  private collectInstance(
    inst: WorldInstance,
    model: WorldModel,
    lights: WorldLight[],
    camera: { location: ArrayLike<number> },
    out: Candidate[],
  ): void {
    const { sequence, frame, counter } = inst;
    // Light i's node sits right after the bones (mdx/modelinstance.js builds them in that
    // order) and carries the light's animated world position.
    const boneCount = model.bones.length;
    const v = this.vec3;
    const s = this.scl;
    for (let i = 0; i < lights.length; i++) {
      const light = lights[i];
      if (light.type !== 0) continue; // 0 = omni (menuScene's OmniLights note)
      const node = inst.nodes?.[boneCount + i];
      if (!node) continue;
      const p = node.worldLocation;
      light.getColor(v, sequence, frame, counter);
      light.getIntensity(s, sequence, frame, counter);
      const intensity = s[0];
      if (intensity <= 0) continue;
      light.getVisibility(s, sequence, frame, counter);
      if (s[0] <= 0) continue; // the KLAV track — the lamp is OFF through this stretch of its clip
      light.getAttenuationStart(s, sequence, frame, counter);
      const att0 = s[0];
      light.getAttenuationEnd(s, sequence, frame, counter);
      const att1 = Math.max(s[0], att0 + 1);
      const x = p[0], y = p[1], z = p[2];
      // The LITE chunk's static Color field is RGB (the orange lamp reads (1, 0.53, 0.01)
      // straight off the parser and the real client lights it warm) — NOT the BGR of the
      // KLAC tracks dayNight.ts samples, which is why those need the [2-i] swizzle.
      const dx = x - camera.location[0];
      const dy = y - camera.location[1];
      const dz = z - camera.location[2];
      out.push({
        x, y, z,
        r: v[0] * intensity,
        g: v[1] * intensity,
        b: v[2] * intensity,
        att0, att1,
        d2: dx * dx + dy * dy + dz * dz,
      });
    }
  }

  private vec3 = new Float32Array(3);
  private scl = new Float32Array(1);
}

/** The slice of an mdx ModelInstance the collector reads. */
interface WorldInstance {
  rendered: boolean;
  model?: WorldModel | null;
  nodes?: Array<{ worldLocation: Float32Array }>;
  sequence: number;
  frame: number;
  counter: number;
}

interface WorldModel {
  bones: unknown[];
  lights: WorldLight[];
}

interface WorldLight {
  type: number;
  getColor(out: Float32Array, sequence: number, frame: number, counter: number): void;
  getIntensity(out: Float32Array, sequence: number, frame: number, counter: number): void;
  /** The light's KLAV track — 0 while the model's clip keeps the light OFF. */
  getVisibility(out: Float32Array, sequence: number, frame: number, counter: number): void;
  getAttenuationStart(out: Float32Array, sequence: number, frame: number, counter: number): void;
  getAttenuationEnd(out: Float32Array, sequence: number, frame: number, counter: number): void;
}
