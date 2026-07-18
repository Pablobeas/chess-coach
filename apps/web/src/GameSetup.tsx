import type { FormEvent } from "react";
import type { GameSettings, HelpLevel } from "./persistence";

interface GameSetupProps {
  readonly initialSettings: GameSettings;
  readonly hasSavedGame: boolean;
  readonly onStart: (settings: GameSettings) => void;
  readonly onResume: () => void;
  readonly onClearSavedGame: () => void;
}

export function GameSetup({
  initialSettings,
  hasSavedGame,
  onStart,
  onResume,
  onClearSavedGame,
}: GameSetupProps) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onStart({
      playerColor: form.get("playerColor") as GameSettings["playerColor"],
      enginePreset: form.get("enginePreset") as GameSettings["enginePreset"],
      helpLevel: form.get("helpLevel") as HelpLevel,
      showEvaluation: form.get("showEvaluation") === "on",
      showArrows: form.get("showArrows") === "on",
      showThreats: form.get("showThreats") === "on",
      soundEnabled: form.get("soundEnabled") === "on",
    });
  };

  return (
    <main className="shell">
      <section className="setup" aria-labelledby="setup-title">
        <p className="eyebrow">Chess Coach · Offline</p>
        <h1 id="setup-title">Nueva partida</h1>
        <p className="setup-intro">
          Practica decisiones completas contra un entrenador local. Tus partidas
          se guardan únicamente en este dispositivo.
        </p>
        {hasSavedGame ? (
          <div className="resume-card" role="status">
            <strong>Tienes una partida guardada</strong>
            <div className="controls">
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
          </div>
        ) : null}
        <form className="setup-form" onSubmit={submit}>
          <fieldset>
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
          <fieldset>
            <legend>Fuerza del entrenador</legend>
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
          <fieldset>
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
          <fieldset>
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
            <label>
              <input
                type="checkbox"
                name="showThreats"
                defaultChecked={initialSettings.showThreats}
              />{" "}
              Amenazas
            </label>
            <label>
              <input
                type="checkbox"
                name="soundEnabled"
                defaultChecked={initialSettings.soundEnabled}
              />{" "}
              Sonido
            </label>
          </fieldset>
          <button type="submit">Comenzar partida</button>
        </form>
      </section>
    </main>
  );
}
