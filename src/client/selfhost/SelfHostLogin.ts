/**
 * Full-screen login for self-hosted servers. Shown before the menu when the
 * player has no valid session; reloads the page after a successful login so
 * every part of the app starts with the account in place.
 */

import { assetUrl } from "@laukolaroser/shared/AssetUrls";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../Utils";
import {
  login,
  maxDevices,
  registrationOpen,
  requestAccess,
} from "./SelfHostSession";

@customElement("selfhost-login")
export class SelfHostLogin extends LitElement {
  @state() private error = "";
  @state() private busy = false;
  /** "login" or "request" (ask the admin for an account). */
  @state() private mode: "login" | "request" = "login";
  @state() private notice = "";

  createRenderRoot() {
    return this;
  }

  private async submit(e: Event) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const data = new FormData(form);
    const username = String(data.get("username") ?? "").trim();
    const password = String(data.get("password") ?? "");
    if (!username || !password) {
      this.error = translateText("selfhost.fill_both");
      return;
    }
    this.busy = true;
    this.error = "";
    this.notice = "";
    try {
      if (this.mode === "request") {
        await requestAccess(username, password);
        this.notice = translateText("selfhost.request_sent");
        this.mode = "login";
        this.busy = false;
        return;
      }
      await login(username, password);
      location.reload();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.busy = false;
    }
  }

  render() {
    return html`
      <div
        class="fixed inset-0 z-[100000] flex items-center justify-center bg-zinc-950/95 backdrop-blur-sm p-4"
      >
        <form
          class="w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-900/90 p-6 shadow-2xl text-white"
          @submit=${(e: Event) => this.submit(e)}
        >
          <img
            src=${assetUrl("images/LaukolaroserLogo.svg")}
            alt="Laukolaroser"
            class="mx-auto mb-5 h-10"
          />
          <h1 class="mb-1 text-center text-lg font-bold">
            ${
              this.mode === "request"
                ? translateText("selfhost.request_title")
                : translateText("selfhost.login_title")
            }
          </h1>
          <p class="mb-5 text-center text-sm text-white/60">
            ${
              this.mode === "request"
                ? translateText("selfhost.request_hint")
                : translateText("selfhost.login_hint")
            }
          </p>
          <label
            class="mb-1 block text-xs font-semibold uppercase tracking-wide text-white/60"
            >${translateText("selfhost.username")}</label
          >
          <input
            name="username"
            autocomplete="username"
            autocapitalize="none"
            spellcheck="false"
            class="mb-4 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2.5 text-base outline-none focus:border-sky-400"
          />
          <label
            class="mb-1 block text-xs font-semibold uppercase tracking-wide text-white/60"
            >${translateText("selfhost.password")}</label
          >
          <input
            name="password"
            type="password"
            autocomplete=${this.mode === "request" ? "new-password" : "current-password"}
            class="mb-4 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2.5 text-base outline-none focus:border-sky-400"
          />
          ${
            this.notice
              ? html`<p
                  class="mb-3 rounded-lg bg-emerald-500/15 px-3 py-2 text-sm text-emerald-300"
                >
                  ${this.notice}
                </p>`
              : ""
          }
          ${
            this.error
              ? html`<p
                  class="mb-3 rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300"
                >
                  ${this.error}
                </p>`
              : ""
          }
          <button
            type="submit"
            ?disabled=${this.busy}
            class="w-full rounded-lg bg-sky-600 py-2.5 font-bold uppercase tracking-wide transition hover:bg-sky-500 disabled:opacity-60"
          >
            ${
              this.busy
                ? translateText("selfhost.signing_in")
                : this.mode === "request"
                  ? translateText("selfhost.send_request")
                  : translateText("selfhost.sign_in")
            }
          </button>
          ${
            registrationOpen()
              ? html`<button
                  type="button"
                  class="mt-3 w-full rounded-lg border border-white/15 py-2 text-sm text-white/80 hover:bg-white/10"
                  @click=${() => {
                    this.mode = this.mode === "login" ? "request" : "login";
                    this.error = "";
                  }}
                >
                  ${
                    this.mode === "login"
                      ? translateText("selfhost.request_access")
                      : translateText("selfhost.back_to_login")
                  }
                </button>`
              : html`<p class="mt-4 text-center text-xs text-white/40">
                  ${translateText("selfhost.no_account")}
                </p>`
          }
          <p class="mt-3 text-center text-[11px] text-white/35">
            ${translateText("selfhost.device_note", { max: maxDevices() })}
          </p>
        </form>
      </div>
    `;
  }
}
