/**
 * OrbitControls — rotate and tilt the 3D camera.
 *
 *  - Keyboard: hold ← / → to turn the full 360°, ↑ / ↓ to tilt (smooth,
 *    while held — WASD still moves the map); `[` / `]` rotate 45°,
 *    Page Up / Page Down tilt, Home or the "Reset view" button resets.
 *  - Touch: twisting two fingers rotates (pinch-zoom keeps working; the
 *    game's own handler still receives the touches).
 *  - On-screen compass (bottom-right): rotate buttons, tilt buttons, and a
 *    needle that always points north; tapping it resets the view.
 *
 * Only changes the camera's yaw/pitch — panning and zoom stay with the
 * game's TransformHandler.
 */

import { translateText } from "../../Utils";
import type { CameraController } from "./CameraController";

const ROTATE_STEP = 45;
const TILT_STEP = 10;
/** Compass drag: degrees of yaw / tilt per CSS pixel. */
const DRAG_YAW_PER_PX = 0.6;
const DRAG_TILT_PER_PX = 0.35;
/** Two-finger vertical slide: degrees of tilt per CSS pixel. */
const TOUCH_TILT_PER_PX = 0.25;
/** Held arrow keys: degrees per second. */
const KEY_YAW_PER_S = 110;
const KEY_TILT_PER_S = 45;
const ARROWS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);

export class OrbitControls {
  readonly widget: HTMLElement;
  private readonly needle: HTMLElement;
  private readonly abort = new AbortController();
  private twoFinger: { midY: number; dist: number } | null = null;
  private lastNeedle = "";
  private twistAngle: number | null = null;
  private readonly held = new Set<string>();
  private lastFrame = 0;

  constructor(
    private readonly camera: CameraController,
    touchTarget: EventTarget,
  ) {
    const signal = this.abort.signal;
    // Capture phase: arrow keys turn the 3D camera here before the 2D
    // input handler would pan the map with them.
    globalThis.addEventListener(
      "keydown",
      (e) => this.onKey(e as KeyboardEvent),
      { signal, capture: true },
    );
    globalThis.addEventListener(
      "keyup",
      (e) => {
        const k = e as KeyboardEvent;
        if (ARROWS.has(k.code)) {
          this.held.delete(k.code);
          k.stopImmediatePropagation();
        }
      },
      { signal, capture: true },
    );
    globalThis.addEventListener("blur", () => this.held.clear(), { signal });
    touchTarget.addEventListener(
      "touchmove",
      (e) => this.onTouchMove(e as TouchEvent),
      {
        signal,
        passive: true,
      },
    );
    touchTarget.addEventListener(
      "touchend",
      () => {
        this.twistAngle = null;
        this.twoFinger = null;
      },
      {
        signal,
        passive: true,
      },
    );

    const w = document.createElement("div");
    w.id = "world3d-compass";
    w.className =
      "fixed right-3 top-1/2 -translate-y-1/2 z-[900] flex flex-col items-center gap-1 select-none";
    w.innerHTML = `
      <button data-act="tilt-up" class="lkr-cam-btn" aria-label="${attr(translateText("world3d.tilt_up"))}">▲</button>
      <div class="flex items-center gap-1">
        <button data-act="rot-left" class="lkr-cam-btn" aria-label="${attr(translateText("world3d.rotate_left"))}">⟲</button>
        <button data-act="reset" class="lkr-cam-compass" aria-label="${attr(translateText("world3d.reset_view"))}">
          <span class="lkr-cam-needle"></span><span class="lkr-cam-n">N</span>
        </button>
        <button data-act="rot-right" class="lkr-cam-btn" aria-label="${attr(translateText("world3d.rotate_right"))}">⟳</button>
      </div>
      <button data-act="tilt-down" class="lkr-cam-btn" aria-label="${attr(translateText("world3d.tilt_down"))}">▼</button>
      <button data-act="reset" class="lkr-cam-reset" title="${attr(translateText("world3d.reset_hint"))}">⟲ ${translateText("world3d.reset_short")}</button>`;
    const style = document.createElement("style");
    style.textContent = `
      .lkr-cam-btn { width: 34px; height: 34px; border-radius: 10px; color: #fff;
        background: rgba(24,24,27,.82); border: 1px solid rgba(255,255,255,.12);
        font-size: 16px; line-height: 1; backdrop-filter: blur(6px);
        touch-action: manipulation; transition: background .15s, transform .1s; }
      .lkr-cam-btn:hover { background: rgba(39,39,42,.95); }
      .lkr-cam-btn:active { transform: scale(.92); }
      .lkr-cam-compass { position: relative; width: 52px; height: 52px; border-radius: 50%;
        background: rgba(24,24,27,.82); border: 1px solid rgba(255,255,255,.18);
        backdrop-filter: blur(6px); touch-action: none; cursor: grab; }
      .lkr-cam-compass:active { cursor: grabbing; }
      .lkr-cam-needle { position: absolute; left: 50%; top: 50%; width: 6px; height: 30px;
        margin: -15px 0 0 -3px; border-radius: 3px;
        background: linear-gradient(#ef4444 0 50%, #e4e4e7 50% 100%); }
      .lkr-cam-n { position: absolute; left: 0; right: 0; top: -1px; font: 700 9px system-ui;
        color: #fca5a5; text-align: center; pointer-events: none; }
      .lkr-cam-reset { margin-top: 2px; padding: 4px 8px; border-radius: 9px; color: #fff;
        background: rgba(24,24,27,.82); border: 1px solid rgba(255,255,255,.12);
        font: 600 11px system-ui; white-space: nowrap; touch-action: manipulation; }
      .lkr-cam-reset:hover { background: rgba(39,39,42,.95); }
      body:not(.in-game) #world3d-compass { display: none; }`;
    w.prepend(style);
    // Drag the compass to orbit freely: sideways turns the full 360°, up and
    // down tilts. A drag never counts as a click on the compass (reset).
    const compass = w.querySelector(".lkr-cam-compass") as HTMLElement;
    let drag: { id: number; x: number; y: number; moved: number } | null = null;
    let suppressClick = false;
    compass.addEventListener(
      "pointerdown",
      (e) => {
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
        compass.setPointerCapture(e.pointerId);
        e.preventDefault();
      },
      { signal },
    );
    compass.addEventListener(
      "pointermove",
      (e) => {
        if (drag === null || e.pointerId !== drag.id) return;
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        drag.x = e.clientX;
        drag.y = e.clientY;
        drag.moved += Math.abs(dx) + Math.abs(dy);
        this.camera.rotateBy(-dx * DRAG_YAW_PER_PX);
        this.camera.tiltBy(dy * DRAG_TILT_PER_PX);
      },
      { signal },
    );
    const endDrag = (e: PointerEvent) => {
      if (drag === null || e.pointerId !== drag.id) return;
      suppressClick = drag.moved > 6;
      drag = null;
    };
    compass.addEventListener("pointerup", endDrag, { signal });
    compass.addEventListener("pointercancel", endDrag, { signal });

    w.addEventListener(
      "click",
      (e) => {
        const act = (e.target as HTMLElement).closest("button")?.dataset.act;
        if (act === "reset" && suppressClick) {
          suppressClick = false;
          return;
        }
        if (act === "rot-left") this.camera.rotateBy(ROTATE_STEP);
        else if (act === "rot-right") this.camera.rotateBy(-ROTATE_STEP);
        else if (act === "tilt-up") this.camera.tiltBy(TILT_STEP);
        else if (act === "tilt-down") this.camera.tiltBy(-TILT_STEP);
        else if (act === "reset") this.camera.resetView();
      },
      { signal },
    );
    document.body.appendChild(w);
    this.widget = w;
    this.needle = w.querySelector(".lkr-cam-needle") as HTMLElement;
  }

  /** Per frame: held arrow keys turn/tilt; keep the needle pointing north. */
  update(): void {
    const now = performance.now();
    const dt =
      this.lastFrame > 0 ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0;
    this.lastFrame = now;
    if (this.held.size > 0 && dt > 0) {
      if (this.held.has("ArrowLeft")) this.camera.rotateBy(KEY_YAW_PER_S * dt);
      if (this.held.has("ArrowRight"))
        this.camera.rotateBy(-KEY_YAW_PER_S * dt);
      if (this.held.has("ArrowUp")) this.camera.tiltBy(KEY_TILT_PER_S * dt);
      if (this.held.has("ArrowDown")) this.camera.tiltBy(-KEY_TILT_PER_S * dt);
    }
    const t = `rotate(${this.camera.yawDeg.toFixed(1)}deg)`;
    if (t !== this.lastNeedle) {
      this.needle.style.transform = t;
      this.lastNeedle = t;
    }
  }

  dispose(): void {
    this.abort.abort();
    this.widget.remove();
  }

  private onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (
      t &&
      (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
    ) {
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (ARROWS.has(e.code)) {
      // Only while a game is on screen (menus keep normal arrow keys).
      if (!document.body.classList.contains("in-game")) return;
      this.held.add(e.code);
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    switch (e.code) {
      case "BracketLeft":
        this.camera.rotateBy(ROTATE_STEP);
        break;
      case "BracketRight":
        this.camera.rotateBy(-ROTATE_STEP);
        break;
      case "PageUp":
        this.camera.tiltBy(TILT_STEP);
        break;
      case "PageDown":
        this.camera.tiltBy(-TILT_STEP);
        break;
      case "Home":
        this.camera.resetView();
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  private onTouchMove(e: TouchEvent): void {
    if (e.touches.length !== 2) {
      this.twistAngle = null;
      this.twoFinger = null;
      return;
    }
    const [a, b] = [e.touches[0], e.touches[1]];
    // Two fingers sliding up or down together (not pinching) tilt the view.
    const midY = (a.clientY + b.clientY) / 2;
    const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
    if (this.twoFinger !== null) {
      const dMid = midY - this.twoFinger.midY;
      const dDist = Math.abs(dist - this.twoFinger.dist);
      if (Math.abs(dMid) > 1.5 && dDist < Math.abs(dMid) * 0.5) {
        this.camera.tiltBy(dMid * TOUCH_TILT_PER_PX);
      }
    }
    this.twoFinger = { midY, dist };
    const angle =
      (Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX) * 180) /
      Math.PI;
    if (this.twistAngle !== null) {
      let d = angle - this.twistAngle;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      // Small jitters are pinch noise, not a twist.
      if (Math.abs(d) < 8) this.camera.rotateBy(-d);
    }
    this.twistAngle = angle;
  }
}

function attr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
