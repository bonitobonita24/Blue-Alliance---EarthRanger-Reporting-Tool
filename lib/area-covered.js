import { readTrack } from './track-store.js';
import {
  extractCoordinatesWithTimes,
  haversineKm,
  midpoint,
  nearestBoundary
} from './track-utils.js';

export async function aggregateAreaCovered({ patrolIds, boundaries, patrolHoursById = {} }) {
  const aggregates = {};
  const missing_tracks = [];

  for (const pid of patrolIds) {
    const track = await readTrack(pid);
    if (!track) { missing_tracks.push(String(pid)); continue; }
    accumulatePatrol({
      track,
      boundaries,
      patrolTotalHrs: Number(patrolHoursById[pid]) || 0,
      aggregates
    });
  }

  return { aggregates, missing_tracks, generated_at: new Date().toISOString() };
}

function accumulatePatrol({ track, boundaries, patrolTotalHrs, aggregates }) {
  const { coordinates, times, hasTimestamps } = extractCoordinatesWithTimes(track);
  if (coordinates.length < 2) return;

  const perBoundaryKm = {};
  const perBoundaryHrs = {};
  let patrolTotalKm = 0;

  for (let i = 1; i < coordinates.length; i++) {
    const a = coordinates[i - 1];
    const b = coordinates[i];
    const segKm = haversineKm(a, b);
    if (segKm <= 0) continue;
    patrolTotalKm += segKm;

    const hit = nearestBoundary(midpoint(a, b), boundaries);
    if (!hit) continue;

    perBoundaryKm[hit.id] = (perBoundaryKm[hit.id] || 0) + segKm;

    if (hasTimestamps) {
      // EarthRanger returns tracks newest-first, so adjacent deltas may be negative.
      // The duration between two points is order-independent.
      const dtMs = Math.abs(times[i] - times[i - 1]);
      const hrs = Number.isFinite(dtMs) && dtMs > 0 ? dtMs / 3.6e6 : 0;
      perBoundaryHrs[hit.id] = (perBoundaryHrs[hit.id] || 0) + hrs;
    }
  }

  if (!hasTimestamps && patrolTotalKm > 0) {
    for (const [bid, km] of Object.entries(perBoundaryKm)) {
      perBoundaryHrs[bid] = patrolTotalHrs * (km / patrolTotalKm);
    }
  }

  for (const [bid, km] of Object.entries(perBoundaryKm)) {
    const boundary = boundaries.find((b) => String(b.id) === String(bid));
    if (!aggregates[bid]) {
      aggregates[bid] = {
        boundary_name: boundary?.name || bid,
        coverage_patrols: 0,
        coverage_km: 0,
        coverage_hrs: 0,
        hrs_estimated_count: 0,
        hrs_actual_count: 0
      };
    }
    aggregates[bid].coverage_patrols += 1;
    aggregates[bid].coverage_km += km;
    aggregates[bid].coverage_hrs += perBoundaryHrs[bid] || 0;
    if (hasTimestamps) aggregates[bid].hrs_actual_count += 1;
    else aggregates[bid].hrs_estimated_count += 1;
  }
}
