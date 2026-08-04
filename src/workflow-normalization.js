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
    if (item.class_type === "ComfyMathExpression" && !item.inputs.values) {
      const values = {};
      for (const [name, value] of Object.entries(item.inputs)) {
        if (!name.startsWith("values.")) continue;
        values[name.slice("values.".length)] = value;
        delete item.inputs[name];
      }
      item.inputs.values = values;
    }
  }
  return workflow;
}
