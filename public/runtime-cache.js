const CONFIG_KEY = "ltx-remote:app-config:v1";
const CONFIG_MAX_AGE_MS = 5 * 60_000;
let configPromise = null;
let bootstrapRetryTimer = null;
let configRetryDelayMs = 1200;

function readCachedConfig() {
  try {
    const cached = JSON.parse(localStorage.getItem(CONFIG_KEY) || "null");
    if (!cached?.value || !Number.isFinite(cached.savedAt)) return null;
    return cached;
  } catch {
    return null;
  }
}

function storeConfig(value) {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ value, savedAt: Date.now() }));
  } catch {
    // La configurazione resta disponibile in memoria se lo storage è pieno o disabilitato.
  }
  return value;
}

function capabilitySignature(value) {
  const h3 = value?.videoStudio?.h3;
  return JSON.stringify({
    h3: Boolean(h3?.available),
    actionH3: Boolean(h3?.actionAvailable),
    h3Files: h3?.files || {},
    videoModes: (value?.videoStudio?.modes || []).map((item) => item.id),
  });
}

function publishConfigUpdate(value, previousValue) {
  if (value?.cache?.bootstrap || value?.cache?.stale) return;
  if (capabilitySignature(value) === capabilitySignature(previousValue)) return;
  if (typeof globalThis.dispatchEvent !== "function" || typeof globalThis.CustomEvent !== "function") return;
  globalThis.dispatchEvent(new CustomEvent("ltx-remote:config-updated", {
    detail: { value, capabilityChanged: true },
  }));
}

function scheduleConfigRefresh() {
  if (bootstrapRetryTimer) return;
  bootstrapRetryTimer = setTimeout(async () => {
    bootstrapRetryTimer = null;
    try {
      const previousValue = readCachedConfig()?.value || null;
      const value = await fetchConfig();
      if (value?.cache?.bootstrap || value?.cache?.stale) {
        scheduleConfigRefresh();
        return;
      }
      publishConfigUpdate(value, previousValue);
    } catch {
      scheduleConfigRefresh();
    }
  }, configRetryDelayMs);
  configRetryDelayMs = Math.min(15_000, Math.round(configRetryDelayMs * 1.7));
}

async function fetchConfig({ force = false } = {}) {
  if (configPromise) return configPromise;
  configPromise = fetch(`/api/config${force ? "?refresh=1" : ""}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
  })
    .then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Configurazione non disponibile (${response.status})`);
      if (payload.cache?.bootstrap || payload.cache?.stale) scheduleConfigRefresh();
      else configRetryDelayMs = 1200;
      // Una risposta bootstrap nasce senza un inventario ComfyUI verificato:
      // non deve sostituire nel browser l'ultima configurazione valida.
      return payload.cache?.bootstrap ? payload : storeConfig(payload);
    })
    .finally(() => {
      configPromise = null;
    });
  return configPromise;
}

export async function getAppConfig({ force = false } = {}) {
  const cached = !force ? readCachedConfig() : null;
  if (cached && Date.now() - cached.savedAt <= CONFIG_MAX_AGE_MS) {
    void fetchConfig()
      .then((value) => {
        publishConfigUpdate(value, cached.value);
      })
      .catch(() => {});
    return cached.value;
  }
  return fetchConfig({ force });
}

export function warmAppConfig() {
  const cached = readCachedConfig();
  if (cached && Date.now() - cached.savedAt <= CONFIG_MAX_AGE_MS) return Promise.resolve(cached.value);
  return fetchConfig().catch(() => null);
}

export function createAdaptivePoller(task, {
  active = () => false,
  activeMs = 3500,
  idleMs = 15_000,
  hiddenMs = 45_000,
} = {}) {
  let timer = null;
  let stopped = false;
  let running = false;

  const schedule = () => {
    if (stopped) return;
    const delay = document.hidden ? hiddenMs : active() ? activeMs : idleMs;
    clearTimeout(timer);
    timer = setTimeout(run, delay);
  };

  const run = async () => {
    if (stopped || running) return schedule();
    running = true;
    try {
      await task();
    } finally {
      running = false;
      schedule();
    }
  };

  const visibilityHandler = () => {
    clearTimeout(timer);
    if (!document.hidden) void run();
    else schedule();
  };
  document.addEventListener("visibilitychange", visibilityHandler);
  schedule();
  return {
    refresh: run,
    stop() {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibilityHandler);
    },
  };
}
