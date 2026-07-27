import initStockfish from "stockfish";
import type { UciWorkerLike } from "./index";

type MessageListener = (event: MessageEvent<string>) => void;
type ErrorListener = (event: ErrorEvent) => void;

interface NodeStockfishInstance {
  listener?: ((line: string) => void) | undefined;
  sendCommand(command: string): void;
  terminate?(): void;
}

export interface NodeStockfishWorkerOptions {
  readonly enginePath: string;
}

class NodeStockfishWorker implements UciWorkerLike {
  private readonly messageListeners = new Set<MessageListener>();
  private readonly errorListeners = new Set<ErrorListener>();
  private readonly engine: NodeStockfishInstance;
  private terminated = false;

  constructor(engine: NodeStockfishInstance) {
    this.engine = engine;
    this.engine.listener = (line: string) => {
      if (this.terminated) return;
      const event = new MessageEvent("message", { data: line });
      for (const listener of this.messageListeners) {
        listener(event);
      }
    };
  }

  postMessage(message: string): void {
    if (this.terminated) return;
    try {
      this.engine.sendCommand(message);
    } catch (error) {
      const event = new ErrorEvent("error", {
        message: error instanceof Error ? error.message : String(error),
      });
      for (const listener of this.errorListeners) {
        listener(event);
      }
    }
  }

  addEventListener(
    type: "message" | "error",
    listener: (event: MessageEvent<unknown> | ErrorEvent) => void,
  ): void {
    if (type === "message") {
      this.messageListeners.add(listener as MessageListener);
      return;
    }
    this.errorListeners.add(listener as ErrorListener);
  }

  removeEventListener(
    type: "message" | "error",
    listener: (event: MessageEvent<unknown> | ErrorEvent) => void,
  ): void {
    if (type === "message") {
      this.messageListeners.delete(listener as MessageListener);
      return;
    }
    this.errorListeners.delete(listener as ErrorListener);
  }

  terminate(): void {
    this.terminated = true;
    this.engine.listener = undefined;
    this.engine.terminate?.();
  }
}

export async function createNodeStockfishWorker(
  options: NodeStockfishWorkerOptions,
): Promise<UciWorkerLike> {
  const engine = (await initStockfish(
    options.enginePath,
  )) as NodeStockfishInstance;
  return new NodeStockfishWorker(engine);
}
