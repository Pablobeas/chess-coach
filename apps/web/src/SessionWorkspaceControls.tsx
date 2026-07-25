import { useEffect, useRef, useState } from "react";
import type { SessionLine, SessionWorkspace } from "./sessionWorkspace";

export function orderedWorkspaceLines(
  workspace: SessionWorkspace,
): readonly SessionLine[] {
  const main = workspace.lines.find((line) => line.id === workspace.mainLineId);
  if (!main) return workspace.lines;
  return [main, ...workspace.lines.filter((line) => line.id !== main.id)];
}

export function trialLabel(
  workspace: SessionWorkspace,
  lineId: string,
): string {
  const index = orderedWorkspaceLines(workspace)
    .filter((line) => line.id !== workspace.mainLineId)
    .findIndex((line) => line.id === lineId);
  return `Prueba ${index + 1}`;
}

export function AlternativePreparationBar({
  onCancel,
}: {
  readonly onCancel: () => void;
}) {
  return (
    <section
      className="alternative-preparation"
      aria-labelledby="alternative-title"
    >
      <div>
        <p className="label">Probando otra jugada</p>
        <h2 id="alternative-title">Haz una jugada distinta.</h2>
        <p>La partida principal sigue guardada.</p>
      </div>
      <button type="button" className="secondary" onClick={onCancel}>
        Cancelar
      </button>
    </section>
  );
}

function TrialOptions({
  label,
  onPromote,
  onDelete,
}: {
  readonly label: string;
  readonly onPromote: () => void;
  readonly onDelete: (trigger: HTMLButtonElement) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const optionsTriggerRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="trial-options">
      <button
        type="button"
        ref={optionsTriggerRef}
        aria-expanded={isOpen}
        aria-label={`Opciones de ${label}`}
        onClick={() => setIsOpen((current) => !current)}
      >
        Opciones
      </button>
      {isOpen ? (
        <div
          className="trial-options-menu"
          role="group"
          aria-label={`Opciones de ${label}`}
        >
          <button type="button" onClick={onPromote}>
            Hacer principal
          </button>
          <button
            type="button"
            className="danger-action"
            onClick={(event) => {
              setIsOpen(false);
              onDelete(optionsTriggerRef.current ?? event.currentTarget);
            }}
          >
            Eliminar
          </button>
        </div>
      ) : null}
    </div>
  );
}

function DeleteTrialDialog({
  isOpen,
  lineLabel,
  onCancel,
  onConfirm,
}: {
  readonly isOpen: boolean;
  readonly lineLabel: string | undefined;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen) {
      try {
        if (!dialog.open && typeof dialog.showModal === "function") {
          dialog.showModal();
        }
      } catch {
        // jsdom and older embedded browsers may expose dialog without a usable
        // showModal(). The open attribute keeps the native element testable and
        // visible while retaining the same controls and close behavior.
        dialog.setAttribute("open", "");
      }
      if (!dialog.open) dialog.setAttribute("open", "");
      cancelRef.current?.focus();
    } else if (dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [isOpen]);

  return (
    <dialog
      ref={dialogRef}
      className="trial-delete-dialog"
      aria-labelledby="delete-trial-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClose={onCancel}
    >
      <p className="label">Eliminar {lineLabel ?? "prueba"}</p>
      <h2 id="delete-trial-title">¿Eliminar esta prueba?</h2>
      <p>
        Perderás las jugadas, comentarios y análisis guardados en esta prueba.
        Esta acción no afecta a la partida principal.
      </p>
      <div className="dialog-actions">
        <button type="button" className="danger-action" onClick={onConfirm}>
          Eliminar prueba
        </button>
        <button
          ref={cancelRef}
          type="button"
          className="secondary"
          onClick={onCancel}
        >
          Cancelar
        </button>
      </div>
    </dialog>
  );
}

export function PromotionSuggestion({
  onPromote,
  onDismiss,
}: {
  readonly onPromote: () => void;
  readonly onDismiss: () => void;
}) {
  return (
    <section className="promotion-prompt" aria-labelledby="promotion-title">
      <h2 id="promotion-title">¿Quieres conservar esta prueba?</h2>
      <p>
        Puedes hacerla principal para incluirla en el resumen y la exportación.
        La partida principal actual se conserva como prueba.
      </p>
      <div className="promotion-actions">
        <button type="button" onClick={onPromote}>
          Hacer principal
        </button>
        <button type="button" className="secondary" onClick={onDismiss}>
          Ahora no
        </button>
      </div>
    </section>
  );
}

export function WorkspaceLinePanel({
  workspace,
  onSelect,
  onReturnToMain,
  onPromote,
  onDelete,
  onContextChange,
}: {
  readonly workspace: SessionWorkspace;
  readonly onSelect: (lineId: string) => void;
  readonly onReturnToMain: () => void;
  readonly onPromote: (lineId: string) => void;
  readonly onDelete: (lineId: string) => void;
  readonly onContextChange: (message: string) => void;
}) {
  const trials = orderedWorkspaceLines(workspace).filter(
    (line) => line.id !== workspace.mainLineId,
  );
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [targetLineId, setTargetLineId] = useState<string>();
  const [deletionNotice, setDeletionNotice] = useState("");
  const deletionTriggerRef = useRef<HTMLButtonElement>(null);
  const trialsTriggerRef = useRef<HTMLButtonElement>(null);
  const deletionStatusRef = useRef<HTMLParagraphElement>(null);
  const activeIsMain = workspace.activeLineId === workspace.mainLineId;
  const activeLabel = activeIsMain
    ? "Partida principal"
    : trialLabel(workspace, workspace.activeLineId);
  const targetLine = targetLineId
    ? workspace.lines.find((line) => line.id === targetLineId)
    : undefined;

  const selectLine = (lineId: string) => {
    onSelect(lineId);
    onContextChange(
      lineId === workspace.mainLineId
        ? "Contexto cambiado a la partida principal."
        : `Contexto cambiado a ${trialLabel(workspace, lineId)}.`,
    );
  };

  const closeDeletion = () => {
    setTargetLineId(undefined);
    window.setTimeout(() => deletionTriggerRef.current?.focus(), 0);
  };

  const focusAfterDeletion = () => {
    window.setTimeout(() => {
      if (deletionTriggerRef.current?.isConnected) {
        deletionTriggerRef.current.focus();
      } else if (trialsTriggerRef.current?.isConnected) {
        trialsTriggerRef.current.focus();
      } else {
        deletionStatusRef.current?.focus();
      }
    }, 0);
  };

  const deletionStatus = (
    <p
      ref={deletionStatusRef}
      className="workspace-deletion-status"
      data-workspace-deletion-status
      role="status"
      tabIndex={-1}
    >
      {deletionNotice}
    </p>
  );

  if (trials.length === 0) {
    return (
      <>
        {deletionStatus}
        <DeleteTrialDialog
          isOpen={false}
          lineLabel={undefined}
          onCancel={closeDeletion}
          onConfirm={() => undefined}
        />
      </>
    );
  }

  return (
    <>
      <section
        className="workspace-lines"
        aria-labelledby="workspace-lines-title"
      >
        <div className="workspace-line-summary">
          <div>
            <p className="label">{activeLabel}</p>
            {!activeIsMain ? <p>La principal está guardada.</p> : null}
          </div>
          {!activeIsMain ? (
            <button type="button" onClick={onReturnToMain}>
              Volver a principal
            </button>
          ) : null}
          <button
            type="button"
            ref={trialsTriggerRef}
            className="secondary"
            aria-expanded={isPanelOpen}
            aria-controls="workspace-trials-panel"
            onClick={() => setIsPanelOpen((current) => !current)}
          >
            Pruebas ({trials.length})
          </button>
        </div>
        <div
          id="workspace-trials-panel"
          className="workspace-trials-panel"
          hidden={!isPanelOpen}
        >
          <h2 id="workspace-lines-title">Partidas y pruebas</h2>
          <div className="workspace-line-list" role="list">
            {orderedWorkspaceLines(workspace).map((line) => {
              const isMain = line.id === workspace.mainLineId;
              const label = isMain
                ? "Partida principal"
                : trialLabel(workspace, line.id);
              const isActive = line.id === workspace.activeLineId;
              return (
                <div
                  className="workspace-line-row"
                  role="listitem"
                  key={line.id}
                >
                  <button
                    type="button"
                    className="workspace-line-select"
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => selectLine(line.id)}
                  >
                    <span>{label}</span>
                    {isActive ? <small>Activa</small> : null}
                  </button>
                  {!isMain ? (
                    <TrialOptions
                      label={label}
                      onPromote={() => onPromote(line.id)}
                      onDelete={(trigger) => {
                        deletionTriggerRef.current = trigger;
                        setTargetLineId(line.id);
                      }}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </section>
      {deletionStatus}
      <DeleteTrialDialog
        isOpen={targetLine !== undefined}
        lineLabel={
          targetLine ? trialLabel(workspace, targetLine.id) : undefined
        }
        onCancel={closeDeletion}
        onConfirm={() => {
          if (!targetLineId) return;
          if (trials.length === 1) {
            setDeletionNotice(
              "La prueba se eliminó. Estás en la partida principal.",
            );
          } else {
            setDeletionNotice("La prueba se eliminó.");
          }
          onDelete(targetLineId);
          setTargetLineId(undefined);
          focusAfterDeletion();
        }}
      />
    </>
  );
}
