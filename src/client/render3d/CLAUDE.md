# CLAUDE.md — `src/client/render3d/`

Three.js 3D world renderer (Laukolaroser). Architecture, decisions and the
increment log are in `docs/World3D.md` — read it first.

Rules for this folder:

- Pure consumer of `FrameData` / palette / camera state. Never import
  `packages/engine`, never mutate game state.
- Do not statically import anything here from `Main.ts` except
  `World3DFlag.ts` (it has no three.js import). The game client loads
  `World3DView` with `import()`.
- Keep GPU-free logic (codecs, geometry builders, buffers, camera math,
  quality policy) in modules without WebGL calls so it can be unit tested in
  `tests/render3d/` under the node environment.
- Extend `MeshStandardMaterial` via `onBeforeCompile` rather than writing raw
  `ShaderMaterial`s, so lighting/shadows/fog stay consistent. Give each
  extended material a `customProgramCacheKey`.
- Per-entity rendering must be instanced (`InstancedMesh`) or batched; no
  per-unit `Mesh` objects.
- Palette colours are sRGB; convert to linear in shaders (`pow(c, 2.2)`).
