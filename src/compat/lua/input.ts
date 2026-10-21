// The app-side input bridge for `jass.message` (docs/lua-engine-port.md §5.11).
//
// The original module hooks an HWND-level message filter and reaches into the command card
// (`yd_lua_engine/libs_message.cpp`). A browser has neither, and `src/compat/` may not import
// the renderer — so the compat layer declares the questions it needs answered and the app
// implements them where the camera, the selection and the command card already live.
//
// `setFilter` is the only push direction: a filter returning false swallows the event, exactly
// as YD's `filter` does. Everything else is a pull.

export interface LuaInputEvent {
  type: "key_down" | "key_up" | "mouse_down" | "mouse_up" | "mouse_ability";
  /** The key code for keyboard events, the mouse code for mouse events. */
  code?: number;
  /** World coordinates for mouse events. */
  x?: number;
  y?: number;
  /** For `mouse_ability`: the command-card slot's ability/order, when one is bound. */
  ability?: number;
  order?: number;
}

export interface LuaInputBridge {
  /** Install/remove the script's input filter. */
  setFilter(fn: ((ev: LuaInputEvent) => boolean) | null): void;
  /** World coordinates under the cursor. */
  mouseWorld(): { x: number; y: number };
  /** The command-card slot at (x, y) — the same coordinates `jass.message.button` takes. */
  commandButton(x: number, y: number): { ability: number; order: number | string; targetType: number } | null;
  /** The local player's primary selected unit, as a handle id (0 = none). */
  selectedUnit(): number;
  /** Issue an order as the local player. The app routes it through its own order gate. */
  issueOrder(
    kind: "immediate" | "point" | "target",
    /** YD's order id, or the order NAME when the command card named an ability. */
    order: number | string,
    x?: number,
    y?: number,
    target?: number,
    flags?: number,
  ): boolean;
}
