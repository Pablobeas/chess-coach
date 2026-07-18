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

For `stockfish-18-lite-single.js`, the browser Worker URL must contain only the
encoded WASM URL in its fragment. The `,worker` suffix is reserved by
Stockfish.js for its internal pthread worker branch and must not be appended to
this single-threaded browser entrypoint.

`apps/web/public/stockfish/launcher.js` is the local bootstrap used by the
compatibility path. It does not contain engine code and is covered by the
project license.

## Stockfish.js 18 ASM.js compatibility backend

- Package: `stockfish@18.0.8`
- Source: https://github.com/nmrugg/stockfish.js
- Upstream engine: Stockfish 18
- License: GPLv3, included at `apps/web/public/stockfish/Copying.txt`.
- Distributed asset: `stockfish-18-asm.js`
- SHA-256 JS: `5C3B0998CA263BAA8DA83D3EC6FF154DB461F3531E45840E5BA7AD28F806427C`

The ASM.js asset is a local compatibility backend used only when the WASM
backend cannot initialize. It is slower and is not equivalent to the WASM
backend's performance, but it preserves an offline real-engine path.
