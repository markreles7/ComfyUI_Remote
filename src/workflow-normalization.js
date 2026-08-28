export function normalizeDynamicInputs(workflow) {
  for (const item of Object.values(workflow || {})) {
    if (!item?.inputs) continue;
    if (item.class_type === "SimpleCalculatorKJ" && !item.inputs.variables) {
      const variables = {};
      for (const name of "abcdefghijk") {
        if (!(name in item.inputs)) continue;
        variables[name] = item.inputs[name];
        delete item.inputs[name];
      }
      item.inputs.variables = variables;
    }
    if (item.class_type === "ComfyMathExpression" && item.inputs.values && typeof item.inputs.values === "object" && !Array.isArray(item.inputs.values)) {
      // COMFY_AUTOGROW_V3 usa chiavi API piatte (`values.a`, `values.b`, ...).
      // Un oggetto annidato `values: { a: ... }` passa una validazione statica
      // ingenua ma ComfyUI lo rifiuta come "Required input values.a missing".
      for (const [name, value] of Object.entries(item.inputs.values)) item.inputs[`values.${name}`] = value;
      delete item.inputs.values;
    }
  }
  return workflow;
}
