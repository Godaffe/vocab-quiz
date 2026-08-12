import { getDb, restoreFromBytes, setSetting } from './db.js';
import { putBlob, deleteBlob, listKeys } from './idb.js';

const BACKUP_PREFIX = 'backup-';
const MAX_INTERNAL_BACKUPS = 3;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Silent, automatic, internal-only snapshot (lives in the same IndexedDB origin as the
// main DB — protects against a bad import/mistake, not against the whole origin being
// cleared). Called once per app load.
export async function rotateInternalBackup() {
  const bytes = getDb().export();
  await putBlob(BACKUP_PREFIX + todayISO(), bytes.buffer);

  const keys = (await listKeys(BACKUP_PREFIX)).sort();
  while (keys.length > MAX_INTERNAL_BACKUPS) {
    await deleteBlob(keys.shift());
  }
}

// Manual export to the Files app — the only backup that survives the whole origin's
// storage being cleared. Must be triggered by a real user gesture (browser requirement).
export async function exportToFile() {
  const bytes = getDb().export();
  const blob = new Blob([bytes], { type: 'application/x-sqlite3' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vocab-backup-${todayISO()}.sqlite`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  await setSetting('last_manual_export', todayISO());
}

export async function importFromFile(file) {
  const buffer = await file.arrayBuffer();
  await restoreFromBytes(buffer);
}

export function daysSince(isoDate) {
  if (!isoDate) return null;
  const ms = new Date(`${todayISO()}T00:00:00Z`) - new Date(`${isoDate}T00:00:00Z`);
  return Math.round(ms / 86400000);
}
