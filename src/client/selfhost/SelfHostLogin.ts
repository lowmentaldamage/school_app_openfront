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
  loginWithCode,
  maxDevices,
  registrationOpen,
  requestAccess,
  savedSessions,
  sendTelegramCode,
  switchTo,
  type TwoFactorChallenge,
} from "./SelfHostSession";

@customElement("selfhost-login")
export class SelfHostLogin extends LitElement {
  @state() private error = "";
  @state() private busy = false;
  /** "login" or "request" (ask the admin for an account). */
  @state() private mode: "login" | "request" = "login";
  @state() private notice = "";
  /** Set after the password step when the account needs a second step. */
  @state() private challenge: TwoFactorChallenge | null = null;

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
      const result = await login(username, password);
      if ("twoFactor" in result) {
        this.challenge = result;
        this.busy = false;
        return;
      }
      location.reload();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.busy = false;
    }
  }

  private async submitCode(e: Event) {
    e.preventDefault();
    const challenge = this.challenge;
    if (challenge === null) return;
    const data = new FormData(e.target as HTMLFormElement);
    const code = String(data.get("code") ?? "").replace(/\s+/g, "");
    if (!/^\d{6}$/.test(code)) {
      this.error = translateText("selfhost.code_invalid");
      return;
    }
    this.busy = true;
    this.error = "";
    try {
      await loginWithCode(challenge.ticket, code);
      location.reload();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.busy = false;
    }
  }

  private async sendTelegram() {
    const challenge = this.challenge;
    if (challenge === null) return;
    this.error = "";
    try {
      await sendTelegramCode(challenge.ticket);
      this.notice = translateText("selfhost.code_sent");
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }

  private renderMessages() {
    return html`${
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
    }`;
  }

  private renderCodeStep(challenge: TwoFactorChallenge) {
    const setup = challenge.setup;
    return html`
      <div
        class="fixed inset-0 z-[100000] flex items-center justify-center bg-zinc-950/95 backdrop-blur-sm p-4"
      >
        <form
          class="w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-900/90 p-6 shadow-2xl text-white"
          @submit=${(e: Event) => this.submitCode(e)}
        >
          <h1 class="mb-1 text-center text-lg font-bold">
            ${translateText("selfhost.code_title")}
          </h1>
          <p class="mb-4 text-center text-sm text-white/60">
            ${translateText("selfhost.code_hint")}
          </p>
          ${
            setup
              ? html`<div
                  class="mb-4 rounded-lg border border-amber-400/30 bg-amber-500/10 p-3 text-sm"
                >
                  <p class="mb-2 text-amber-200">
                    ${translateText("selfhost.setup_2fa")}
                  </p>
                  <code
                    class="mb-2 block select-all break-words rounded bg-black/40 px-2 py-1.5 font-mono text-sm tracking-wider"
                    >${setup.secret.match(/.{1,4}/g)?.join(" ")}</code
                  >
                  <a
                    href=${setup.uri}
                    class="text-sky-300 underline hover:text-sky-200"
                    >${translateText("selfhost.open_authenticator")}</a
                  >
                </div>`
              : ""
          }
          <input
            name="code"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="7"
            placeholder="123456"
            class="mb-4 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2.5 text-center font-mono text-2xl tracking-[0.4em] outline-none focus:border-sky-400"
          />
          ${this.renderMessages()}
          <button
            type="submit"
            ?disabled=${this.busy}
            class="w-full rounded-lg bg-sky-600 py-2.5 font-bold uppercase tracking-wide transition hover:bg-sky-500 disabled:opacity-60"
          >
            ${translateText("selfhost.verify")}
          </button>
          ${
            challenge.telegram
              ? html`<button
                  type="button"
                  class="mt-3 w-full rounded-lg border border-white/15 py-2 text-sm text-white/80 hover:bg-white/10"
                  @click=${() => void this.sendTelegram()}
                >
                  ${translateText("selfhost.send_telegram_code")}
                </button>`
              : ""
          }
          <button
            type="button"
            class="mt-3 w-full text-xs text-white/50 hover:text-white/80"
            @click=${() => {
              this.challenge = null;
              this.error = "";
              this.notice = "";
            }}
          >
            ${translateText("selfhost.back_to_login")}
          </button>
        </form>
      </div>
    `;
  }

  private renderSaved() {
    const saved = this.mode === "login" ? savedSessions() : [];
    if (saved.length === 0) return "";
    return html`<div class="mb-4">
      <div
        class="mb-1 text-xs font-semibold uppercase tracking-wide text-white/60"
      >
        ${translateText("selfhost.signed_in_here")}
      </div>
      <div class="flex flex-wrap gap-2">
        ${saved.map(
          (s) =>
            html`<button
              type="button"
              class="flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/15"
              @click=${() => {
                if (switchTo(s.username)) location.reload();
              }}
            >
              <span
                class="flex h-5 w-5 items-center justify-center rounded-full bg-sky-600 text-[10px] font-bold uppercase"
                >${s.username.slice(0, 1)}</span
              >
              ${s.username}
            </button>`,
        )}
      </div>
    </div>`;
  }

  render() {
    if (this.challenge !== null) return this.renderCodeStep(this.challenge);
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
          ${this.renderSaved()}
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
