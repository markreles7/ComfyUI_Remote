// Validate the active workflow only. Native submit validation runs before the
// submit listener and can silently stop on a control in a collapsed section.
export function validateGenerationForm(form, errorElement) {
  errorElement.textContent = "";
  const invalid = [...form.elements].find((field) =>
    field.willValidate
    && !field.closest(".hidden, [hidden]")
    && !field.validity.valid
  );
  if (!invalid) return true;

  const label = invalid.labels?.[0]?.textContent?.trim().replace(/\s+/g, " ")
    || invalid.getAttribute("aria-label") || invalid.name || "Campo obbligatorio";
  errorElement.textContent = `${label}: ${invalid.validationMessage}`;
  for (let parent = invalid.parentElement; parent; parent = parent.parentElement) {
    if (parent.tagName === "DETAILS") parent.open = true;
  }
  const target = invalid.closest(".dropzone, .field") || invalid;
  target.scrollIntoView({ block: "center", behavior: "smooth" });
  invalid.focus({ preventScroll: true });
  invalid.reportValidity();
  return false;
}
