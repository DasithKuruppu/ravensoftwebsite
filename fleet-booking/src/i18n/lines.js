/**
 * Quote lines, worded by the browser.
 *
 * The server sends `{ key: 'overnightStay', vars: { count: 3 } }` plus an
 * English `label` alongside. Preferring the key is what lets a Sinhala customer
 * see a Sinhala price breakdown out of an English-only pricing engine; falling
 * back to `label` is what keeps a booking stored before this existed readable.
 *
 * Shared by the quote card and the booking detail so the two cannot word the
 * same line differently.
 */
export function lineLabel(t, line) {
  if (!line?.vars) return line?.label ?? '';
  const key = `line.${line.key}`;
  const translated = t(key, line.vars);
  return translated === key ? line.label : translated;
}

export function lineDetail(t, line) {
  if (!line?.vars) return line?.detail ?? '';
  const key =
    line.key === 'days'
      ? line.vars.count === 1
        ? 'line.days.detailOne'
        : 'line.days.detailMany'
      : line.key === 'overnightStay' && line.vars.hosted
        ? 'line.overnightStay.detailHosted'
        : `line.${line.key}.detail`;
  const translated = t(key, line.vars);
  return translated === key ? line.detail : translated;
}
