/**
 * Client side of the custom map store (server: src/server/CustomMaps.ts).
 * Small and free of the game client, so the homepage's map pickers can use
 * it.
 */

import {
  currentSession,
  isSelfHosted,
  selfHostToken,
} from "../selfhost/SelfHostSession";

export interface CustomMapInfo {
  id: string;
  name: string;
  author: string;
  width: number;
  height: number;
  nations: number;
  createdAt: number;
}

export interface CustomMapSave {
  name: string;
  width: number;
  height: number;
  nations: { name: string; flag?: string; coordinates: [number, number] }[];
  /** Base64 webp. */
  thumbnail?: string;
}

const BASE = "/api/maps";

function authHeaders(): Record<string, string> {
  const token = selfHostToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

export function customMapThumbnail(id: string): string {
  return `${BASE}/${encodeURIComponent(id)}/thumbnail.webp`;
}

let listCache: Promise<CustomMapInfo[]> | null = null;

/** Every map saved on this server, newest first ([] if unavailable). */
export function listCustomMaps(refresh = false): Promise<CustomMapInfo[]> {
  if (listCache === null || refresh) {
    listCache = fetch(BASE)
      .then((r) => (r.ok ? r.json() : { maps: [] }))
      .then((j: { maps?: CustomMapInfo[] }) => j.maps ?? [])
      .catch(() => []);
  }
  return listCache;
}

async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The upload body: gzip of [u32 LE header length][header JSON][tiles]. */
export async function encodeCustomMap(
  header: CustomMapSave,
  mapBin: Uint8Array,
): Promise<Uint8Array> {
  const json = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(4 + json.length + mapBin.length);
  new DataView(out.buffer).setUint32(0, json.length, true);
  out.set(json, 4);
  out.set(mapBin, 4 + json.length);
  return gzip(out);
}

export async function saveCustomMap(
  header: CustomMapSave,
  mapBin: Uint8Array,
): Promise<string> {
  const body = await encodeCustomMap(header, mapBin);
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "content-type": "application/octet-stream", ...authHeaders() },
    body: body as BodyInit,
  });
  const json = (await res.json().catch(() => ({}))) as {
    id?: string;
    error?: string;
  };
  if (!res.ok || !json.id) throw new Error(json.error ?? `HTTP ${res.status}`);
  listCache = null;
  return json.id;
}

export async function deleteCustomMap(id: string): Promise<void> {
  const res = await fetch(`${BASE}/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error ?? `HTTP ${res.status}`);
  }
  listCache = null;
}

/** Admins delete maps on a private server; anyone can on a public one. */
export function canDeleteCustomMaps(): boolean {
  return !isSelfHosted() || currentSession()?.role === "admin";
}

/** Saving needs a login on a private server. */
export function canSaveCustomMaps(): boolean {
  return !isSelfHosted() || currentSession() !== null;
}
