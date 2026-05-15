import { mkdir, readFile, rename, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';

let rootDir = join(process.cwd(), 'data', 'patrol-tracks');
let indexPath = join(process.cwd(), 'data', 'patrol-tracks-index.json');

export function configureTrackStore({ rootDir: r } = {}) {
  if (r) {
    rootDir = r;
    indexPath = join(r, '..', 'patrol-tracks-index.json');
  }
}

function trackPath(patrolId) {
  return join(rootDir, `${String(patrolId)}.json`);
}

async function atomicWrite(filePath, content) {
  await mkdir(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, content);
  await rename(tmp, filePath);
}

export async function writeTrack(patrolId, track) {
  await atomicWrite(trackPath(patrolId), `${JSON.stringify(track)}\n`);
}

export async function readTrack(patrolId) {
  try {
    const raw = await readFile(trackPath(patrolId), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function hasTrack(patrolId) {
  try { await access(trackPath(patrolId)); return true; }
  catch { return false; }
}

export async function readIndex() {
  try {
    const raw = await readFile(indexPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

export async function writeIndex(index) {
  await atomicWrite(indexPath, `${JSON.stringify(index, null, 2)}\n`);
}

export async function upsertIndexEntry(patrolId, entry) {
  const idx = await readIndex();
  idx[String(patrolId)] = { ...(idx[String(patrolId)] || {}), ...entry };
  await writeIndex(idx);
}

export async function needsRefetch(patrol) {
  const id = String(patrol.id);
  const ended = Boolean(patrol?.patrol_segments?.[0]?.time_range?.end_time);
  const idx = await readIndex();
  const entry = idx[id];
  if (!entry) return true;
  if (!ended) return true;
  if (!entry.patrol_ended) return true;
  return false;
}
