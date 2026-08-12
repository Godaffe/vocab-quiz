import './style.css';
import { initDb, save, run, all } from './db.js';

if ('storage' in navigator && 'persist' in navigator.storage) {
  navigator.storage.persist();
}

const app = document.getElementById('app');
app.innerHTML = `
  <h1>Vocab Quiz</h1>
  <p>Phase 2 — vérification SQLite/IndexedDB (débug, sera remplacé par les vrais écrans).</p>
  <button id="insert-btn">Insérer un mot factice</button>
  <button id="reload-btn">Recharger la page</button>
  <pre id="output" style="white-space:pre-wrap;font-size:12px;"></pre>
`;

const output = document.getElementById('output');

function render(rows) {
  output.textContent = JSON.stringify(rows, null, 2);
}

async function main() {
  await initDb();
  render(all('SELECT * FROM vocabulaire'));

  document.getElementById('insert-btn').addEventListener('click', async () => {
    const now = new Date().toISOString();
    const n = all('SELECT COUNT(*) as c FROM vocabulaire')[0].c + 1;
    const key = `debug-${n}`;
    run(
      'INSERT INTO vocabulaire (key, fr, en, en_base, example, type, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [key, `Mot factice ${n}`, `Dummy word ${n}`, `Dummy word ${n}`, 'Example sentence.', 'Nom', now]
    );
    run(
      'INSERT INTO progress (item_type, item_key, box_level, is_learned, total_reviews, created_at) VALUES (?, ?, 0, 0, 0, ?)',
      ['vocabulaire', key, now]
    );
    await save();
    render(all('SELECT * FROM vocabulaire'));
  });

  document.getElementById('reload-btn').addEventListener('click', () => {
    location.reload();
  });
}

main();
