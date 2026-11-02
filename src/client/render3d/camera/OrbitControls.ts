/**
 * OrbitControls — rotate and tilt the 3D camera.
 *
 *  - Keyboard: `[` / `]` rotate 45°, Page Up / Page Down tilt, Home resets.
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

export class OrbitControls {
  readonly widget: HTMLElement;
  private readonly needle: HTMLElement;
  private readonly abort = new AbortController();
  private twistAngle: number | null = null;

  constructor(
    private readonly camera: CameraController,
    touchTarget: EventTarget,
  ) {
    const signal = this.abort.signal;
    globalThis.addEventListener(
      "keydown",
      (e) => this.onKey(e as KeyboardEvent),
      {
        signal,
      },
    );
    touchTarget.addEventListener(
      "touchmove",
      (e) => this.onTouchMove(e as TouchEvent),
      {
        signal,
        passive: true,
      },
    );
    touchTarget.addEventListener("touchend", () => (this.twistAngle = null), {
      signal,
      passive: true,
    });

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
      <button data-act="tilt-down" class="lkr-cam-btn" aria-label="${attr(translateText("world3d.tilt_down"))}">▼</button>`;
    const style = document.createElement("style");
    style.textContent = `
      .lkr-cam-btn { width: 34px; height: 34px; border-radius: 10px; color: #fff;
        background: rgba(24,24,27,.82); border: 1px solid rgba(255,255,255,.12);
        font-size: 16px; line-height: 1; backdrop-filter: blur(6px);
        touch-action: manipulation; transition: background .15s, transform .1s; }
      .lkr-cam-btn:hover { background: rgba(39,39,42,.95); }
      .lkr-cam-btn:active { transform: scale(.92); }
      .lkr-cam-compass { position: relative; width: 44px; height: 44px; border-radius: 50%;
        background: rgba(24,24,27,.82); border: 1px solid rgba(255,255,255,.18);
        backdrop-filter: blur(6px); touch-action: manipulation; }
      .lkr-cam-needle { position: absolute; left: 50%; top: 50%; width: 6px; height: 30px;
        margin: -15px 0 0 -3px; border-radius: 3px;
        background: linear-gradient(#ef4444 0 50%, #e4e4e7 50% 100%); }
      .lkr-cam-n { position: absolute; left: 0; right: 0; top: -1px; font: 700 9px system-ui;
        color: #fca5a5; text-align: center; pointer-events: none; }
      body:not(.in-game) #world3d-compass { display: none; }`;
    w.prepend(style);
    w.addEventListener(
      "click",
      (e) => {
        const act = (e.target as HTMLElement).closest("button")?.dataset.act;
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

  /** Per frame: keep the compass needle pointing north. */
  update(): void {
    this.needle.style.transform = `rotate(${this.camera.yawDeg.toFixed(1)}deg)`;
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
      return;
    }
    const [a, b] = [e.touches[0], e.touches[1]];
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
