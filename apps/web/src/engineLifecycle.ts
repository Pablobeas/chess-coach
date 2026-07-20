export interface DisposableEngine {
  dispose(): Promise<void>;
}

export interface EngineRef<T extends DisposableEngine> {
  current: T | null;
}

/**
 * Detach an owned engine before disposing it. This ordering is important for
 * React StrictMode and HMR: a remounted component must not reuse a disposed
 * engine instance. The helper is intentionally idempotent and cleanup errors
 * cannot become unhandled promise rejections.
 */
export function disposeEngineRef<T extends DisposableEngine>(
  ref: EngineRef<T>,
): void {
  const engine = ref.current;
  ref.current = null;
  if (!engine) return;
  void Promise.resolve()
    .then(() => engine.dispose())
    .catch(() => undefined);
}
