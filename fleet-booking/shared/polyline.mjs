/**
 * Google's encoded polyline format, which is what OSRM returns for a route's
 * geometry.
 *
 * Twenty lines rather than a dependency: the format is a signed-value varint —
 * each number is offset from the previous one, zig-zag encoded so negatives stay
 * small, then chunked into six-bit groups with a continuation flag and shifted
 * into printable ASCII. Decoding is the same steps backwards.
 *
 * Kept in `shared/` and pure so it can be tested in Node without a browser, even
 * though only the map uses it.
 */

/** Encoded string → `[[lat, lon], …]`. Returns [] for anything malformed. */
export function decodePolyline(encoded, precision = 5) {
  if (typeof encoded !== 'string' || encoded.length === 0) return [];

  const factor = 10 ** precision;
  const points = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  while (index < encoded.length) {
    const dLat = nextValue();
    const dLon = nextValue();
    // A truncated string leaves a half-read value; stop rather than emit a point
    // at a latitude that was never transmitted.
    if (dLat === null || dLon === null) break;
    lat += dLat;
    lon += dLon;
    points.push([lat / factor, lon / factor]);
  }

  return points;

  function nextValue() {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      if (index >= encoded.length) return null;
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0) return null;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    // Bit 0 is the sign: odd values were negative before the zig-zag.
    return result & 1 ? ~(result >> 1) : result >> 1;
  }
}

/** The [south, west], [north, east] corners of a set of `[lat, lon]` points. */
export function boundsOf(points) {
  if (!points || points.length === 0) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const [lat, lon] of points) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  if (minLat === Infinity) return null;
  return [
    [minLat, minLon],
    [maxLat, maxLon],
  ];
}
