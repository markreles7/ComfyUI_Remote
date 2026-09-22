export function compactFormData(source) {
  const input = source instanceof FormData ? source : new FormData(source);
  const compact = new FormData();
  for (const [name, value] of input.entries()) {
    if (value instanceof File && value.size === 0 && !value.name) continue;
    compact.append(name, value);
  }
  return compact;
}
