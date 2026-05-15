export function extractCoordinates(track) {
  if (!track) return [];
  if (track.type === 'FeatureCollection' && Array.isArray(track.features)) {
    const out = [];
    for (const feature of track.features) out.push(...coordsFromGeom(feature?.geometry));
    return out;
  }
  if (track.type === 'Feature') return coordsFromGeom(track.geometry);
  if (Array.isArray(track.coordinates)) return track.coordinates;
  return [];
}

function coordsFromGeom(geom) {
  if (!geom || !geom.coordinates) return [];
  if (geom.type === 'LineString') return geom.coordinates;
  if (geom.type === 'MultiLineString') return geom.coordinates.flat();
  if (geom.type === 'Point') return [geom.coordinates];
  return [];
}

export function extractCoordinatesWithTimes(track) {
  const coordinates = [];
  const times = [];
  let hasTimestamps = true;

  const features = trackFeatures(track);
  if (!features.length) return { coordinates: [], times: [], hasTimestamps: false };

  for (const feature of features) {
    const coords = coordsFromGeom(feature.geometry);
    const rawTimes = feature?.properties?.coordinateProperties?.times;

    if (!Array.isArray(rawTimes) || rawTimes.length !== coords.length) {
      hasTimestamps = false;
      coordinates.push(...coords);
      for (let i = 0; i < coords.length; i++) times.push(null);
      continue;
    }

    for (let i = 0; i < coords.length; i++) {
      coordinates.push(coords[i]);
      const parsed = Date.parse(rawTimes[i]);
      if (Number.isNaN(parsed)) { hasTimestamps = false; times.push(null); }
      else times.push(parsed);
    }
  }

  return { coordinates, times, hasTimestamps };
}

function trackFeatures(track) {
  if (!track) return [];
  if (track.type === 'FeatureCollection' && Array.isArray(track.features)) return track.features;
  if (track.type === 'Feature') return [track];
  return [];
}

const EARTH_RADIUS_KM = 6371.0088;

export function haversineKm(a, b) {
  if (!a || !b) return 0;
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function midpoint(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

export function pointToLineDistanceKm(point, lineCoords) {
  if (!Array.isArray(lineCoords) || lineCoords.length < 2) {
    if (lineCoords?.length === 1) return haversineKm(point, lineCoords[0]);
    return Infinity;
  }
  let min = Infinity;
  for (let i = 1; i < lineCoords.length; i++) {
    const d = segmentDistanceKm(point, lineCoords[i - 1], lineCoords[i]);
    if (d < min) min = d;
  }
  return min;
}

function segmentDistanceKm(p, a, b) {
  const latRef = (a[1] + b[1]) / 2;
  const scale = Math.cos((latRef * Math.PI) / 180);
  const toXY = ([lon, lat]) => [lon * scale, lat];
  const [px, py] = toXY(p);
  const [ax, ay] = toXY(a);
  const [bx, by] = toXY(b);
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  const projLon = projX / scale;
  return haversineKm(p, [projLon, projY]);
}

export function nearestBoundary(point, boundaries) {
  if (!Array.isArray(boundaries) || boundaries.length === 0) return null;
  let best = null;
  let bestKm = Infinity;
  for (const b of boundaries) {
    for (const line of boundaryLines(b)) {
      const d = pointToLineDistanceKm(point, line);
      if (d < bestKm) { bestKm = d; best = b; }
    }
  }
  return best;
}

function boundaryLines(b) {
  const geom = b?.geometry;
  if (!geom) return [];
  const t = b.geometryType || geom.type;
  if (t === 'LineString') return [geom.coordinates || []];
  if (t === 'MultiLineString') return geom.coordinates || [];
  if (t === 'Polygon') return geom.coordinates || [];
  if (t === 'MultiPolygon') return (geom.coordinates || []).flat();
  if (Array.isArray(geom.coordinates)) return [geom.coordinates];
  return [];
}
