import {
  GameMapSize,
  GameMapType,
} from "@laukolaroser/engine-api/game/GameTypes";
import { MapFiles, MapManifest } from "@laukolaroser/engine-api/game/MapFiles";

/** Where a host gets a map's files, its thumbnail and its layer images. */
export interface GameMapLoader {
  getMapData(map: GameMapType): MapData;
  /** A map saved from the map editor (GameConfig.customMap). */
  getCustomMapData?(id: string): MapData;
}

export interface MapData {
  mapBin: () => Promise<Uint8Array>;
  map4xBin: () => Promise<Uint8Array>;
  map16xBin: () => Promise<Uint8Array>;
  manifest: () => Promise<MapManifest>;
  webpPath: string;
  /**
   * The map rendered in the 3D look (scripts/maps-3d.cjs --write). May be
   * missing for a map; callers fall back to `webpPath`.
   */
  preview3dPath?: string;
  /**
   * Load a map layer image by layer id. `compact` selects the map4x-sized
   * variant (`<id>.4x.webp`; ids cannot contain dots, so it never collides
   * with another layer), which Compact games draw on directly.
   */
  layerImage: (layerId: string, compact: boolean) => Promise<ImageBitmap>;
  /**
   * Height levels 0 (ground) - 100 (mountain tops) per tile for the 3D
   * view (height.bin / height4x.bin), when the map has them; null if not.
   */
  levelsBin?: (compact: boolean) => Promise<Uint8Array | null>;
}

/** Loads the files a game on this map and size reads (see MapFiles). */
export async function loadMapFiles(
  loader: GameMapLoader,
  map: GameMapType,
  mapSize: GameMapSize,
  customMap?: string | null,
): Promise<MapFiles> {
  let data: MapData;
  if (customMap) {
    if (!loader.getCustomMapData) {
      throw new Error("this host cannot load custom maps");
    }
    data = loader.getCustomMapData(customMap);
  } else {
    data = loader.getMapData(map);
  }
  if (mapSize === GameMapSize.Normal) {
    const [manifest, mapBin, map4xBin] = await Promise.all([
      data.manifest(),
      data.mapBin(),
      data.map4xBin(),
    ]);
    return { map, mapSize, manifest, mapBin, map4xBin };
  }
  const [manifest, map4xBin, map16xBin] = await Promise.all([
    data.manifest(),
    data.map4xBin(),
    data.map16xBin(),
  ]);
  return { map, mapSize, manifest, map4xBin, map16xBin };
}

/** The files' buffers, to move them to a worker instead of copying them. */
export function mapFilesTransfer(files: MapFiles): ArrayBuffer[] {
  return [files.mapBin, files.map4xBin, files.map16xBin].flatMap((bin) =>
    bin === undefined ? [] : [bin.buffer as ArrayBuffer],
  );
}
