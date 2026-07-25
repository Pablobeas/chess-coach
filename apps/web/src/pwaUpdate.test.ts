// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  PWA_ACTIVATE_EVENT,
  activateWaitingServiceWorker,
  getWaitingServiceWorker,
  subscribeToVersionChecks,
} from "./pwaUpdate";

describe("PWA update activation", () => {
  it("persists before explicitly activating a waiting worker", () => {
    const persist = vi.fn();
    const postMessage = vi.fn();
    const announced = vi.fn();
    window.addEventListener(PWA_ACTIVATE_EVENT, announced, { once: true });
    const registration = {
      waiting: { postMessage },
    } as unknown as ServiceWorkerRegistration;

    expect(activateWaitingServiceWorker(registration, persist)).toBe(true);
    expect(persist).toHaveBeenCalledBefore(postMessage);
    expect(postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(announced).toHaveBeenCalledTimes(1);
  });

  it("does not activate without a waiting worker", () => {
    expect(
      activateWaitingServiceWorker({} as ServiceWorkerRegistration, vi.fn()),
    ).toBe(false);
  });

  it("finds a worker that was already waiting before the UI subscribed", async () => {
    const registration = { waiting: {} } as ServiceWorkerRegistration;
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistration: vi.fn(async () => registration) },
    });
    await expect(getWaitingServiceWorker()).resolves.toBe(registration);
  });

  it("never fetches version metadata, checks on mount and reconnect, and cleans up", async () => {
    let onlineListener: (() => void) | undefined;
    const addEventListener = vi.fn((_type: "online", listener: () => void) => {
      onlineListener = listener;
    });
    const removeEventListener = vi.fn();
    const update = vi.fn(async () => undefined);
    const getRegistration = vi.fn(async () => ({ update }));
    const cleanup = subscribeToVersionChecks(
      {
        onLine: false,
        serviceWorker: { getRegistration },
      },
      { addEventListener, removeEventListener },
    );
    await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(addEventListener).toHaveBeenCalledOnce();

    onlineListener?.();
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(getRegistration).toHaveBeenCalledTimes(2);

    cleanup();
    expect(removeEventListener).toHaveBeenCalledWith("online", onlineListener);
  });
});
