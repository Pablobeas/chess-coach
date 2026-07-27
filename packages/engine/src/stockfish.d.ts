declare module "stockfish" {
  export default function initStockfish(enginePath?: string): Promise<unknown>;
}
