import { describe, expect, it, vi } from "vitest";
import { disposeEngineRef, type DisposableEngine } from "./engineLifecycle";

function createRef(engine: DisposableEngine | null) {
  return { current: engine };
}

describe("engine lifecycle ownership", () => {
  it("detaches the engine before disposing it", async () => {
    let ref: ReturnType<typeof createRef>;
    const dispose = vi.fn(async () => {
      expect(ref.current).toBeNull();
    });
    ref = createRef({ dispose });

    disposeEngineRef(ref);

    expect(ref.current).toBeNull();
    await Promise.resolve();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("is idempotent when cleanup runs more than once", async () => {
    const dispose = vi.fn(async () => undefined);
    const ref = createRef({ dispose });

    disposeEngineRef(ref);
    disposeEngineRef(ref);

    await Promise.resolve();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("swallows asynchronous cleanup failures", async () => {
    const ref = createRef({
      dispose: vi.fn(async () => {
        throw new Error("cleanup failed");
      }),
    });

    expect(() => disposeEngineRef(ref)).not.toThrow();
    await Promise.resolve();
    expect(ref.current).toBeNull();
  });
});
