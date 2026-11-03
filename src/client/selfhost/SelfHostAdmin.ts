/**
 * Admin panel for self-hosted servers: approve access requests, add
 * players with a password, reset passwords, make admin, disable or remove,
 * free device slots, and see each player's stats. Only reachable for
 * admins (the server checks every call as well).
 */

import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../Utils";
import { adminApi, currentSession, type SelfHostUser } from "./SelfHostSession";

@customElement("selfhost-admin")
export class SelfHostAdmin extends LitElement {
  @state() private open = false;
  @state() private users: SelfHostUser[] = [];
  @state() private maxAccounts = 0;
  @state() private maxDevices = 2;
  @state() private message = "";
  @state() private error = "";

  createRenderRoot() {
    return this;
  }

  async show() {
    this.open = true;
    await this.refresh();
  }

  private close() {
    this.open = false;
    this.message = "";
    this.error = "";
  }

  private async refresh() {
    try {
      const r = await adminApi.list();
      // Requests first, then by name.
      this.users = [...r.users].sort(
        (a, b) =>
          Number(b.pending) - Number(a.pending) ||
          a.username.localeCompare(b.username),
      );
      this.maxAccounts = r.maxAccounts;
      this.maxDevices = r.maxDevices;
    } catch (e) {
      this.error = (e as Error).message;
    }
  }

  private async run(action: () => Promise<unknown>, done: string) {
    this.error = "";
    this.message = "";
    try {
      await action();
      this.message = done;
      await this.refresh();
    } catch (e) {
      this.error = (e as Error).message;
    }
  }

  private async add(e: Event) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const d = new FormData(form);
    const username = String(d.get("username") ?? "").trim();
    const password = String(d.get("password") ?? "");
    const role = d.get("admin") ? "admin" : "player";
    await this.run(
      () => adminApi.create(username, password, role),
      translateText("selfhost.added", { name: username }),
    );
    if (!this.error) form.reset();
  }

  private resetPassword(u: SelfHostUser) {
    const pw = prompt(
      translateText("selfhost.new_password_for", { name: u.username }),
    );
    if (!pw) return;
    void this.run(
      () => adminApi.resetPassword(u.username, pw),
      translateText("selfhost.password_reset", { name: u.username }),
    );
  }

  private removeUser(u: SelfHostUser) {
    if (
      !confirm(translateText("selfhost.confirm_remove", { name: u.username }))
    )
      return;
    void this.run(
      () => adminApi.remove(u.username),
      translateText("selfhost.removed", { name: u.username }),
    );
  }

  render() {
    if (!this.open) return html``;
    const me = currentSession()?.username.toLowerCase();
    const btn =
      "rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs hover:bg-white/15 transition";
    return html`
      <div
        class="fixed inset-0 z-[100001] flex items-center justify-center bg-black/70 p-3"
        @click=${(e: Event) => e.target === e.currentTarget && this.close()}
      >
        <div
          class="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 text-white shadow-2xl"
        >
          <div
            class="flex items-center justify-between border-b border-white/10 px-5 py-3"
          >
            <h2 class="text-lg font-bold">
              ${translateText("selfhost.admin_title")}
              <span class="ml-2 text-sm font-normal text-white/50"
                >${translateText("selfhost.account_count", {
                  count: this.users.length,
                  max: this.maxAccounts,
                })}</span
              >
            </h2>
            <button
              class="text-2xl leading-none text-white/60 hover:text-white"
              @click=${() => this.close()}
            >
              ×
            </button>
          </div>

          <form
            class="grid gap-2 border-b border-white/10 p-5 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end"
            @submit=${(e: Event) => this.add(e)}
          >
            <input
              name="username"
              placeholder=${translateText("selfhost.username")}
              autocapitalize="none"
              class="rounded-lg border border-white/15 bg-black/40 px-3 py-2 outline-none focus:border-sky-400"
            />
            <input
              name="password"
              placeholder=${translateText("selfhost.password")}
              class="rounded-lg border border-white/15 bg-black/40 px-3 py-2 outline-none focus:border-sky-400"
            />
            <label class="flex items-center gap-1.5 text-sm text-white/80">
              <input type="checkbox" name="admin" />
              ${translateText("selfhost.admin")}
            </label>
            <button
              class="rounded-lg bg-emerald-600 px-4 py-2 font-semibold hover:bg-emerald-500"
            >
              ${translateText("selfhost.add_player")}
            </button>
          </form>

          ${this.error ? html`<p class="mx-5 mt-3 rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300">${this.error}</p>` : ""}
          ${this.message ? html`<p class="mx-5 mt-3 rounded-lg bg-emerald-500/15 px-3 py-2 text-sm text-emerald-300">${this.message}</p>` : ""}

          <div class="overflow-y-auto p-5">
            <table class="w-full text-sm">
              <thead class="text-left text-xs uppercase text-white/50">
                <tr>
                  <th class="pb-2">${translateText("selfhost.username")}</th>
                  <th class="pb-2">${translateText("selfhost.role")}</th>
                  <th class="pb-2">${translateText("selfhost.devices")}</th>
                  <th class="pb-2">${translateText("selfhost.stats")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${this.users.map(
                  (u) => html`
                    <tr
                      class="border-t border-white/5 ${u.disabled ? "opacity-50" : ""}"
                    >
                      <td class="py-2 font-semibold">${u.username}</td>
                      <td class="py-2">
                        ${u.pending ? html`<span class="rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-300">${translateText("selfhost.pending")}</span>` : u.role === "admin" ? translateText("selfhost.admin") : translateText("selfhost.player")}${u.disabled && !u.pending ? ` · ${translateText("selfhost.disabled")}` : ""}
                      </td>
                      <td
                        class="py-2 text-xs text-white/70"
                        title=${u.devices.map((d) => `${d.name} · ${new Date(d.lastSeen).toLocaleString()}`).join("\n")}
                      >
                        ${u.devices.length}/${this.maxDevices}
                      </td>
                      <td class="py-2 text-xs text-white/70">
                        ${translateText("selfhost.stats_line", {
                          wins: u.stats.wins + u.stats.soloWins,
                          games: u.stats.games + u.stats.soloGames,
                          hours: (u.stats.playSeconds / 3600).toFixed(1),
                        })}
                      </td>
                      <td class="py-2 text-right">
                        <div class="flex flex-wrap justify-end gap-1">
                          ${
                            u.pending
                              ? html`<button
                                  class="${btn} bg-emerald-600/60 hover:bg-emerald-500"
                                  @click=${() => void this.run(() => adminApi.approve(u.username), translateText("selfhost.approved", { name: u.username }))}
                                >
                                  ${translateText("selfhost.approve")}
                                </button>`
                              : ""
                          }
                          ${
                            u.devices.length > 0
                              ? html`<button
                                  class=${btn}
                                  @click=${() => void this.run(() => adminApi.resetDevices(u.username), translateText("selfhost.devices_reset", { name: u.username }))}
                                >
                                  ${translateText("selfhost.reset_devices")}
                                </button>`
                              : ""
                          }
                          <button
                            class=${btn}
                            @click=${() => this.resetPassword(u)}
                          >
                            ${translateText("selfhost.reset_password")}
                          </button>
                          ${
                            u.username.toLowerCase() === me
                              ? ""
                              : html`
                                  <button
                                    class=${btn}
                                    @click=${() => void this.run(() => adminApi.setRole(u.username, u.role === "admin" ? "player" : "admin"), translateText("selfhost.updated", { name: u.username }))}
                                  >
                                    ${u.role === "admin" ? translateText("selfhost.make_player") : translateText("selfhost.make_admin")}
                                  </button>
                                  <button
                                    class=${btn}
                                    @click=${() => void this.run(() => adminApi.setDisabled(u.username, !u.disabled), translateText("selfhost.updated", { name: u.username }))}
                                  >
                                    ${u.disabled ? translateText("selfhost.enable") : translateText("selfhost.disable")}
                                  </button>
                                  <button
                                    class="${btn} text-red-300"
                                    @click=${() => this.removeUser(u)}
                                  >
                                    ${translateText("selfhost.remove")}
                                  </button>
                                `
                          }
                        </div>
                      </td>
                    </tr>
                  `,
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }
}
