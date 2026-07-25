export const PWA_UPDATE_EVENT = "chess-coach:update-ready";
export const PWA_ACTIVATE_EVENT = "chess-coach:activate-update";

export interface VersionCheckNavigator {
  readonly onLine: boolean;
  readonly serviceWorker?: {
    getRegistration(): Promise<{ update(): Promise<unknown> } | undefined>;
  };
}

export interface OnlineEventTarget {
  addEventListener(type: "online", listener: () => void): void;
  removeEventListener(type: "online", listener: () => void): void;
}

export function subscribeToVersionChecks(
  navigatorRef: VersionCheckNavigator,
  eventTarget: OnlineEventTarget = window,
): () => void {
  const check = () => {
    // Do not fetch version.json from application code. update() delegates
    // network policy (including offline behavior) to the service worker stack.
    const registrationPromise = navigatorRef.serviceWorker?.getRegistration();
    if (!registrationPromise) return;
    void registrationPromise
      .then((registration) => registration?.update())
      .catch(() => undefined);
  };
  check();
  eventTarget.addEventListener("online", check);
  return () => eventTarget.removeEventListener("online", check);
}

export async function getWaitingServiceWorker(): Promise<
  ServiceWorkerRegistration | undefined
> {
  if (!("serviceWorker" in navigator)) return undefined;
  const registration = await navigator.serviceWorker.getRegistration();
  return registration?.waiting ? registration : undefined;
}

export function activateWaitingServiceWorker(
  registration: ServiceWorkerRegistration,
  persistWorkspace: () => void,
): boolean {
  const worker = registration.waiting;
  if (!worker) return false;
  persistWorkspace();
  window.dispatchEvent(new Event(PWA_ACTIVATE_EVENT));
  worker.postMessage({ type: "SKIP_WAITING" });
  return true;
}
