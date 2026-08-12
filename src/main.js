import './style.css';
import { initDb } from './db.js';
import { renderImport } from './ui.js';

if ('storage' in navigator && 'persist' in navigator.storage) {
  navigator.storage.persist();
}

const app = document.getElementById('app');

async function main() {
  await initDb();
  // Phase 3: seul l'écran d'import est branché pour l'instant.
  // Home / Quiz / Réglages arrivent dans les phases suivantes.
  renderImport(app);
}

main();
