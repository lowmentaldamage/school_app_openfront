/**
 * Custom maps saved from the in-game map editor.
 *
 * Stored under <data dir>/maps/<id>/ (the self-host data directory, shared
 * by the master and every worker) as the same files a built-in map has:
 * manifest.json, map.bin, map4x.bin, map16x.bin and thumbnail.webp. The
 * server builds the packed files itself (MapBuilder) from the editor's
 * tiles, so a client can't upload a broken map.
 *
 * HTTP, mounted on the master at /api/maps:
 *   GET    /                 → { maps: CustomMapInfo[] }
 *   GET    /:id/:file        → one of the map's files
 *   POST   /                 → save (body: gzip, see decodeUpload) → { id }
 *   DELETE /:id              → admins only (on a self-hosted server)
 *
 * On a self-hosted server anyone logged in can save and only admins
 * delete; without accounts (your own PC) anyone can do both.
 */

import { CUSTOM_MAP_ID_RE } from "@laukolaroser/engine-api/Schemas";
import {
  buildMap,
  decodeMap,
  MAX_MAP_SIDE,
  MIN_MAP_SIDE,
} from "@laukolaroser/shared/maps/MapBuilder";
import crypto from "crypto";
import express, { type Request, type Response } from "express";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import zlib from "zlib";
import { z } from "zod";
import { selfHostDataDir, selfHostEnabled } from "./selfhost/SelfHost";
import { accountFromAuthHeader } from "./selfhost/SelfHostAuth";

export const CUSTOM_MAP_FILES = [
  "manifest.json",
  "map.bin",
  "map4x.bin",
  "map16x.bin",
  "thumbnail.webp",
] as const;

/** Most maps kept on one server. */
export const MAX_CUSTOM_MAPS = 200;
/** Largest upload (gzip) and thumbnail accepted. */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 400 * 1024;

export interface CustomMapInfo {
  id: string;
  name: string;
  author: string;
  width: number;
  height: number;
  nations: number;
  createdAt: number;
}

const UploadHeaderSchema = z.object({
  name: z.string().trim().min(1).max(40),
  width: z.int().min(MIN_MAP_SIDE).max(MAX_MAP_SIDE),
  height: z.int().min(MIN_MAP_SIDE).max(MAX_MAP_SIDE),
  nations: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(40),
        flag: z
          .string()
          .regex(/^[\p{L}\p{N} _().'-]{0,60}$/u)
          .optional(),
        coordinates: z.tuple([z.int().nonnegative(), z.int().nonnegative()]),
      }),
    )
    .max(400),
  /** Base64 webp thumbnail (optional). */
  thumbnail: z
    .string()
    .max(MAX_THUMBNAIL_BYTES * 2)
    .optional(),
});
export type CustomMapUpload = z.infer<typeof UploadHeaderSchema>;

export function customMapsDir(): string {
  return path.join(selfHostDataDir(), "maps");
}

function mapDir(id: string): string {
  if (!CUSTOM_MAP_ID_RE.test(id)) throw new Error(`bad custom map id: ${id}`);
  return path.join(customMapsDir(), id);
}

/** Reads one of a custom map's files. */
export async function readCustomMapFile(
  id: string,
  file: string,
): Promise<Buffer> {
  if (!(CUSTOM_MAP_FILES as readonly string[]).includes(file)) {
    throw new Error(`not a map file: ${file}`);
  }
  return fsp.readFile(path.join(mapDir(id), file));
}

/**
 * The editor's upload: gzip of [u32 LE header length][header JSON][map.bin
 * bytes, width × height]. Only land/water/elevation are read from the tile
 * bytes; everything else is rebuilt.
 */
export function encodeUpload(
  header: CustomMapUpload,
  mapBin: Uint8Array,
): Uint8Array {
  const json = Buffer.from(JSON.stringify(header), "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(json.length, 0);
  return zlib.gzipSync(Buffer.concat([len, json, Buffer.from(mapBin)]));
}

export function decodeUpload(body: Buffer): {
  header: CustomMapUpload;
  mapBin: Uint8Array;
} {
  const raw = zlib.gunzipSync(body, {
    maxOutputLength: MAX_MAP_SIDE * MAX_MAP_SIDE + 2 * 1024 * 1024,
  });
  if (raw.length < 4) throw new Error("upload too short");
  const len = raw.readUInt32LE(0);
  if (len > 2 * 1024 * 1024 || 4 + len > raw.length) {
    throw new Error("bad upload header");
  }
  const header = UploadHeaderSchema.parse(
    JSON.parse(raw.subarray(4, 4 + len).toString("utf8")),
  );
  const mapBin = new Uint8Array(raw.subarray(4 + len));
  if (mapBin.length !== header.width * header.height) {
    throw new Error("tile count does not match the size");
  }
  return { header, mapBin };
}

function apiName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9\s().-]/g, "").trim();
  return (cleaned || "Custom map").slice(0, 29);
}

/** Builds and writes a custom map; returns its id. */
export async function saveCustomMap(
  header: CustomMapUpload,
  mapBin: Uint8Array,
  author: string,
  now = Date.now(),
): Promise<string> {
  const existing = await listCustomMaps();
  if (existing.length >= MAX_CUSTOM_MAPS) {
    throw new CustomMapError(
      `This server already has ${MAX_CUSTOM_MAPS} maps; ask an admin to delete some`,
    );
  }
  const built = buildMap(decodeMap(mapBin, header.width, header.height));
  if (built.numLandTiles < 100) {
    throw new CustomMapError("The map needs some land");
  }
  const nations = header.nations
    .filter(
      (n) =>
        n.coordinates[0] < built.width &&
        n.coordinates[1] < built.height &&
        built.map[n.coordinates[1] * built.width + n.coordinates[0]] & 0x80,
    )
    .map((n) => ({
      coordinates: n.coordinates,
      flag: n.flag ?? "",
      name: n.name,
    }));
  const id = crypto.randomBytes(6).toString("hex");
  const manifest = {
    categories: ["new"],
    display_name: header.name,
    id: "Custom",
    map: {
      height: built.height,
      num_land_tiles: built.numLandTiles,
      width: built.width,
    },
    map16x: {
      height: built.height / 4,
      num_land_tiles: built.numLandTiles16x,
      width: built.width / 4,
    },
    map4x: {
      height: built.height / 2,
      num_land_tiles: built.numLandTiles4x,
      width: built.width / 2,
    },
    name: apiName(header.name),
    nations,
    custom: { author, createdAt: now },
  };
  const dir = mapDir(id);
  const tmp = `${dir}.tmp`;
  await fsp.mkdir(tmp, { recursive: true });
  await Promise.all([
    fsp.writeFile(path.join(tmp, "manifest.json"), JSON.stringify(manifest)),
    fsp.writeFile(path.join(tmp, "map.bin"), built.map),
    fsp.writeFile(path.join(tmp, "map4x.bin"), built.map4x),
    fsp.writeFile(path.join(tmp, "map16x.bin"), built.map16x),
    header.thumbnail
      ? fsp.writeFile(
          path.join(tmp, "thumbnail.webp"),
          Buffer.from(header.thumbnail, "base64").subarray(
            0,
            MAX_THUMBNAIL_BYTES,
          ),
        )
      : Promise.resolve(),
  ]);
  await fsp.rename(tmp, dir);
  return id;
}

export class CustomMapError extends Error {}

export async function listCustomMaps(): Promise<CustomMapInfo[]> {
  const root = customMapsDir();
  let ids: string[];
  try {
    ids = await fsp.readdir(root);
  } catch {
    return [];
  }
  const out: CustomMapInfo[] = [];
  for (const id of ids) {
    if (!CUSTOM_MAP_ID_RE.test(id)) continue;
    try {
      const m = JSON.parse(
        await fsp.readFile(path.join(root, id, "manifest.json"), "utf8"),
      );
      out.push({
        id,
        name: m.display_name ?? m.name,
        author: m.custom?.author ?? "",
        width: m.map.width,
        height: m.map.height,
        nations: m.nations.length,
        createdAt: m.custom?.createdAt ?? 0,
      });
    } catch {
      // half-written or broken: skip
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteCustomMap(id: string): Promise<boolean> {
  const dir = mapDir(id);
  if (!fs.existsSync(dir)) return false;
  await fsp.rm(dir, { recursive: true, force: true });
  return true;
}

export function createCustomMapRouter(): express.Router {
  const router = express.Router();
  const fail = (res: Response, status: number, error: string) =>
    res.status(status).json({ error });

  /** Who may save: anyone on a public server, a logged-in player otherwise. */
  const saver = (req: Request): string | null => {
    if (!selfHostEnabled()) return "";
    return accountFromAuthHeader(req.headers.authorization)?.username ?? null;
  };
  const canDelete = (req: Request): boolean => {
    if (!selfHostEnabled()) return true;
    return accountFromAuthHeader(req.headers.authorization)?.role === "admin";
  };

  router.get("/", (_req, res) => {
    void listCustomMaps().then(
      (maps) => res.json({ maps }),
      () => fail(res, 500, "Server error"),
    );
  });

  router.get("/:id/:file", (req, res) => {
    const { id, file } = req.params;
    if (
      !CUSTOM_MAP_ID_RE.test(id) ||
      !(CUSTOM_MAP_FILES as readonly string[]).includes(file)
    ) {
      fail(res, 404, "Not found");
      return;
    }
    readCustomMapFile(id, file).then(
      (data) => {
        res.setHeader(
          "Content-Type",
          file.endsWith(".json")
            ? "application/json"
            : file.endsWith(".webp")
              ? "image/webp"
              : "application/octet-stream",
        );
        // A saved map never changes (edits save a new one).
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.end(data);
      },
      () => fail(res, 404, "Not found"),
    );
  });

  router.post(
    "/",
    express.raw({ type: "application/octet-stream", limit: MAX_UPLOAD_BYTES }),
    (req, res) => {
      const author = saver(req);
      if (author === null) {
        fail(res, 401, "Please log in");
        return;
      }
      let upload;
      try {
        upload = decodeUpload(req.body as Buffer);
      } catch (e) {
        fail(res, 400, e instanceof Error ? e.message : "Bad map");
        return;
      }
      saveCustomMap(upload.header, upload.mapBin, author).then(
        (id) => res.json({ id }),
        (e) => {
          if (e instanceof CustomMapError) fail(res, 400, e.message);
          else {
            console.error("custom map save failed", e);
            fail(res, 500, "Server error");
          }
        },
      );
    },
  );

  router.delete("/:id", (req, res) => {
    if (!canDelete(req)) {
      fail(res, 403, "Admins only");
      return;
    }
    if (!CUSTOM_MAP_ID_RE.test(req.params.id)) {
      fail(res, 404, "Not found");
      return;
    }
    deleteCustomMap(req.params.id).then(
      (ok) => (ok ? res.json({ ok }) : fail(res, 404, "Not found")),
      () => fail(res, 500, "Server error"),
    );
  });

  return router;
}
