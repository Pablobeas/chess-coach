import { useEffect, useRef, useState } from "react";
import type { SessionLine, SessionWorkspace } from "./sessionWorkspace";

type VariationHistoryProps = {
  readonly workspace: SessionWorkspace;
  readonly onSelect: (lineId: string, cursor: number) => void;
  readonly onDelete: (lineId: string) => void;
};

function lineDepth(workspace: SessionWorkspace, line: SessionLine): number {
  let depth = 0;
  let current = line;
  while (current.fork) {
    depth += 1;
    const parent = workspace.lines.find((item) => item.id === current.fork?.lineId);
    if (!parent) break;
    current = parent;
  }
  return depth;
}

function orderedLines(workspace: SessionWorkspace): readonly SessionLine[] {
  const main = workspace.lines.find((line) => line.id === workspace.mainLineId);
  if (!main) return workspace.lines;
  const children = (parentId: string): SessionLine[] =>
    workspace.lines.filter((line) => line.fork?.lineId === parentId);
  const result: SessionLine[] = [];
  const visit = (line: SessionLine) => {
    result.push(line);
    for (const child of children(line.id)) visit(child);
  };
  visit(main);
  return result;
}

export function VariationHistory({ workspace, onSelect, onDelete }: VariationHistoryProps) {
  const [deleteId, setDeleteId] = useState<string>();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const target = workspace.lines.find((line) => line.id === deleteId);

  useEffect(() => {
    if (target) cancelRef.current?.focus();
  }, [target]);

  return (
    <section className="variation-history" aria-labelledby="variation-history-title">
      <div className="moves-heading">
        <h2 id="variation-history-title">Historial de variantes</h2>
        <span>{workspace.lines.length}</span>
      </div>
      <ol className="variation-tree">
        {orderedLines(workspace).map((line) => {
          const depth = lineDepth(workspace, line);
          const active = line.id === workspace.activeLineId;
          const start = line.fork?.ply ?? 0;
          return (
            <li key={line.id} className="variation-line" style={{ "--variation-depth": depth } as React.CSSProperties}>
              <div className="variation-line-heading">
                <span>{line.id === workspace.mainLineId ? "Principal" : `Variante desde jugada ${start}`}</span>
                {line.id !== workspace.mainLineId ? (
                  <button type="button" className="variation-delete" aria-label="Eliminar variante" onClick={() => setDeleteId(line.id)}>···</button>
                ) : null}
              </div>
              <div className="variation-moves" aria-label={line.id === workspace.mainLineId ? "Línea principal" : "Variante"}>
                {line.timeline.session.history.map((move, index) => (
                  <button
                    type="button"
                    key={`${index}-${move.uci}`}
                    className="move-entry san-button"
                    aria-current={active && line.timeline.cursor === index + 1 ? "step" : undefined}
                    onClick={() => onSelect(line.id, index + 1)}
                  >
                    {move.san}
                  </button>
                ))}
                {line.timeline.session.history.length === 0 ? <span className="variation-empty">Sin jugadas</span> : null}
              </div>
            </li>
          );
        })}
      </ol>
      {target ? (
        <div className="variation-confirm" role="dialog" aria-modal="true" aria-labelledby="delete-variation-title">
          <h3 id="delete-variation-title">¿Eliminar esta variante?</h3>
          <p>Se eliminará esta continuación y su análisis asociado.</p>
          <div className="dialog-actions">
            <button type="button" className="danger-action" onClick={() => { onDelete(target.id); setDeleteId(undefined); }}>Eliminar variante</button>
            <button ref={cancelRef} type="button" className="secondary" onClick={() => setDeleteId(undefined)}>Cancelar</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
