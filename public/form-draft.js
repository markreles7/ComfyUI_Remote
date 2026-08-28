const DEFAULT_MAX_AGE_MS = 24 * 60 * 60_000;

function fieldKey(field, index) {
  if (field.id) return field.id;
  if (field.name && (field.type === "radio" || field.type === "checkbox")) {
    return `${field.name}:${field.value || index}`;
  }
  return field.name ? `${field.name}:${index}` : `field-${index}`;
}

function storableFields(form) {
  return [...form.elements].filter((field) =>
    field
    && field.type !== "file"
    && field.type !== "submit"
    && field.type !== "button"
    && field.type !== "reset"
    && !field.disabled
  );
}

function capture(form) {
  return storableFields(form).map((field, index) => ({
    key: fieldKey(field, index),
    type: field.type || field.tagName.toLowerCase(),
    value: field.value,
    checked: Boolean(field.checked),
  }));
}

function restore(form, fields) {
  const saved = new Map((fields || []).map((field) => [`${field.key}:${field.type}`, field]));
  storableFields(form).forEach((field, index) => {
    const item = saved.get(`${fieldKey(field, index)}:${field.type || field.tagName.toLowerCase()}`);
    if (!item) return;
    if (field.type === "checkbox" || field.type === "radio") field.checked = item.checked;
    else field.value = item.value;
  });
}

export function attachFormDraft(form, {
  key,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
  onRestore = null,
} = {}) {
  if (!form || !key) return { restored: false, save() {}, clear() {} };
  let timer = null;

  const save = () => {
    clearTimeout(timer);
    try {
      sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), fields: capture(form) }));
    } catch {
      // Il form continua a funzionare anche con storage disabilitato o pieno.
    }
  };

  let restored = false;
  try {
    const payload = JSON.parse(sessionStorage.getItem(key) || "null");
    if (payload?.savedAt && Date.now() - payload.savedAt <= maxAgeMs) {
      restore(form, payload.fields);
      restored = true;
      onRestore?.();
    } else if (payload) {
      sessionStorage.removeItem(key);
    }
  } catch {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // Storage completamente disabilitato: nessun ripristino, nessun blocco del form.
    }
  }

  const scheduleSave = () => {
    clearTimeout(timer);
    timer = setTimeout(save, 200);
  };
  form.addEventListener("input", scheduleSave);
  form.addEventListener("change", scheduleSave);
  window.addEventListener("pagehide", save);

  return {
    restored,
    save,
    clear() {
      clearTimeout(timer);
      sessionStorage.removeItem(key);
    },
  };
}
