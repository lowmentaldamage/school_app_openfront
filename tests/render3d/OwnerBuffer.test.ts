/**
 * Integration: the 3D territory buffer must mirror the authoritative tile
 * ownership produced by the real simulation, both on a full upload and when
 * fed only the tiles that changed each tick.
 */

import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { describe, expect, it } from "vitest";
import { OwnerBuffer } from "../../src/client/render3d/territory/OwnerBuffer";
import { setup } from "../util/Setup";

function changedRefs(prev: Uint16Array, next: Uint16Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < next.length; i++) if (prev[i] !== next[i]) out.push(i);
  return out;
}

describe("OwnerBuffer ↔ simulation", () => {
  it("tracks ownership through spawn and expansion using tile deltas", async () => {
    const game = await setup("ocean_and_land", {
      infiniteGold: true,
      infiniteTroops: true,
      instantBuild: true,
    });
    const a = new PlayerInfo("alpha", PlayerType.Human, null, "alpha_id");
    const b = new PlayerInfo("bravo", PlayerType.Human, null, "bravo_id");
    game.addPlayer(a);
    game.addPlayer(b);
    game.addExecution(
      new SpawnExecution("game_id", game.player(a.id).info(), game.ref(0, 10)),
      new SpawnExecution("game_id", game.player(b.id).info(), game.ref(0, 15)),
    );

    const map = game.map();
    const state = map.tileStateBuffer();
    const buf = new OwnerBuffer(map.width(), map.height());
    buf.applyFull(state);
    let prev = state.slice();

    const check = () => {
      for (let i = 0; i < state.length; i++) {
        expect(buf.ownerAt(i)).toBe(map.ownerID(i));
      }
    };

    for (let t = 0; t < 4; t++) {
      game.executeNextTick();
      buf.applyChanged(state, changedRefs(prev, state));
      prev = state.slice();
    }
    check();
    const alpha = game.player(a.id);
    const bravo = game.player(b.id);
    expect(alpha.numTilesOwned()).toBeGreaterThan(0);

    game.addExecution(
      new AttackExecution(100, alpha, game.terraNullius().id()),
    );
    game.addExecution(
      new AttackExecution(100, bravo, game.terraNullius().id()),
    );
    let sawChange = false;
    for (let t = 0; t < 30; t++) {
      game.executeNextTick();
      const changed = changedRefs(prev, state);
      if (changed.length > 0) sawChange = true;
      buf.applyChanged(state, changed);
      prev = state.slice();
    }
    expect(sawChange).toBe(true);
    check();
  });

  it("encodes owner bytes, fallout and defense flags, and dirty rows", () => {
    const buf = new OwnerBuffer(4, 3);
    const state = new Uint16Array(12);
    state[5] = 0x0abc | (1 << 13);
    state[10] = 7 | (1 << 14);
    buf.applyChanged(state, [5, 10]);
    expect(buf.ownerAt(5)).toBe(0x0abc);
    expect(buf.data[5 * 4 + 2]).toBe(255);
    expect(buf.data[5 * 4 + 3]).toBe(0);
    expect(buf.ownerAt(10)).toBe(7);
    expect(buf.data[10 * 4 + 3]).toBe(255);
    expect(buf.dirtyMin).toBe(1);
    expect(buf.dirtyMax).toBe(2);
    buf.clearDirty();
    expect(buf.isDirty()).toBe(false);
  });
});
