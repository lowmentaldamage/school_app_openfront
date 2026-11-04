import {
  BuildableUnit,
  BuildMenus,
  Gold,
  PlayerBuildableUnitType,
  UnitType,
} from "@laukolaroser/engine-api/game/GameTypes";
import { renderNumber } from "@laukolaroser/engine-lib/Format";
import { EventBus } from "@laukolaroser/shared/EventBus";
import { html, LitElement, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { Controller } from "../../Controller";
import { InputHandler, ToggleStructureEvent } from "../../InputHandler";
import { KeyboardLayoutController } from "../../KeyboardLayout";
import { UIState } from "../../UIState";
import { UserSettings } from "../../UserSettings";
import { resolveKeybindLabel, translateText } from "../../Utils";
import { GameView } from "../../view";
import { buildHelp, stackingTip } from "../BuildHelp";
import {
  airbaseIcon,
  radarIcon,
  fortIcon,
  coastalBatteryIcon,
  seaMineIcon,
  armoredTrainIcon,
  atomBombIcon,
  battleshipIcon,
  carrierIcon,
  cityIcon,
  defensePostIcon,
  destroyerIcon,
  factoryIcon,
  goldCoinIcon,
  goldMineIcon,
  hydrogenBombIcon,
  marketIcon,
  mirvIcon,
  missileSiloIcon,
  oilRigIcon,
  portIcon,
  railSamIcon,
  samLauncherIcon,
  submarineIcon,
  troopTrainIcon,
  warshipIcon,
} from "../HotbarIcons";
import { TutorialHighlight, TutorialHighlightEvent } from "../Tutorial";

@customElement("unit-display")
export class UnitDisplay extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public uiState: UIState;
  public inputHandler: InputHandler;
  private playerBuildables: BuildableUnit[] | null = null;
  private keybinds: Record<string, { value: string; key: string }> = {};
  private keyboardLayout = new KeyboardLayoutController(this);
  private _cities = 0;
  private _warships = 0;
  private _destroyers = 0;
  private _battleships = 0;
  private _submarines = 0;
  private _carriers = 0;
  private _armoredTrains = 0;
  private _troopTrains = 0;
  private _railSams = 0;
  private _goldMines = 0;
  private _markets = 0;
  private _oilRigs = 0;
  private _airbases = 0;
  private _radars = 0;
  private _forts = 0;
  private _batteries = 0;
  private _mines = 0;
  private _factories = 0;
  private _missileSilo = 0;
  private _port = 0;
  private _defensePost = 0;
  private _samLauncher = 0;
  private allDisabled = false;
  private _hoveredUnit: PlayerBuildableUnitType | null = null;
  private tutorialHighlight: PlayerBuildableUnitType | null = null;

  createRenderRoot() {
    return this;
  }

  init() {
    const config = this.game.config();
    const userSettings = new UserSettings();

    this.keybinds = userSettings.parsedUserKeybinds();

    this.allDisabled = BuildMenus.types.every((u) => config.isUnitDisabled(u));
    // The bar is hidden on small screens, where the radial menu builds, but
    // the onboarding tutorial fires its atom bomb from here on every screen.
    if (config.gameConfig().tutorial) this.classList.remove("hidden");

    const highlightUnits: Partial<
      Record<TutorialHighlight, PlayerBuildableUnitType>
    > = {
      city: UnitType.City,
      port: UnitType.Port,
      defense_post: UnitType.DefensePost,
      factory: UnitType.Factory,
      warship: UnitType.Warship,
      silo: UnitType.MissileSilo,
      atom: UnitType.AtomBomb,
      hydrogen: UnitType.HydrogenBomb,
      mirv: UnitType.MIRV,
      sam: UnitType.SAMLauncher,
    };
    this.eventBus.on(TutorialHighlightEvent, (e) => {
      this.tutorialHighlight = (e.target && highlightUnits[e.target]) ?? null;
      this.requestUpdate();
    });
    this.requestUpdate();
  }

  private cost(item: UnitType): Gold {
    for (const bu of this.playerBuildables ?? []) {
      if (bu.type === item) {
        return bu.cost;
      }
    }
    return 0n;
  }

  private canBuild(item: UnitType): boolean {
    if (this.game?.config().isUnitDisabled(item)) return false;
    const player = this.game?.myPlayer();
    switch (item) {
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
      case UnitType.MIRV:
        return (
          this.cost(item) <= (player?.gold() ?? 0n) &&
          (player?.units(UnitType.MissileSilo).length ?? 0) > 0
        );
      case UnitType.Warship:
      case UnitType.Destroyer:
      case UnitType.Battleship:
      case UnitType.Submarine:
      case UnitType.Carrier:
        return (
          this.cost(item) <= (player?.gold() ?? 0n) &&
          (player?.units(UnitType.Port).length ?? 0) > 0
        );
      default:
        return this.cost(item) <= (player?.gold() ?? 0n);
    }
  }

  tick() {
    const player = this.game?.myPlayer();
    if (!player) return;
    player
      .buildables(undefined, BuildMenus.types)
      .then((buildables) => {
        this.playerBuildables = buildables;
      })
      .catch((error) => console.warn("Failed to refresh unit costs", error));
    this._cities = player.totalUnitLevels(UnitType.City);
    this._missileSilo = player.totalUnitLevels(UnitType.MissileSilo);
    this._port = player.totalUnitLevels(UnitType.Port);
    this._defensePost = player.totalUnitLevels(UnitType.DefensePost);
    this._samLauncher = player.totalUnitLevels(UnitType.SAMLauncher);
    this._factories = player.totalUnitLevels(UnitType.Factory);
    this._warships = player.totalUnitLevels(UnitType.Warship);
    this._destroyers = player.totalUnitLevels(UnitType.Destroyer);
    this._battleships = player.totalUnitLevels(UnitType.Battleship);
    this._submarines = player.totalUnitLevels(UnitType.Submarine);
    this._carriers = player.totalUnitLevels(UnitType.Carrier);
    this._armoredTrains = player.totalUnitLevels(UnitType.ArmoredTrain);
    this._troopTrains = player.totalUnitLevels(UnitType.TroopTrain);
    this._railSams = player.totalUnitLevels(UnitType.RailSAM);
    this._goldMines = player.totalUnitLevels(UnitType.GoldMine);
    this._markets = player.totalUnitLevels(UnitType.Market);
    this._oilRigs = player.totalUnitLevels(UnitType.OilRig);
    this._airbases = player.totalUnitLevels(UnitType.Airbase);
    this._radars = player.totalUnitLevels(UnitType.RadarStation);
    this._forts = player.totalUnitLevels(UnitType.Fort);
    this._batteries = player.totalUnitLevels(UnitType.CoastalBattery);
    this._mines = player.units(UnitType.SeaMine).length;
    this.requestUpdate();
  }

  render() {
    const myPlayer = this.game?.myPlayer();
    if (
      !this.game ||
      !myPlayer ||
      this.game.inSpawnPhase() ||
      !myPlayer.isAlive()
    ) {
      return null;
    }
    if (this.allDisabled) {
      return null;
    }
    // The onboarding tutorial's one build is the atom bomb, fired from the
    // nation's silo once captured.
    if (
      this.game.config().gameConfig().tutorial &&
      myPlayer.units(UnitType.MissileSilo).length === 0
    ) {
      return null;
    }

    return html`
      <div
        class="border-t border-white/10 px-1 py-1 w-full flex flex-col gap-1"
      >
        <div class="flex items-center gap-1 w-fit mx-auto">
          <span
            class="w-14 shrink-0 text-[9px] font-bold uppercase tracking-[0.15em] text-sky-400 flex items-center gap-1"
            >${translateText("unit_display.group_build")}<button
              class="w-4 h-4 rounded-full text-[9px] leading-none border ${this.helpOn() ? "bg-sky-500 border-sky-300 text-white" : "border-white/30 text-white/60"}"
              title=${translateText("build_help.toggle")}
              aria-pressed=${this.helpOn()}
              @click=${() => this.toggleHelp()}
            >
              ?
            </button></span
          >
          ${this.renderUnitItem(
            cityIcon,
            this._cities,
            UnitType.City,
            "city",
            this.getHotkey("buildCity", "Digit1"),
          )}
          ${this.renderUnitItem(
            factoryIcon,
            this._factories,
            UnitType.Factory,
            "factory",
            this.getHotkey("buildFactory", "Digit2"),
          )}
          ${this.renderUnitItem(
            portIcon,
            this._port,
            UnitType.Port,
            "port",
            this.getHotkey("buildPort", "Digit3"),
          )}
          ${this.renderUnitItem(
            defensePostIcon,
            this._defensePost,
            UnitType.DefensePost,
            "defense_post",
            this.getHotkey("buildDefensePost", "Digit4"),
          )}
          ${this.renderUnitItem(
            missileSiloIcon,
            this._missileSilo,
            UnitType.MissileSilo,
            "missile_silo",
            this.getHotkey("buildMissileSilo", "Digit5"),
          )}
          ${this.renderUnitItem(
            samLauncherIcon,
            this._samLauncher,
            UnitType.SAMLauncher,
            "sam_launcher",
            this.getHotkey("buildSamLauncher", "Digit6"),
          )}
          ${this.renderUnitItem(
            goldMineIcon,
            this._goldMines,
            UnitType.GoldMine,
            "gold_mine",
            "",
          )}
          ${this.renderUnitItem(
            marketIcon,
            this._markets,
            UnitType.Market,
            "market",
            "",
          )}
          ${this.renderUnitItem(
            oilRigIcon,
            this._oilRigs,
            UnitType.OilRig,
            "oil_rig",
            "",
          )}
          ${this.renderUnitItem(
            airbaseIcon,
            this._airbases,
            UnitType.Airbase,
            "airbase",
            "",
          )}
          ${this.renderUnitItem(
            radarIcon,
            this._radars,
            UnitType.RadarStation,
            "radar_station",
            "",
          )}
          ${this.renderUnitItem(fortIcon, this._forts, UnitType.Fort, "fort", "")}
          ${this.renderUnitItem(
            coastalBatteryIcon,
            this._batteries,
            UnitType.CoastalBattery,
            "coastal_battery",
            "",
          )}
          ${this.renderUnitItem(
            seaMineIcon,
            this._mines,
            UnitType.SeaMine,
            "sea_mine",
            "",
          )}
        </div>
        <div class="flex items-center gap-1 w-fit mx-auto">
          <span
            class="w-14 shrink-0 text-[9px] font-bold uppercase tracking-[0.15em] text-sky-400"
            >${translateText("unit_display.group_forces")}</span
          >
          ${this.renderUnitItem(
            warshipIcon,
            this._warships,
            UnitType.Warship,
            "warship",
            this.getHotkey("buildWarship", "Digit7"),
          )}
          ${this.renderUnitItem(
            destroyerIcon,
            this._destroyers,
            UnitType.Destroyer,
            "destroyer",
            "",
          )}
          ${this.renderUnitItem(
            battleshipIcon,
            this._battleships,
            UnitType.Battleship,
            "battleship",
            "",
          )}
          ${this.renderUnitItem(
            submarineIcon,
            this._submarines,
            UnitType.Submarine,
            "submarine",
            "",
          )}
          ${this.renderUnitItem(
            carrierIcon,
            this._carriers,
            UnitType.Carrier,
            "carrier",
            "",
          )}
          ${this.renderUnitItem(
            armoredTrainIcon,
            this._armoredTrains,
            UnitType.ArmoredTrain,
            "armored_train",
            "",
          )}
          ${this.renderUnitItem(
            troopTrainIcon,
            this._troopTrains,
            UnitType.TroopTrain,
            "troop_train",
            "",
          )}
          ${this.renderUnitItem(
            railSamIcon,
            this._railSams,
            UnitType.RailSAM,
            "rail_sam",
            "",
          )}
          ${this.renderUnitItem(
            atomBombIcon,
            null,
            UnitType.AtomBomb,
            "atom_bomb",
            this.getHotkey("buildAtomBomb", "Digit8"),
          )}
          ${this.renderUnitItem(
            hydrogenBombIcon,
            null,
            UnitType.HydrogenBomb,
            "hydrogen_bomb",
            this.getHotkey("buildHydrogenBomb", "Digit9"),
          )}
          ${this.renderUnitItem(
            mirvIcon,
            null,
            UnitType.MIRV,
            "mirv",
            this.getHotkey("buildMIRV", "Digit0"),
          )}
        </div>
      </div>
    `;
  }

  private getHotkey(action: string, defaultCode: string): string {
    return resolveKeybindLabel(
      this.keybinds[action],
      defaultCode,
      this.keyboardLayout.map,
    );
  }

  private helpSettings = new UserSettings();

  private helpOn(): boolean {
    return this.helpSettings.buildBarHelp();
  }

  private toggleHelp(): void {
    this.helpSettings.toggleBuildBarHelp();
    this.requestUpdate();
  }

  /** Detailed "how to use" + exact numbers (toggle with the ? button). */
  private renderHelp(unitType: UnitType) {
    if (!this.helpOn()) return nothing;
    const info = buildHelp(unitType, this.game.config());
    if (info === null) return nothing;
    return html`<div
      class="mx-1 mb-1 px-2 py-1.5 text-left text-[11px] max-w-72 whitespace-normal rounded bg-black/40 border border-white/10"
    >
      <div class="text-sky-300 mb-1">${info.use}</div>
      ${info.stats.map(
        (s) =>
          html`<div class="flex justify-between gap-3">
            <span class="text-white/60">${s.label}</span
            ><span class="font-semibold text-white">${s.value}</span>
          </div>`,
      )}
      <div class="mt-1 text-[10px] text-white/50">${stackingTip(unitType)}</div>
    </div>`;
  }

  private renderUnitItem(
    icon: string,
    number: number | null,
    unitType: PlayerBuildableUnitType,
    structureKey: string,
    hotkey: string,
  ) {
    if (
      this.game.config().isUnitDisabled(unitType) ||
      (this.game.config().gameConfig().tutorial &&
        unitType !== UnitType.AtomBomb)
    ) {
      return html``;
    }
    const selected = this.uiState.ghostStructure === unitType;
    const hovered = this._hoveredUnit === unitType;
    const displayHotkey = hotkey
      .replace("Digit", "")
      .replace("Key", "")
      .toUpperCase();

    return html`
      <div
        class="flex flex-col items-center relative"
        @mouseenter=${() => {
          this._hoveredUnit = unitType;
          this.requestUpdate();
        }}
        @mouseleave=${() => {
          this._hoveredUnit = null;
          this.requestUpdate();
        }}
      >
        ${
          hovered
            ? html`
                <div
                  class="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 text-gray-200 text-center w-max text-xs bg-gray-800/90 backdrop-blur-xs rounded-sm p-1 z-[100] shadow-lg pointer-events-none"
                >
                  <div class="font-bold text-sm mb-1">
                    ${translateText("unit_type." + structureKey)}${
                      hotkey ? ` [${displayHotkey}]` : ""
                    }
                  </div>
                  <div class="p-2 max-w-72 whitespace-normal">
                    ${translateText("build_menu.desc." + structureKey)}
                  </div>
                  ${this.renderHelp(unitType)}
                  ${
                    unitType === UnitType.Warship
                      ? html`<div
                          class="mt-1 px-2 py-1 text-[10px] text-cyan-300 border-t border-white/10"
                        >
                          ⇧ ${translateText("build_menu.warship_shift_hint")}
                        </div>`
                      : null
                  }
                  <div class="flex items-center justify-center gap-1">
                    <img src=${goldCoinIcon} width="13" height="13" />
                    <span class="text-yellow-300"
                      >${renderNumber(this.cost(unitType))}</span
                    >
                  </div>
                </div>
              `
            : null
        }
        <div
          class="${
            this.canBuild(unitType) ? "" : "opacity-40"
          } border border-slate-500 rounded-sm px-0.5 pb-0.5 flex items-center gap-0.5 cursor-pointer
             ${selected ? "hover:bg-gray-400/10" : "hover:bg-gray-800"}
             rounded-sm text-white ${selected ? "bg-slate-400/20" : ""}
             ${this.tutorialHighlight === unitType ? "tutorial-highlight" : ""}"
          @click=${() => {
            if (selected) {
              this.inputHandler.setGhostStructure(null);
            } else if (this.canBuild(unitType)) {
              this.inputHandler.setGhostStructure(unitType, "GUIclick");
            }
            this.requestUpdate();
          }}
          @mouseenter=${() => {
            switch (unitType) {
              case UnitType.AtomBomb:
              case UnitType.HydrogenBomb:
                this.eventBus?.emit(
                  new ToggleStructureEvent([
                    UnitType.MissileSilo,
                    UnitType.SAMLauncher,
                  ]),
                );
                break;
              case UnitType.Warship:
              case UnitType.Destroyer:
              case UnitType.Battleship:
              case UnitType.Submarine:
              case UnitType.Carrier:
                this.eventBus?.emit(new ToggleStructureEvent([UnitType.Port]));
                break;
              case UnitType.ArmoredTrain:
              case UnitType.TroopTrain:
              case UnitType.RailSAM:
                this.eventBus?.emit(
                  new ToggleStructureEvent([
                    UnitType.City,
                    UnitType.Port,
                    UnitType.Factory,
                  ]),
                );
                break;
              default:
                this.eventBus?.emit(new ToggleStructureEvent([unitType]));
            }
          }}
          @mouseleave=${() =>
            this.eventBus?.emit(new ToggleStructureEvent(null))}
        >
          ${
            hotkey
              ? html`<div
                  class="ml-0.5 text-[10px] relative -top-1 text-gray-400"
                >
                  ${displayHotkey}
                </div>`
              : nothing
          }
          <div class="flex items-center gap-0.5 pt-0.5">
            <img src=${icon} alt=${structureKey} class="align-middle size-6" />
            ${
              number !== null
                ? html`<span class="text-xs">${renderNumber(number)}</span>`
                : null
            }
          </div>
        </div>
      </div>
    `;
  }
}
