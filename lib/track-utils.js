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
