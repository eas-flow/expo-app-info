export function cellOrDash(value) {
  return value === null || value === undefined ? '-' : String(value);
}
