/**
 * Account chip for self-hosted servers (bottom-left of the menu): shows who
 * is logged in, with Change password, Admin panel (admins) and Log out.
 */

import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../Utils";
import type { SelfHostAdmin } from "./SelfHostAdmin";
import {
  changeOwnPassword,
  currentSession,
  logout,
  ownStats,
} from "./SelfHostSession";

@customElement("selfhost-account")
export class SelfHostAccount extends LitElement {
  @state() private menu = false;

  createRenderRoot() {
    return this;
  }

  private async changePassword() {
    this.menu = false;
    const current = prompt(translateText("selfhost.current_password"));
    if (!current) return;
    const next = prompt(translateText("selfhost.new_password"));
    if (!next) return;
    try {
      await changeOwnPassword(current, next);
      alert(translateText("selfhost.password_changed"));
    } catch (e) {
      alert((e as Error).message);
    }
  }

  private openAdmin() {
    this.menu = false;
    const panel = document.querySelector(
      "selfhost-admin",
    ) as SelfHostAdmin | null;
    void panel?.show();
  }

  private renderStats() {
    const st = ownStats();
    if (st === null) return "";
    return html`<div
      class="border-b border-white/10 px-4 py-2 text-xs text-white/70"
    >
      ${translateText("selfhost.my_stats", {
        wins: st.wins,
        games: st.games,
        soloWins: st.soloWins,
        soloGames: st.soloGames,
        hours: (st.playSeconds / 3600).toFixed(1),
      })}
    </div>`;
  }

  render() {
    const s = currentSession();
    if (s === null) return html``;
    const item = "block w-full px-4 py-2 text-left text-sm hover:bg-white/10";
    return html`
      <div class="fixed bottom-3 left-3 z-[60] text-white [.in-game_&]:hidden">
        ${
          this.menu
            ? html`<div
                class="mb-2 min-w-48 overflow-hidden rounded-xl border border-white/10 bg-zinc-900/95 shadow-xl backdrop-blur"
              >
                ${this.renderStats()}
                <button class=${item} @click=${() => this.changePassword()}>
                  ${translateText("selfhost.change_password")}
                </button>
                ${
                  s.role === "admin"
                    ? html`<button
                        class=${item}
                        @click=${() => this.openAdmin()}
                      >
                        ${translateText("selfhost.manage_players")}
                      </button>`
                    : ""
                }
                <button
                  class="${item} text-red-300"
                  @click=${() => {
                    logout();
                    location.reload();
                  }}
                >
                  ${translateText("selfhost.log_out")}
                </button>
              </div>`
            : ""
        }
        <button
          class="flex items-center gap-2 rounded-full border border-white/15 bg-zinc-900/85 px-3 py-1.5 text-sm font-semibold shadow-lg backdrop-blur hover:bg-zinc-800"
          @click=${() => (this.menu = !this.menu)}
        >
          <span
            class="flex h-6 w-6 items-center justify-center rounded-full bg-sky-600 text-xs font-bold uppercase"
            >${s.username.slice(0, 1)}</span
          >
          ${s.username}
          ${s.role === "admin" ? html`<span class="rounded bg-amber-500/20 px-1.5 text-[10px] uppercase text-amber-300">${translateText("selfhost.admin")}</span>` : ""}
        </button>
      </div>
    `;
  }
}
