import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { APPLICATION_BASE, applicationUrl } from "./applicationUrl";
import { PWA_ACTIVATE_EVENT, PWA_UPDATE_EVENT } from "./pwaUpdate";
import "./styles.css";

const CACHE_PREFIX = "chess-coach-";

async function clearDevelopmentServiceWorkerState() {
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    registrations.map((registration) => registration.unregister()),
  );
  if ("caches" in window) {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((cacheName) => cacheName.startsWith(CACHE_PREFIX))
        .map((cacheName) => caches.delete(cacheName)),
    );
  }
}

function announceWaitingUpdate(registration: ServiceWorkerRegistration) {
  if (!registration.waiting) return;
  window.dispatchEvent(
    new CustomEvent<ServiceWorkerRegistration>(PWA_UPDATE_EVENT, {
      detail: registration,
    }),
  );
}

function registerServiceWorker() {
  let reloadAfterActivation = false;
  window.addEventListener(PWA_ACTIVATE_EVENT, () => {
    reloadAfterActivation = true;
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadAfterActivation) window.location.reload();
  });
  void navigator.serviceWorker
    .register(applicationUrl("sw.js").toString(), {
      scope: APPLICATION_BASE,
      updateViaCache: "none",
    })
    .then((registration) => {
      announceWaitingUpdate(registration);
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (
            installing.state === "installed" &&
            navigator.serviceWorker.controller
          )
            announceWaitingUpdate(registration);
        });
      });
    })
    .catch(() => undefined);
}

if ("serviceWorker" in navigator) {
  if (import.meta.env.DEV) {
    void clearDevelopmentServiceWorkerState().catch(() => undefined);
  } else {
    window.addEventListener("load", registerServiceWorker, { once: true });
  }
}

if ("storage" in navigator && "persist" in navigator.storage) {
  // Best-effort only; storage durability must never delay a move or setup.
  void navigator.storage.persist().catch(() => false);
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
