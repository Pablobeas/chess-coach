# Third-party notices

## Stockfish.js 18.0.8 redistributed with the project

- Package: `stockfish@18.0.8`
- npm `gitHead`: `93c994592dcf3b4b21052ab925e9b534df9c0918`
- Upstream repository: `https://github.com/nmrugg/stockfish.js`
- Upstream engine: Stockfish 18
- Declared package license: `GPL-3.0`
- Project root license copy: `LICENSE`
- Upstream license copy in the source snapshot: `third_party/stockfish-source/Copying.txt`
- Rebuild and verification guide: `docs/STOCKFISH_SOURCE.md`

Redistributed browser assets:

- `apps/web/public/stockfish/stockfish-18-lite-single.js`
  - SHA-256: `5243fd9b276cab7dfe3ad1d43ab9ead73568fac76468c614242977a210c4a391`
  - Size: `21429` bytes
- `apps/web/public/stockfish/stockfish-18-lite-single.wasm`
  - SHA-256: `a8fbc05ec6920b56d7485826dcb02c5ffd2826bcbf751cf973046f237a9096f1`
  - Size: `7295411` bytes
- `apps/web/public/stockfish/stockfish-18-asm.js`
  - SHA-256: `5c3b0998ca263baa8da83d3ec6ff154db461f3531e45840e5ba7ad28f806427c`
  - Size: `10508771` bytes
- `apps/web/public/stockfish/Copying.txt`
  - SHA-256: `8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903`
  - Size: `35147` bytes

The project keeps a local corresponding-source snapshot at
`third_party/stockfish-source/`. That snapshot is pinned to the npm package
`gitHead`, includes the source tree and build scripts required to reconstruct
the distributed variants, and adds the exact lite NNUE network file used by the
upstream build. Hash manifests for both the source snapshot and the distributed
browser assets live in:

- `third_party/stockfish-source/MANIFEST.sha256`
- `third_party/stockfish-source/DISTRIBUTED_BINARIES.sha256`

The browser-facing `launcher.js` in `apps/web/public/stockfish/launcher.js` is a
project-local bootstrap and is not copied from upstream engine code.

## Maia-3 5M local companion (not redistributed)

- Source: `https://github.com/CSSLab/maia3`
- Fixed source commit: `1e13597c42d4858b7cfd7cfdae01e297263364b2`
- Source license: `AGPL-3.0`
- Checkpoint repository: `https://huggingface.co/UofTCSSLab/Maia3-5M`
- Verified model revision: `b6559de2398d7140b985f28fd2c19fb5e47ddabe`
- Checkpoint file: `maia3-5m.pt` (`20968049` bytes)
- SHA-256: `BA14208B2992D85502F5FB501934ABF6AAAEB355E9F3FDF90E326911F562524F`

The repository does not bundle Maia-3, PyTorch, or the checkpoint. The local setup
script installs the fixed upstream commit into `.runtime/maia3` and downloads the
checkpoint through the official Maia cache command, then rejects it if the hash does
not match. The checkpoint's public model card refers licensing questions back to the
source repository but does not state a separate, unequivocal weights license. Do not
redistribute the environment or checkpoint with application builds until the rights
holder clarifies that permission. The paper's CC BY notice must not be interpreted as
a license for the model weights.
