import { useState, type FormEvent } from "react";
import type { GameSettings, HelpLevel } from "./persistence";

interface GameSetupProps {
  readonly initialSettings: GameSettings;
  readonly hasSavedGame: boolean;
  readonly onStart: (settings: GameSettings) => void;
  readonly onResume: () => void;
  readonly onClearSavedGame: () => void;
  readonly opponentName: string;
}

export function GameSetup({
  initialSettings,
  hasSavedGame,
  onStart,
  onResume,
  onClearSavedGame,
  opponentName,
}: GameSetupProps) {
  const [opponentElo, setOpponentElo] = useState(initialSettings.opponentElo);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onStart({
      playerColor: form.get("playerColor") as GameSettings["playerColor"],
      opponentElo,
      enginePreset: form.get("enginePreset") as GameSettings["enginePreset"],
      helpLevel: form.get("helpLevel") as HelpLevel,
      showEvaluation: form.get("showEvaluation") === "on",
      showArrows: form.get("showArrows") === "on",
    });
  };

  return (
    <main className="shell">
      <section className="setup" aria-labelledby="setup-title">
        <header className="setup-header">
          <p className="eyebrow">Chess Coach · Offline</p>
          <h1 id="setup-title">Nueva partida</h1>
          <p className="setup-intro">
            Practica decisiones completas contra un entrenador local. Tus
            partidas se guardan únicamente en este dispositivo.
          </p>
        </header>
        {hasSavedGame ? (
          <aside className="resume-card" role="status">
            <strong>Tienes una partida guardada</strong>
            <div className="resume-card-actions">
              <button type="button" onClick={onResume}>
                Continuar partida
              </button>
              <button
                type="button"
                className="secondary"
                onClick={onClearSavedGame}
              >
                Borrar guardado
              </button>
            </div>
          </aside>
        ) : null}
        <form className="setup-form" onSubmit={submit}>
          <fieldset className="setup-option-group setup-option-group-color">
            <legend>Tu color</legend>
            <label>
              <input
                type="radio"
                name="playerColor"
                value="white"
                defaultChecked={initialSettings.playerColor === "white"}
              />{" "}
              Blancas
            </label>
            <label>
              <input
                type="radio"
                name="playerColor"
                value="black"
                defaultChecked={initialSettings.playerColor === "black"}
              />{" "}
              Negras
            </label>
            <label>
              <input
                type="radio"
                name="playerColor"
                value="random"
                defaultChecked={initialSettings.playerColor === "random"}
              />{" "}
              Aleatorio
            </label>
          </fieldset>
          <fieldset className="setup-option-group setup-option-group-opponent">
            <legend>Fuerza de {opponentName}</legend>
            <label htmlFor="opponent-elo">
              Nivel aproximado:{" "}
              <output htmlFor="opponent-elo">{opponentElo}</output>
            </label>
            <input
              id="opponent-elo"
              name="opponentElo"
              type="range"
              min="600"
              max="2600"
              step="100"
              value={opponentElo}
              aria-describedby="opponent-elo-help"
              onChange={(event) => setOpponentElo(Number(event.target.value))}
            />
            <small id="opponent-elo-help">
              Referencia aproximada para ajustar el reto. {opponentName} no
              representa un Elo exacto.
            </small>
          </fieldset>
          <fieldset className="setup-option-group setup-option-group-engine">
            <legend>Análisis del entrenador</legend>
            <label>
              <input
                type="radio"
                name="enginePreset"
                value="beginner"
                defaultChecked={initialSettings.enginePreset === "beginner"}
              />{" "}
              Principiante
            </label>
            <label>
              <input
                type="radio"
                name="enginePreset"
                value="intermediate"
                defaultChecked={initialSettings.enginePreset === "intermediate"}
              />{" "}
              Intermedio
            </label>
            <label>
              <input
                type="radio"
                name="enginePreset"
                value="advanced"
                defaultChecked={initialSettings.enginePreset === "advanced"}
              />{" "}
              Avanzado
            </label>
          </fieldset>
          <fieldset className="setup-option-group setup-option-group-help">
            <legend>Nivel de ayuda</legend>
            <label>
              <input
                type="radio"
                name="helpLevel"
                value="none"
                defaultChecked={initialSettings.helpLevel === "none"}
              />{" "}
              Sin ayudas
            </label>
            <label>
              <input
                type="radio"
                name="helpLevel"
                value="normal"
                defaultChecked={initialSettings.helpLevel === "normal"}
              />{" "}
              Normal
            </label>
            <label>
              <input
                type="radio"
                name="helpLevel"
                value="guided"
                defaultChecked={initialSettings.helpLevel === "guided"}
              />{" "}
              Guiada
            </label>
          </fieldset>
          <fieldset className="setup-option-group setup-option-group-visuals">
            <legend>Ayudas visuales</legend>
            <label>
              <input
                type="checkbox"
                name="showEvaluation"
                defaultChecked={initialSettings.showEvaluation}
              />{" "}
              Barra de evaluación
            </label>
            <label>
              <input
                type="checkbox"
                name="showArrows"
                defaultChecked={initialSettings.showArrows}
              />{" "}
              Flechas de sugerencia
            </label>
          </fieldset>
          <footer className="setup-form-footer">
            <button type="submit">Comenzar partida</button>
          </footer>
        </form>
      </section>
    </main>
  );
}
