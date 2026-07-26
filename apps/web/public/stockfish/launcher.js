(() => {
  self.onerror = (message) => {
    self.postMessage({
      type: "engine-error",
      message: String(message || "Stockfish worker failed"),
    });
  };
  self.onunhandledrejection = (event) => {
    self.postMessage({
      type: "engine-error",
      message: event.reason instanceof Error ? event.reason.message : String(event.reason),
    });
  };
  const parameters = new URL(self.location.href).searchParams;
  const engine = parameters.get("engine");
  const engineFiles = {
    asm: "stockfish-18-asm.js",
    wasm: "stockfish-18-lite-single.js",
  };
  const engineFile = engineFiles[engine];

  if (!engineFile) throw new Error("Unknown Stockfish backend");

  self.postMessage({
    type: "launcher-status",
    stage: "loading-engine",
    engine,
    href: self.location.href,
  });
  // Stockfish's browser build reads the launcher's own fragment and installs
  // its UCI bridge in this worker. Keeping the launcher as a thin bootstrap
  // avoids a nested Worker, which is not consistently available in browsers.
  importScripts(new URL(engineFile, self.location.href).toString());
})();
