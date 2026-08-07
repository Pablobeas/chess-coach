# Stockfish corresponding source

Este documento describe la postura tecnica del repositorio para cumplir con la
redistribucion de `stockfish@18.0.8`. Es una guia de ingenieria y
verificabilidad; no constituye asesoria legal.

## Scope

El proyecto redistribuye estos artefactos de navegador:

- `apps/web/public/stockfish/stockfish-18-lite-single.js`
- `apps/web/public/stockfish/stockfish-18-lite-single.wasm`
- `apps/web/public/stockfish/stockfish-18-asm.js`
- `apps/web/public/stockfish/Copying.txt`

No se redistribuyen desde `third_party/stockfish-source/` los binarios del motor
ya compilados. Ese directorio contiene la fuente correspondiente y la evidencia
para reconstruir y verificar los binarios publicos.

## Fixed upstream origin

- npm package: `stockfish@18.0.8`
- npm `gitHead`: `93c994592dcf3b4b21052ab925e9b534df9c0918`
- Upstream repository: `https://github.com/nmrugg/stockfish.js`
- npm tarball URL: `https://registry.npmjs.org/stockfish/-/stockfish-18.0.8.tgz`
- npm tarball SHA-256: `bf7f06511204543b82bd77db2c6fa61c0de94678ee20c1a8d0962309095d2480`
- npm `dist.shasum`: `f361d4b05f4c829a6f17da5cf18328525c5268f6`
- npm `dist.integrity`: `sha512-z+f2UMPXLylDBGjv9e9zU8QulY7hUl8MYHesLRrdddewlOXjJrUSmtNmbtID1/F72EPhq0CCkCNxgWS5MQVWtQ==`
- Upstream checkout verified locally at commit: `93c994592dcf3b4b21052ab925e9b534df9c0918`
- Upstream commit date: `2026-06-15`
- Upstream commit subject: `18.0.8`

## Source snapshot included in this repository

Local snapshot path:

- `third_party/stockfish-source/`

Snapshot contents:

- upstream tracked source tree at `gitHead`
- `AUTHORS`
- `Copying.txt`
- `README.md`
- `build.js`
- `index.js`
- `package.json`
- `scripts/**`
- `src/**`
- upstream-tracked `node_modules/uglify-js/**`
- exact lite NNUE file `src/nn-9067e33176e8.nnue`
- `MANIFEST.sha256`
- `DISTRIBUTED_BINARIES.sha256`

Snapshot inventory at the time this document was written:

- file count: `109`
- total size: `8832561` bytes

The snapshot intentionally does not contain:

- an embedded `.git` directory
- temporary download folders
- redundant redistributed output binaries such as `stockfish-18-lite-single.js`,
  `stockfish-18-lite-single.wasm`, or `stockfish-18-asm.js`

## Why `node_modules/uglify-js` is included

The upstream `build.js` for this commit calls `require("uglify-js")` during JS
minification. In this upstream commit that dependency is tracked in the Git tree
under `node_modules/uglify-js/**`. Keeping that tracked subtree in the local
snapshot avoids silently weakening reproducibility for the published JS hashes.

## Exact NNUE input included

The lite single-threaded build depends on the lite NNUE file referenced by
`src/lite_nets.h`:

- file: `nn-9067e33176e8.nnue`
- stored at: `third_party/stockfish-source/src/nn-9067e33176e8.nnue`
- source URL used for verification: `https://tests.stockfishchess.org/api/nn/nn-9067e33176e8.nnue`
- verified SHA-256: `9067e33176e8c5edb7aa8db6a3aedd012f84a1f39872e86357c6c2d0993f314d`
- verified size: `6617595` bytes

The filename prefix matches the SHA-256 prefix convention enforced by upstream
`scripts/net.sh`.

## Distributed binary hashes

The public assets redistributed by this repository are recorded in
`third_party/stockfish-source/DISTRIBUTED_BINARIES.sha256`.

- `stockfish-18-lite-single.js`
  - SHA-256: `5243fd9b276cab7dfe3ad1d43ab9ead73568fac76468c614242977a210c4a391`
  - Size: `21429` bytes
- `stockfish-18-lite-single.wasm`
  - SHA-256: `a8fbc05ec6920b56d7485826dcb02c5ffd2826bcbf751cf973046f237a9096f1`
  - Size: `7295411` bytes
- `stockfish-18-asm.js`
  - SHA-256: `5c3b0998ca263baa8da83d3ec6ff154db461f3531e45840e5ba7ad28f806427c`
  - Size: `10508771` bytes
- `apps/web/public/stockfish/Copying.txt`
  - SHA-256: `8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903`
  - Size: `35147` bytes

The source snapshot's own GPL copy is `third_party/stockfish-source/Copying.txt`
with SHA-256 `0b383d5a63da644f628d99c33976ea6487ed89aaa59f0b3257992deac1171e6b`.
Those two files differ in line endings on this repository copy, but their text
matches after LF normalization.

## Rebuild outline

Upstream `README.md` and `build.js` for this commit indicate this toolchain:

- Node.js available in PATH
- Emscripten `3.1.7`
- `make`

Upstream build entrypoints relevant to the redistributed artifacts:

- lite single-threaded WASM:
  - `node build.js --lite --single-threaded -f`
- ASM.js compatibility engine:
  - `node build.js --asm-js --no-split -f`

The build script derives default output names for these variants:

- `stockfish-18-lite-single.js`
- `stockfish-18-lite-single.wasm`
- `stockfish-18-asm.js`

## Rebuild and verification steps

From the repository root:

```powershell
Set-Location third_party/stockfish-source
Get-ChildItem -Recurse -File | Measure-Object -Property Length -Sum
```

Validate the included source snapshot manifest:

```powershell
Set-Location third_party/stockfish-source
Get-Content MANIFEST.sha256 | ForEach-Object {
  if ($_ -match '^([0-9a-f]{64}) \\*(.+)$') {
    $expected = $matches[1]
    $path = $matches[2]
    $actual = (Get-FileHash $path -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $expected) {
      throw \"SHA-256 mismatch for $path`nexpected=$expected`nactual=$actual\"
    }
  }
}
```

Build with the upstream commands once `emcc` and `make` are installed:

```powershell
Set-Location third_party/stockfish-source
node build.js --lite --single-threaded -f
node build.js --asm-js --no-split -f
```

Compare rebuilt outputs against the redistributed browser assets:

```powershell
Set-Location C:\\Users\\pc\\Desktop\\Proyecto ajedrez
Get-Content third_party/stockfish-source/DISTRIBUTED_BINARIES.sha256 | ForEach-Object {
  if ($_ -match '^([0-9a-f]{64}) \\*(.+)$') {
    $expected = $matches[1]
    $path = $matches[2]
    $actual = (Get-FileHash $path -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $expected) {
      throw \"SHA-256 mismatch for $path`nexpected=$expected`nactual=$actual\"
    }
  }
}
```

## Limits of the verification performed on this workstation

The current workstation used for this compliance update had:

- Node.js `v24.16.0`
- no `emcc` in PATH
- no `make` in PATH

Because of that, this update verifies provenance, hashes, source completeness,
and the exact NNUE input, but it does not claim that a full rebuild was executed
successfully on this machine. The rebuild commands above remain the intended
technical verification path once the upstream toolchain is installed.
