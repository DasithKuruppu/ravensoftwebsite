/**
 * A vehicle's name and description, worded by the browser.
 *
 * The rate card is data, not copy — it lives in DynamoDB and is edited from the
 * admin page — so its labels arrive in whatever language the owner typed them
 * in. That is why "Electric hatchback, up to 3 passengers" stayed English while
 * the rest of the page turned Sinhala.
 *
 * The dictionary wins when it has an entry for the vehicle's key; otherwise the
 * stored label is split on its separator and used as-is. So the vehicle the
 * fleet ships is properly bilingual, and one added later still renders
 * sensibly — in the owner's words — until someone adds a key for it.
 *
 * The model name itself is never translated. "BAW E7 Pro" is what is written on
 * the car.
 */
export function vehicleParts(t, vehicleClass) {
  const key = typeof vehicleClass === 'string' ? vehicleClass : vehicleClass?.key;
  const label = typeof vehicleClass === 'string' ? '' : vehicleClass?.label || '';
  const [rawName, rawNote = ''] = label.split('·').map((s) => s.trim());

  const name = pick(t, `vehicle.${key}`, rawName || key || '');
  const note = pick(t, `vehicle.${key}.note`, rawNote);
  return [name, note];
}

/** The dictionary's wording, or the fallback when it has none. */
function pick(t, key, fallback) {
  const translated = t(key);
  return translated === key ? fallback : translated;
}
