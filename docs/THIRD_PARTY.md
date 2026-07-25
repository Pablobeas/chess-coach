# Third-party notices

## Stockfish.js 18 lite single-threaded

- Package: `stockfish@18.0.8`
- Source: https://github.com/nmrugg/stockfish.js
- Upstream engine: Stockfish 18
- License: GPLv3, included at `apps/web/public/stockfish/Copying.txt`.
- Distributed assets:
  - `stockfish-18-lite-single.js`
  - `stockfish-18-lite-single.wasm`
- SHA-256 WASM: `A8FBC05EC6920B56D7485826DCB02C5FFD2826BCBF751CF973046F237A9096F1`
- SHA-256 JS: `5243FD9B276CAB7DFE3AD1D43AB9EAD73568FAC76468C614242977A210C4A391`

The web application runs the single-threaded WASM asset inside a Web Worker. The
source license and copyright notice remain distributed with the public asset.
Any production redistribution must keep this notice and provide the corresponding
source as required by GPLv3.

This same WASM asset now serves both coach analysis and the hosted/mobile
`opponent` fallback through one serialized browser-side UCI broker. Hosted
builds must stay offline-first and must not proxy FEN or PGN to `/maia3-api`.

For `stockfish-18-lite-single.js`, the browser Worker URL must contain only the
encoded WASM URL in its fragment. The `,worker` suffix is reserved by
Stockfish.js for its internal pthread worker branch and must not be appended to
this single-threaded browser entrypoint.

`apps/web/public/stockfish/launcher.js` is the local bootstrap used by the
compatibility path. It does not contain engine code and is covered by the
project license.

## Maia-3 5M local companion (not redistributed)

- Source: https://github.com/CSSLab/maia3
- Fixed source commit: `1e13597c42d4858b7cfd7cfdae01e297263364b2`
- Source license: AGPL-3.0
- Checkpoint repository: https://huggingface.co/UofTCSSLab/Maia3-5M
- Verified model revision: `b6559de2398d7140b985f28fd2c19fb5e47ddabe`
- Checkpoint file: `maia3-5m.pt` (20,968,049 bytes)
- SHA-256: `BA14208B2992D85502F5FB501934ABF6AAAEB355E9F3FDF90E326911F562524F`

The repository does not bundle Maia-3, PyTorch, or the checkpoint. The local setup
script installs the fixed upstream commit into `.runtime/maia3` and downloads the
checkpoint through the official Maia cache command, then rejects it if the hash does
not match. The checkpoint's public model card refers licensing questions back to the
source repository but does not state a separate, unequivocal weights license. Do not
redistribute the environment or checkpoint with application builds until the rights
holder clarifies that permission. The paper's CC BY notice must not be interpreted as
a license for the model weights.

## Stockfish.js 18 ASM.js compatibility backend

- Package: `stockfish@18.0.8`
- Source: https://github.com/nmrugg/stockfish.js
- Upstream engine: Stockfish 18
- License: GPLv3, included at `apps/web/public/stockfish/Copying.txt`.
- Distributed asset: `stockfish-18-asm.js`
- SHA-256 JS: `5C3B0998CA263BAA8DA83D3EC6FF154DB461F3531E45840E5BA7AD28F806427C`

The ASM.js asset is a local compatibility backend used only when the WASM
backend cannot initialize. It is slower and is not equivalent to the WASM
backend's performance, but it preserves an offline real-engine path for both
analysis and the local Stockfish opponent fallback.
