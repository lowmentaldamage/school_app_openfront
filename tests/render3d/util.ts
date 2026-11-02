import type { GameMap } from "@openfront/engine-api/game/GameMap";
import { genTerrainFromBin } from "@openfront/engine-lib/game/TerrainMapLoader";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Load a test map (full resolution) and its per-tile terrain bytes. */
export async function loadTestTerrain(
  mapName: string,
): Promise<{ map: GameMap; terrain: Uint8Array }> {
  const dir = path.join(__dirname, "../testdata/maps", mapName);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
  );
  const map = await genTerrainFromBin(
    manifest.map,
    fs.readFileSync(path.join(dir, "map.bin")),
  );
  const terrain = new Uint8Array(map.width() * map.height());
  for (let i = 0; i < terrain.length; i++) terrain[i] = map.terrainByte(i);
  return { map, terrain };
}
