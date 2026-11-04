/**
 * Maps saved from the map editor, shown under the built-in map picker in
 * the solo and lobby setups. Selecting one plays it; admins (or anyone on
 * a server without accounts) can delete maps here.
 */

import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  canDeleteCustomMaps,
  type CustomMapInfo,
  customMapThumbnail,
  deleteCustomMap,
  listCustomMaps,
} from "../maps/CustomMapsApi";
import { translateText } from "../Utils";

@customElement("custom-map-list")
export class CustomMapList extends LitElement {
  @property({ attribute: false }) selectedId: string | null = null;
  @property({ attribute: false }) onSelect: (
    map: CustomMapInfo | null,
  ) => void = () => {};
  @state() private maps: CustomMapInfo[] = [];
  @state() private error = "";

  createRenderRoot() {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    this.maps = await listCustomMaps(true);
  }

  private async deleteMap(m: CustomMapInfo, e: Event): Promise<void> {
    e.stopPropagation();
    if (!confirm(translateText("custom_maps.confirm_delete", { name: m.name })))
      return;
    try {
      await deleteCustomMap(m.id);
      if (this.selectedId === m.id) this.onSelect(null);
      await this.refresh();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }

  private uploadImage = () => {
    void import("../mapeditor/MapEditor").then((m) =>
      m.openMapEditor({ upload: true }),
    );
  };

  private openEditor = () => {
    void import("../mapeditor/MapEditor").then((m) => m.openMapEditor());
  };

  render() {
    const canDelete = canDeleteCustomMaps();
    return html`<div class="mb-4 flex flex-col gap-2">
      <div class="flex items-center justify-between gap-2">
        <h4 class="text-sm font-bold uppercase tracking-wider text-white/70">
          ${translateText("custom_maps.title")}
        </h4>
        <div class="flex gap-2">
          <button
            class="rounded-lg bg-sky-700 px-3 py-1 text-xs font-bold uppercase tracking-wider text-white hover:bg-sky-600"
            @click=${this.uploadImage}
          >
            📤 ${translateText("custom_maps.upload")}
          </button>
          <button
            class="rounded-lg bg-sky-700 px-3 py-1 text-xs font-bold uppercase tracking-wider text-white hover:bg-sky-600"
            @click=${this.openEditor}
          >
            ✏️ ${translateText("custom_maps.open_editor")}
          </button>
        </div>
      </div>
      ${
        this.error
          ? html`<p class="text-xs text-red-300">${this.error}</p>`
          : nothing
      }
      ${
        this.maps.length === 0
          ? html`<p class="text-xs text-white/50">
              ${translateText("custom_maps.none")}
            </p>`
          : html`<div
              class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
            >
              ${this.maps.map((m) => {
                const selected = m.id === this.selectedId;
                return html`<div
                  role="button"
                  tabindex="0"
                  class="relative flex cursor-pointer flex-col overflow-hidden rounded-lg border text-left ${
                    selected
                      ? "border-sky-400 bg-sky-500/20"
                      : "border-white/10 bg-white/5 hover:border-white/30"
                  }"
                  @click=${() => this.onSelect(selected ? null : m)}
                  @keydown=${(e: KeyboardEvent) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      this.onSelect(selected ? null : m);
                    }
                  }}
                >
                  <img
                    class="aspect-[4/3] w-full bg-slate-800 object-cover"
                    src=${customMapThumbnail(m.id)}
                    alt=""
                    loading="lazy"
                    @error=${(e: Event) =>
                      ((e.target as HTMLImageElement).style.visibility =
                        "hidden")}
                  />
                  <div class="px-2 py-1">
                    <div class="truncate text-sm font-bold text-white">
                      ${m.name}
                    </div>
                    <div class="truncate text-[11px] text-white/50">
                      ${m.width}×${m.height} ·
                      ${translateText("custom_maps.nations", { n: m.nations })}
                      ${m.author ? html` · ${m.author}` : nothing}
                    </div>
                  </div>
                  ${
                    canDelete
                      ? html`<button
                          class="absolute right-1 top-1 rounded bg-black/70 px-1.5 text-xs text-red-300 hover:text-red-200"
                          title=${translateText("custom_maps.delete")}
                          @click=${(e: Event) => void this.deleteMap(m, e)}
                        >
                          ✕
                        </button>`
                      : nothing
                  }
                </div>`;
              })}
            </div>`
      }
    </div>`;
  }
}
