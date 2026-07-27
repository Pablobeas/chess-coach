// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  EMPTY_TRAINING_PROGRESS,
  TRAINING_STORAGE_KEY,
  loadTrainingProgress,
  saveTrainingProgress,
} from "./trainingPersistence";

describe("training persistence", () => {
  it("uses a separate versioned, minimal record and rejects malformed data", () => {
    const storage = window.localStorage;
    storage.clear();
    saveTrainingProgress(
      {
        schemaVersion: 1,
        completedPuzzleIds: ["mate-1"],
        lastPuzzleId: "mate-1",
      },
      storage,
    );
    expect(JSON.parse(storage.getItem(TRAINING_STORAGE_KEY)!)).toEqual({
      schemaVersion: 1,
      completedPuzzleIds: ["mate-1"],
      lastPuzzleId: "mate-1",
    });
    storage.setItem(TRAINING_STORAGE_KEY, "{bad");
    expect(loadTrainingProgress(storage)).toEqual(EMPTY_TRAINING_PROGRESS);
  });
});
