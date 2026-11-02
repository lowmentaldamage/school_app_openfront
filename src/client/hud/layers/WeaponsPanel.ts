/**
 * WeaponsPanel — pick a weapon, then tap a target on the map.
 *
 * Shows the three strikes (artillery from defense posts, naval fire from
 * warships, rockets from missile silos) with their price and how many
 * launchers are ready. Choosing one enters aiming mode (UIState
 * .weaponTargeting); the next map click/tap fires it (ClientGameRunner),
 * Escape or tapping the button again cancels. Rules come from the shared
 * engine-lib weapon specs, so the panel agrees with the simulation.
 */

import { UnitType } from "@laukolaroser/engine-api/game/GameTypes";
import { renderNumber } from "@laukolaroser/engine-lib/Format";
import {
  WEAPON_IDS,
  WEAPONS,
  type WeaponId,
  type WeaponSpec,
} from "@laukolaroser/engine-lib/weapons/Weapons";
import { EventBus } from "@laukolaroser/shared/EventBus";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Controller } from "../../Controller";
import { WeaponAimEvent } from "../../InputHandler";
import { UIState } from "../../UIState";
import { translateText } from "../../Utils";
import { GameView, UnitView } from "../../view";

/** Spelled out so the translation-key checker can see them. */
const NAME_KEYS: Record<WeaponId, string> = {
  artillery: "weapons.artillery",
  naval: "weapons.naval",
  rocket: "weapons.rocket",
};
const NEEDS_KEYS: Record<WeaponId, string> = {
  artillery: "weapons.needs_artillery",
  naval: "weapons.needs_naval",
  rocket: "weapons.needs_rocket",
};

const ICONS: Record<WeaponId, string> = {
  artillery: "💥",
  naval: "⚓",
  rocket: "🚀",
};

/** Client mirror of the engine's launcherReady (read-only). */
export function isLauncherReady(
  unit: UnitView,
  spec: WeaponSpec,
  tick: number,
): boolean {
  if (!unit.isActive() || unit.isUnderConstruction()) return false;
  const q = unit.missileTimerQueue();
  if (unit.type() === UnitType.MissileSilo) return q.length < unit.level();
  const pending = q.filter((t) => tick - t < spec.cooldownTicks).length;
  return pending < Math.max(1, unit.level());
}

@customElement("weapons-panel")
export class WeaponsPanel extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public uiState: UIState;

  @state() private ready: Record<WeaponId, number> = {
    artillery: 0,
    naval: 0,
    rocket: 0,
  };
  @state() private owned: Record<WeaponId, number> = {
    artillery: 0,
    naval: 0,
    rocket: 0,
  };
  @state() private gold = 0n;
  @state() private visible = false;

  createRenderRoot() {
    return this;
  }

  init() {
    this.eventBus.on(WeaponAimEvent, () => this.requestUpdate());
  }

  tick() {
    const me = this.game?.myPlayer();
    const playing =
      me !== null &&
      me !== undefined &&
      me.isAlive() &&
      !this.game.inSpawnPhase() &&
      this.game.config().gameConfig().tutorial !== true;
    this.visible = playing;
    if (!playing || !me) return;
    const tick = this.game.ticks();
    const ready = { artillery: 0, naval: 0, rocket: 0 };
    const owned = { artillery: 0, naval: 0, rocket: 0 };
    for (const id of WEAPON_IDS) {
      const spec = WEAPONS[id];
      for (const u of me.units(...spec.launchers)) {
        owned[id]++;
        if (isLauncherReady(u, spec, tick)) ready[id]++;
      }
    }
    this.ready = ready;
    this.owned = owned;
    this.gold = me.gold();
  }

  private toggle(id: WeaponId) {
    const next = this.uiState.weaponTargeting === id ? null : id;
    this.uiState.weaponTargeting = next;
    // Aiming and building are exclusive.
    if (next !== null) this.uiState.ghostStructure = null;
    this.eventBus.emit(new WeaponAimEvent(next));
    this.requestUpdate();
  }

  render() {
    if (!this.visible) return html``;
    const aiming = this.uiState?.weaponTargeting ?? null;
    return html`
      <div
        class="fixed left-2 top-1/2 -translate-y-1/2 z-[900] flex flex-col gap-1.5 select-none"
        role="toolbar"
        aria-label=${translateText("weapons.title")}
      >
        ${WEAPON_IDS.map((id) => {
          const spec = WEAPONS[id];
          const affordable = this.gold >= spec.cost;
          const usable = this.ready[id] > 0 && affordable;
          const active = aiming === id;
          const reason =
            this.owned[id] === 0
              ? translateText(NEEDS_KEYS[id])
              : this.ready[id] === 0
                ? translateText("weapons.reloading")
                : !affordable
                  ? translateText("weapons.need_gold")
                  : translateText("weapons.tap_target");
          return html`
            <button
              class="relative w-14 h-14 rounded-xl border text-white backdrop-blur-md transition-all duration-150 touch-manipulation flex flex-col items-center justify-center leading-none
                ${
                active
                  ? "bg-red-600/90 border-red-300 scale-105 shadow-lg shadow-red-900/50"
                  : usable
                    ? "bg-zinc-900/85 border-white/15 hover:bg-zinc-800/95 active:scale-95"
                    : "bg-zinc-900/60 border-white/5 opacity-50"
              }"
              ?disabled=${!usable && !active}
              title=${`${translateText(NAME_KEYS[id])} — ${renderNumber(spec.cost)} · ${reason}`}
              aria-pressed=${active}
              @click=${() => this.toggle(id)}
            >
              <span class="text-xl">${ICONS[id]}</span>
              <span class="text-[10px] font-semibold mt-1 text-amber-300"
                >${renderNumber(spec.cost)}</span
              >
              ${
                this.owned[id] > 0
                  ? html`<span
                      class="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full text-[10px] font-bold flex items-center justify-center
                      ${this.ready[id] > 0 ? "bg-emerald-500" : "bg-zinc-600"}"
                      >${this.ready[id]}</span
                    >`
                  : ""
              }
            </button>
          `;
        })}
        ${
          aiming
            ? html`<div
                class="mt-1 max-w-36 rounded-lg bg-black/70 px-2 py-1 text-[11px] text-white"
              >
                ${translateText("weapons.aim_hint", {
                  weapon: translateText(NAME_KEYS[aiming]),
                })}
              </div>`
            : ""
        }
      </div>
    `;
  }
}
