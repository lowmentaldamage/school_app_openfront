/**
 * BomberPanel — the rocket bomber button (left edge, key J).
 *
 * Tap it, then drag a line on the map: a jet takes off from the nearest
 * ready Airbase and bombs along the line (10 / 25 / 50 bombs by airbase
 * level). The button shows how many bombs the best airbase carries, its
 * reload, and the price; without an airbase it says so.
 */

import { UnitType } from "@laukolaroser/engine-api/game/GameTypes";
import {
  airbaseReloadLeft,
  bomberCooldown,
  bombsForLevel,
  ROCKET_BOMBER,
} from "@laukolaroser/engine-lib/air/RocketBomber";
import { renderNumber } from "@laukolaroser/engine-lib/Format";
import { hasTech } from "@laukolaroser/engine-lib/tech/Tech";
import { EventBus } from "@laukolaroser/shared/EventBus";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Controller } from "../../Controller";
import { BomberAimEvent, ToggleBomberAimEvent } from "../../InputHandler";
import { UIState } from "../../UIState";
import { translateText } from "../../Utils";
import { GameView } from "../../view";

@customElement("bomber-panel")
export class BomberPanel extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public uiState: UIState;

  @state() private visible = false;
  @state() private airbases = 0;
  @state() private bombs = 10;
  /** Seconds until the soonest airbase can fly (0 = ready). */
  @state() private reload = 0;
  @state() private affordable = true;
  @state() private aiming = false;

  createRenderRoot() {
    return this;
  }

  init() {
    this.eventBus.on(BomberAimEvent, (e) => (this.aiming = e.on));
  }

  tick() {
    const me = this.game?.myPlayer();
    const playing =
      me !== null &&
      me !== undefined &&
      me.isAlive() &&
      !this.game.inSpawnPhase() &&
      this.game.config().gameConfig().tutorial !== true &&
      !this.game.config().isUnitDisabled(UnitType.Airbase);
    this.visible = playing;
    if (!playing || !me) return;
    const tick = this.game.ticks();
    const bases = me
      .units(UnitType.Airbase)
      .filter((u) => !u.isUnderConstruction());
    this.airbases = bases.length;
    let bestLevel = 0;
    let soonest = Infinity;
    const mask = me.techMask();
    const cooldown = bomberCooldown(hasTech(mask, "jet_engines"));
    for (const u of bases) {
      const left = airbaseReloadLeft(u.missileTimerQueue(), tick, cooldown);
      soonest = Math.min(soonest, left);
      if (left === 0) bestLevel = Math.max(bestLevel, u.level());
    }
    this.reload = bases.length === 0 ? 0 : Math.ceil(soonest / 10);
    let bombs =
      bombsForLevel(bestLevel || Math.max(1, ...bases.map((u) => u.level()))) +
      (hasTech(mask, "heavy_bombers") ? 4 : 0);
    if (hasTech(mask, "carpet_bombing")) bombs = Math.floor((bombs * 3) / 2);
    this.bombs = bombs;
    this.affordable =
      me.gold() >= this.game.config().strikeCost(ROCKET_BOMBER.cost, me);
  }

  private toggle() {
    this.eventBus.emit(new ToggleBomberAimEvent());
  }

  render() {
    if (!this.visible) return html``;
    const ready = this.airbases > 0 && this.reload === 0 && this.affordable;
    const status =
      this.airbases === 0
        ? translateText("bomber.needs_airbase")
        : this.reload > 0
          ? translateText("bomber.reloading", { s: this.reload })
          : !this.affordable
            ? translateText("bomber.need_gold")
            : this.aiming
              ? translateText("bomber.drag_line")
              : translateText("bomber.bombs", { n: this.bombs });
    return html`
      <div
        class="fixed left-2 top-1/2 -translate-y-1/2 z-[900] select-none"
        data-game-input-pass-through
      >
        <button
          class="flex w-[4.5rem] flex-col items-center gap-0.5 rounded-xl border px-1 py-2 text-white backdrop-blur-md transition touch-manipulation
            ${
            this.aiming
              ? "border-red-300 bg-red-600/90 shadow-lg shadow-red-900/50"
              : ready
                ? "border-white/20 bg-zinc-900/80 hover:bg-zinc-800/90"
                : "border-white/5 bg-zinc-900/60 text-white/50"
          }"
          title=${translateText("bomber.hint", {
            cost: renderNumber(ROCKET_BOMBER.cost),
          })}
          aria-pressed=${this.aiming}
          @click=${() => this.toggle()}
        >
          <span class="text-2xl leading-none">✈️</span>
          <span class="text-[11px] font-bold uppercase tracking-wide"
            >${translateText("bomber.title")}</span
          >
          <span class="text-[10px] leading-tight text-center opacity-80"
            >${status}</span
          >
          <span class="text-[10px] font-semibold text-amber-300"
            >${renderNumber(ROCKET_BOMBER.cost)}</span
          >
          <span
            class="mt-0.5 rounded bg-black/40 px-1 text-[9px] font-mono opacity-70"
            >J</span
          >
        </button>
      </div>
    `;
  }
}
