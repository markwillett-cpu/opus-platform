export function normalizeClassCode(code) {
  const c = String(code || '').trim().toUpperCase();
  if (c === 'REST') return 'REST';
  if (c === 'A' || c === 'B' || c === 'C') return c;
  return null;
}

export function normalizeStyleId(id) {
  return String(id || '').trim();
}
