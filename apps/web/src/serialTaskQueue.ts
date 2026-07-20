export interface SerialTaskQueue {
  enqueue(task: (signal: AbortSignal) => Promise<void>): void;
  invalidate(): void;
  dispose(): void;
}

export function createSerialTaskQueue(): SerialTaskQueue {
  let generation = 0;
  let active: AbortController | undefined;
  let tail = Promise.resolve();

  const invalidate = () => {
    generation += 1;
    active?.abort();
    active = undefined;
  };

  return {
    enqueue(task) {
      const taskGeneration = generation;
      tail = tail
        .catch(() => undefined)
        .then(async () => {
          if (taskGeneration !== generation) return;
          const controller = new AbortController();
          active = controller;
          try {
            await task(controller.signal);
          } finally {
            if (active === controller) active = undefined;
          }
        });
    },
    invalidate,
    dispose: invalidate,
  };
}
