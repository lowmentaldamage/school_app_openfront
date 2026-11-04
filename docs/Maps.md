# Maps

Laukolaroser maps are created and maintained with the Go-based [MapGenerator](../map-generator/README.md).

See the MapGenerator README for information about

- [Creating a new map](../map-generator/README.md#creating-a-new-map)
- [`info.json` schema](../map-generator/README.md#create-infojson)
- [Impassable terrain](../map-generator/README.md#impassable-terrain)
- [Output files](../map-generator/README.md#output-files)
- [Command line flags](../map-generator/README.md#command-line-flags)

## Custom maps (map editor)

Players make maps in the game: **Map Editor** on the home screen (paint, or
upload a picture, heightmap or elevation file). Saving sends the tiles and
height levels to the server, which builds the same files a generated map
has (`src/server/CustomMaps.ts`, `packages/shared/src/maps/MapBuilder.ts`,
a TypeScript port of the generator's packing):

| File                         | Contents                                                         |
| ---------------------------- | ---------------------------------------------------------------- |
| `manifest.json`              | name, size, land tile counts, nations, author, tribe count       |
| `map.bin`                    | one packed byte per tile (land / shore / ocean / magnitude 0-30) |
| `map4x.bin`, `map16x.bin`    | half and quarter size, for compact games and the minimap         |
| `height.bin`, `height4x.bin` | height levels 0 (ground) - 100 (mountain tops) for the 3D view   |
| `thumbnail.webp`             | picture for the map list                                         |

They live in `<data dir>/maps/<id>/` and are served at `/api/maps/<id>/…`.
Games on a custom map carry `GameConfig.customMap` (its id); `gameMap` is
then only a placeholder.

**Bundled maps** ship in `resources/custom-maps/<id>/` (Slovenija, Črna na
Koroškem 1 and 2) and are installed into every server's map store on its
first start. To add one: make it in the editor, save it, and copy its
folder from `data/maps/<id>/` to `resources/custom-maps/<name>/` (lower
case letters and digits, 6-32 characters).

**Heights:** gameplay uses the packed magnitude (plains < 10, highland <
20, mountains ≥ 20). The 3D view draws heights 0-100: from `height.bin`
when the map has one, otherwise smoothed from the magnitudes
(`packages/shared/src/maps/TerrainLevels.ts`).
