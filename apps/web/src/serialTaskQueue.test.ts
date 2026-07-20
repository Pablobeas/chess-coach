import { describe, expect, it, vi } from "vitest";
import { createSerialTaskQueue } from "./serialTaskQueue";

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("serial task queue", () => {
  it("runs valid analysis jobs in FIFO order", async () => {
    const queue = createSerialTaskQueue();
    const first = deferred();
    const events: string[] = [];

    queue.enqueue(async () => {
      events.push("first:start");
      await first.promise;
      events.push("first:end");
    });
    queue.enqueue(async () => {
      events.push("second");
    });

    await vi.waitFor(() => expect(events).toEqual(["first:start"]));
    first.resolve();
    await vi.waitFor(() =>
      expect(events).toEqual(["first:start", "first:end", "second"]),
    );
  });

  it("aborts the active job and skips queued jobs after invalidation", async () => {
    const queue = createSerialTaskQueue();
    const signals: AbortSignal[] = [];
    const skipped = vi.fn();

    queue.enqueue(async (signal) => {
      signals.push(signal);
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
    });
    queue.enqueue(async () => skipped());

    await vi.waitFor(() => expect(signals).toHaveLength(1));
    queue.invalidate();
    await vi.waitFor(() => expect(signals[0]?.aborted).toBe(true));
    await Promise.resolve();
    expect(skipped).not.toHaveBeenCalled();
  });
});
