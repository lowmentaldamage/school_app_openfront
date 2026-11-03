/**
 * ResearchPanel — the tech tree.
 *
 * A Research button (bottom-left, key I by default) shows the project in
 * progress; it opens a full-screen tree: four branches × three tiers.
 * Each card shows the effect, price, time and status; tapping an
 * available one sends a research intent. Rules come from the shared
 * engine-lib tech specs, so the panel agrees with the simulation.
 */

import { renderNumber } from "@laukolaroser/engine-lib/Format";
import {
  researchBlock,
  type TechBranch,
  type TechId,
  TECHS,
  techSpec,
} from "@laukolaroser/engine-lib/tech/Tech";
import { EventBus } from "@laukolaroser/shared/EventBus";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Controller } from "../../Controller";
import { ToggleResearchPanelEvent } from "../../InputHandler";
import { ResearchIntentEvent } from "../../Transport";
import { translateText } from "../../Utils";
import { GameView } from "../../view";

const BRANCHES: readonly TechBranch[] = ["army", "navy", "air", "economy"];
const BRANCH_ICONS: Record<TechBranch, string> = {
  army: "🪖",
  navy: "⚓",
  air: "✈️",
  economy: "💰",
};

@customElement("research-panel")
export class ResearchPanel extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;

  @state() private open = false;
  @state() private visible = false;
  @state() private mask = 0;
  @state() private research: { tech: TechId; endsAt: number } | null = null;
  @state() private gold = 0n;
  @state() private nowTick = 0;
  /** Tech we just asked for, until the engine confirms it. */
  @state() private pending: TechId | null = null;

  createRenderRoot() {
    return this;
  }

  init() {
    this.eventBus.on(ToggleResearchPanelEvent, () => {
      if (this.visible) this.open = !this.open;
    });
  }

  tick() {
    const me = this.game?.myPlayer();
    const enabled =
      this.game?.config().gameConfig().disableTechTree !== true &&
      this.game?.config().gameConfig().tutorial !== true;
    const playing =
      enabled &&
      me !== null &&
      me !== undefined &&
      me.isAlive() &&
      !this.game.inSpawnPhase();
    this.visible = playing;
    if (!playing || !me) {
      this.open = false;
      return;
    }
    this.mask = me.techMask();
    this.research = me.research();
    this.gold = me.gold();
    this.nowTick = this.game.ticks();
    if (this.research !== null) this.pending = null;
  }

  private start(id: TechId) {
    this.pending = id;
    this.eventBus.emit(new ResearchIntentEvent(id));
  }

  private progress(): number {
    const r = this.research;
    if (r === null) return 0;
    const total = techSpec(r.tech).ticks;
    return Math.max(0, Math.min(1, 1 - (r.endsAt - this.nowTick) / total));
  }

  render() {
    if (!this.visible) return html``;
    const r = this.research;
    const pct = Math.round(this.progress() * 100);
    return html`
      <button
        class="fixed left-2 bottom-36 z-[900] w-14 h-14 rounded-xl border border-white/15 bg-zinc-900/85 text-white backdrop-blur-md hover:bg-zinc-800/95 active:scale-95 flex flex-col items-center justify-center leading-none touch-manipulation"
        title=${translateText("research.title")}
        aria-expanded=${this.open}
        @click=${() => (this.open = !this.open)}
      >
        <span class="text-xl">🔬</span>
        <span class="text-[10px] font-semibold mt-1 text-sky-300"
          >${r ? `${pct}%` : translateText("research.short")}</span
        >
        ${
          r
            ? html`<span
                class="absolute bottom-0 left-0 h-1 rounded-b-xl bg-sky-400"
                style="width:${pct}%"
              ></span>`
            : ""
        }
      </button>
      ${this.open ? this.renderTree() : ""}
    `;
  }

  private renderTree() {
    const busy = this.research?.tech ?? this.pending;
    return html`
      <div
        class="fixed inset-0 z-[1000] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3"
        @click=${(e: Event) => {
          if (e.target === e.currentTarget) this.open = false;
        }}
      >
        <div
          class="w-full max-w-4xl max-h-full overflow-y-auto rounded-2xl border border-white/10 bg-zinc-900/95 p-4 text-white"
          role="dialog"
          aria-label=${translateText("research.title")}
        >
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-lg font-bold tracking-wide uppercase">
              🔬 ${translateText("research.title")}
            </h2>
            <button
              class="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20"
              @click=${() => (this.open = false)}
            >
              ✕
            </button>
          </div>
          <p class="text-xs text-white/70 mb-3">
            ${translateText("research.hint")}
          </p>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            ${BRANCHES.map(
              (b) => html`
                <section>
                  <h3
                    class="text-xs font-bold uppercase tracking-[0.15em] text-sky-400 mb-2"
                  >
                    ${BRANCH_ICONS[b]} ${translateText(`research.branch_${b}`)}
                  </h3>
                  <div class="flex flex-col gap-2">
                    ${TECHS.filter((t) => t.branch === b).map((t) =>
                      this.renderCard(t.id, busy),
                    )}
                  </div>
                </section>
              `,
            )}
          </div>
        </div>
      </div>
    `;
  }

  private renderCard(id: TechId, busy: TechId | null) {
    const s = techSpec(id);
    const block = researchBlock(id, this.mask, busy, this.gold, true);
    const inProgress = busy === id;
    const done = block === "researched";
    const can = block === null;
    const status = inProgress
      ? `${Math.round(this.progress() * 100)}%`
      : done
        ? translateText("research.done")
        : block === "locked"
          ? translateText("research.locked")
          : block === "busy"
            ? translateText("research.busy")
            : block === "gold"
              ? translateText("research.need_gold")
              : translateText("research.start");
    return html`
      <button
        class="text-left rounded-xl border p-3 transition-all
          ${
          done
            ? "border-emerald-400/50 bg-emerald-900/30"
            : inProgress
              ? "border-sky-400 bg-sky-900/40"
              : can
                ? "border-white/20 bg-white/5 hover:bg-white/10 active:scale-[0.98]"
                : "border-white/5 bg-white/[0.02] opacity-60"
        }"
        ?disabled=${!can}
        @click=${() => this.start(id)}
      >
        <div class="flex items-center justify-between gap-2">
          <span class="font-semibold text-sm"
            >${translateText(`research.tech_${id}`)}</span
          >
          <span class="text-[10px] text-white/50">T${s.tier}</span>
        </div>
        <div class="text-xs text-white/75 mt-1">
          ${translateText(`research.tech_${id}_desc`)}
        </div>
        <div class="flex items-center justify-between mt-2 text-[11px]">
          <span class="text-amber-300"
            >${renderNumber(s.cost)} · ${Math.round(s.ticks / 10)}s</span
          >
          <span class="font-semibold ${can ? "text-sky-300" : ""}"
            >${status}</span
          >
        </div>
      </button>
    `;
  }
}
