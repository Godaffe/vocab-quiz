import { parseWorkbookFile, importFromWorkbook } from './importer.js';
import {
  startSession, checkBase, checkConjugation, finalizeVocabItem, checkAnswer, finalizeItem,
  checkReverse, gradeHardAttempt,
} from './quiz.js';
import { getSetting, setSetting } from './db.js';
import { exportToFile, importFromFile, daysSince } from './backup.js';
import { getAllProgress, advancedPhase, demotedPhase } from './leitner.js';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function summaryRowHtml(label, s) {
  if (!s.sheetFound) {
    return `<p><strong>${label}</strong> : feuille introuvable dans le fichier.</p>`;
  }
  const dup = s.duplicateId.length
    ? ` — <span style="color:#dc2626">ID en double ignorés : ${s.duplicateId.join(', ')}</span>`
    : '';
  return `<p><strong>${label}</strong> : ${s.new} nouveau(x), ${s.updated} mis à jour, ${s.unchanged} inchangé(s), ${s.skipped} ligne(s) ignorée(s) (ID/colonnes manquants)${dup}</p>`;
}

export function renderImport(container) {
  container.innerHTML = `
    <h1>Importer le vocabulaire</h1>
    <p>Sélectionne ton fichier Excel (.xlsx). Réimporter est sans risque : le contenu est mis à
    jour mais ta progression de révision n'est jamais effacée.</p>
    <input type="file" id="import-file" accept=".xlsx" />
    <div id="import-summary"></div>
  `;

  const fileInput = container.querySelector('#import-file');
  const summaryEl = container.querySelector('#import-summary');

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;

    summaryEl.innerHTML = '<p>Import en cours…</p>';
    try {
      const buffer = await file.arrayBuffer();
      const workbook = parseWorkbookFile(buffer);
      const summary = await importFromWorkbook(workbook, todayISO());

      summaryEl.innerHTML = [
        summaryRowHtml('Vocabulaire', summary.vocabulaire),
        summaryRowHtml('Grammaire', summary.grammaire),
        summaryRowHtml('Expressions', summary.expressions),
      ].join('');
    } catch (err) {
      summaryEl.innerHTML = `<p style="color:#dc2626">Erreur lors de l'import : ${err.message}</p>`;
    } finally {
      fileInput.value = '';
    }
  });
}

export async function renderHome(container, { onStartSession }) {
  container.innerHTML = '<h1>Vocab Quiz</h1><p>Chargement…</p>';
  const session = await startSession();
  const total = session.hardItems.length + session.newItems.length + session.reviewItems.length;
  container.innerHTML = `
    <h1>Vocab Quiz</h1>
    <p>${session.hardItems.length} en mode compliqué, ${session.newItems.length} nouveau(x),
    ${session.reviewItems.length} en révision aujourd'hui.</p>
    <button id="start-session-btn" ${total === 0 ? 'disabled' : ''}>Commencer la session</button>
  `;
  if (total > 0) {
    container.querySelector('#start-session-btn').addEventListener('click', () => onStartSession(session));
  }
}

function askInput(container, { header, prompt, hint }) {
  return new Promise((resolve) => {
    container.innerHTML = `
      <p class="progress-header">${escapeHtml(header)}</p>
      <p class="prompt">${escapeHtml(prompt)}</p>
      ${hint ? `<p><em>${escapeHtml(hint)}</em></p>` : ''}
      <input type="text" id="answer-input" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" />
      <button id="submit-btn">Valider</button>
    `;
    const input = container.querySelector('#answer-input');
    const submit = () => resolve(input.value);
    container.querySelector('#submit-btn').addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    input.focus();
  });
}

function showCorrection(container, { header, isCorrect, expected, tag, example, rule }) {
  return new Promise((resolve) => {
    container.innerHTML = `
      <p class="progress-header">${escapeHtml(header)}</p>
      <p style="color:${isCorrect ? '#16a34a' : '#dc2626'}"><strong>${isCorrect ? 'Correct !' : 'Incorrect'}</strong></p>
      <p>Réponse attendue : <strong>${escapeHtml(expected)}</strong></p>
      ${tag ? `<p><em>${escapeHtml(tag)}</em></p>` : ''}
      ${example ? `<p>Exemple : ${escapeHtml(example)}</p>` : ''}
      ${rule ? `<p>Règle : ${escapeHtml(rule)}</p>` : ''}
      <button id="next-btn">${isCorrect ? 'Suivant' : 'Réessayer'}</button>
    `;
    container.querySelector('#next-btn').addEventListener('click', () => resolve());
  });
}

function showPreview(container, { header, prompt, answer, tag, example, rule }) {
  return new Promise((resolve) => {
    container.innerHTML = `
      <p class="progress-header">${escapeHtml(header)}</p>
      <p class="prompt">${escapeHtml(prompt)}</p>
      <p>Réponse : <strong>${escapeHtml(answer)}</strong></p>
      ${tag ? `<p><em>${escapeHtml(tag)}</em></p>` : ''}
      ${example ? `<p>Exemple : ${escapeHtml(example)}</p>` : ''}
      ${rule ? `<p>Règle : ${escapeHtml(rule)}</p>` : ''}
      <button id="next-btn">Suivant</button>
    `;
    container.querySelector('#next-btn').addEventListener('click', () => resolve());
  });
}

async function previewItem(container, item, header) {
  if (item.item_type === 'vocabulaire') {
    const answer = item.en_past_simple
      ? `${item.en_base} (${item.en_past_simple} / ${item.en_past_participle})`
      : item.en_base;
    await showPreview(container, { header, prompt: item.prompt, answer, tag: item.type, example: item.example });
  } else if (item.item_type === 'grammaire') {
    await showPreview(container, { header, prompt: item.prompt, answer: item.en, rule: item.explication });
  } else if (item.item_type === 'expressions') {
    await showPreview(container, { header, prompt: item.prompt, answer: item.en, example: item.example });
  }
}

// Redemande la même question jusqu'à une bonne réponse. Seule la première tentative
// (retournée ici) compte pour la note Leitner — les redemandes suivantes ne sont qu'un
// entraînement affiché à l'écran.
async function askUntilCorrect(container, header, prompt, checkFn, correctionFields) {
  let first = null;
  while (true) {
    const answer = await askInput(container, { header, prompt });
    const isCorrect = checkFn(answer);
    if (first === null) first = isCorrect;
    await showCorrection(container, { header, isCorrect, ...correctionFields });
    if (isCorrect) break;
  }
  return first;
}

async function runVocabQuestion(container, item, header) {
  const baseCorrect = await askUntilCorrect(
    container, header, item.prompt,
    (answer) => checkBase(item, answer),
    { expected: item.en_base, tag: item.type, example: item.example }
  );

  let conjugationCorrect = true;
  if (item.en_past_simple) {
    conjugationCorrect = await askUntilCorrect(
      container, header, `Conjugaison de "${item.en_base}" — passé simple / participe passé ?`,
      (answer) => checkConjugation(item, answer),
      { expected: `${item.en_past_simple} / ${item.en_past_participle}` }
    );
  }

  await finalizeVocabItem(item, baseCorrect, conjugationCorrect);
}

async function runGrammaireQuestion(container, item, header) {
  const isCorrect = await askUntilCorrect(
    container, header, item.prompt,
    (answer) => checkAnswer(item, answer),
    { expected: item.en, rule: item.explication }
  );
  await finalizeItem(item, isCorrect);
}

async function runExpressionQuestion(container, item, header) {
  const isCorrect = await askUntilCorrect(
    container, header, item.prompt,
    (answer) => checkAnswer(item, answer),
    { expected: item.en, example: item.example }
  );
  await finalizeItem(item, isCorrect);
}

async function runQuestion(container, item, header) {
  if (item.item_type === 'vocabulaire') await runVocabQuestion(container, item, header);
  else if (item.item_type === 'grammaire') await runGrammaireQuestion(container, item, header);
  else if (item.item_type === 'expressions') await runExpressionQuestion(container, item, header);
}

// "Mots compliqués" — Phase 1: En -> Fr/Meaning, no hint. Phase 2: Fr/Meaning -> En, hangman
// hint. Phase 3: Fr/Meaning -> En, no hint (same question as the normal circuit).
function maskWord(word) {
  if (word.length <= 2) return word;
  return word[0] + '_'.repeat(word.length - 2) + word[word.length - 1];
}

// Vocabulaire masks each word of the base translation individually; Grammaire/Expressions
// mask the whole answer as a single block (spaces included in the mask).
function maskHint(itemType, text) {
  if (itemType === 'vocabulaire') {
    return text.split(' ').map(maskWord).join(' ');
  }
  return maskWord(text);
}

function hardModeQuestion(item, phase) {
  const forwardExpected = item.item_type === 'vocabulaire' ? item.en_base : item.en;
  const forwardCheck = item.item_type === 'vocabulaire'
    ? (answer) => checkBase(item, answer)
    : (answer) => checkAnswer(item, answer);

  if (phase === 1) {
    return { prompt: forwardExpected, expected: item.prompt, hint: null, checkFn: (answer) => checkReverse(item, answer) };
  }
  if (phase === 2) {
    return { prompt: item.prompt, expected: forwardExpected, hint: maskHint(item.item_type, forwardExpected), checkFn: forwardCheck };
  }
  return { prompt: item.prompt, expected: forwardExpected, hint: null, checkFn: forwardCheck };
}

async function runHardModeItem(container, item) {
  let phase = item.hard_phase;
  while (true) {
    const { prompt, expected, hint, checkFn } = hardModeQuestion(item, phase);
    const header = `Mots compliqués — ${item.prompt}`;
    const answer = await askInput(container, { header, prompt, hint });
    const isCorrect = checkFn(answer);

    if (isCorrect && phase === 3) {
      await gradeHardAttempt(item, phase, true);
      await showPreview(container, { header, prompt, answer: expected, tag: 'Sorti du mode compliqué !' });
      return;
    }

    const result = await gradeHardAttempt(item, phase, isCorrect);

    if (isCorrect) {
      phase = advancedPhase(phase, item.item_type);
      continue;
    }

    await showPreview(container, { header, prompt, answer: expected });
    if (result.cappedToday) {
      await showPreview(container, {
        header, prompt: "Trop d'erreurs sur cet item aujourd'hui", answer: 'On retente demain.',
      });
      return;
    }
    phase = demotedPhase(phase, item.item_type);
  }
}

export async function renderQuiz(container, session, { onComplete }) {
  const { hardItems, newItems, reviewItems } = session;

  for (let i = 0; i < hardItems.length; i++) {
    await runHardModeItem(container, hardItems[i]);
  }

  for (let i = 0; i < newItems.length; i++) {
    await previewItem(container, newItems[i], `Découverte — ${i + 1} / ${newItems.length}`);
  }

  for (let i = 0; i < newItems.length; i++) {
    await runQuestion(container, newItems[i], `Nouveaux mots — ${i + 1} / ${newItems.length}`);
  }

  for (let i = 0; i < reviewItems.length; i++) {
    await runQuestion(container, reviewItems[i], `Révision — ${i + 1} / ${reviewItems.length}`);
  }

  onComplete();
}

function levelLabel(row) {
  if (row.learning_process === 'hard') return `Compliqué (Phase ${row.hard_phase})`;
  if (row.is_learned) return 'Appris';
  if (row.requeue_date) return `Reprogrammé (${row.requeue_date})`;
  if (row.total_reviews === 0) return 'Nouveau';
  return String(row.box_level);
}

export function renderProgress(container) {
  const rows = getAllProgress();

  rows.sort((a, b) => {
    if (a.total_reviews === 0 && b.total_reviews !== 0) return -1;
    if (b.total_reviews === 0 && a.total_reviews !== 0) return 1;
    if (a.is_learned !== b.is_learned) return a.is_learned - b.is_learned;
    const da = a.next_review_date ?? '9999-99-99';
    const db_ = b.next_review_date ?? '9999-99-99';
    return da.localeCompare(db_);
  });

  const tableRows = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.item_type)}</td>
      <td>${escapeHtml(row.prompt)}</td>
      <td>${escapeHtml(levelLabel(row))}</td>
      <td>${escapeHtml(row.next_review_date ?? '—')}</td>
      <td>${escapeHtml(row.correct_streak)}</td>
      <td>${escapeHtml(row.total_reviews)}</td>
      <td>${escapeHtml(row.last_result ?? '—')}</td>
    </tr>
  `).join('');

  container.innerHTML = `
    <h1>Progression</h1>
    <p>${rows.length} item(s) au total.</p>
    <div class="progress-table-wrap">
      <table>
        <thead>
          <tr>
            <th>Type</th><th>Prompt</th><th>Niveau</th><th>Prochaine révision</th>
            <th>Série</th><th>Total</th><th>Dernier résultat</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  `;
}

export function renderSettings(container) {
  const n = getSetting('new_items_per_day') ?? '10';
  const lastExport = getSetting('last_manual_export');
  const since = daysSince(lastExport);
  const lastExportText = since === null ? 'jamais' : since === 0 ? "aujourd'hui" : `il y a ${since} jour(s)`;

  container.innerHTML = `
    <h1>Réglages</h1>

    <h2>Nouveaux items par jour</h2>
    <p>Nombre maximum de nouveaux mots/règles/expressions introduits chaque jour, tous types confondus.</p>
    <input type="number" id="n-input" min="1" step="1" value="${escapeHtml(n)}" />
    <button id="n-save-btn">Enregistrer</button>
    <p id="n-status"></p>

    <h2>Sauvegarde</h2>
    <p>Ta progression est stockée uniquement sur cet appareil. Exporte une sauvegarde de temps
    en temps (par ex. vers Fichiers/iCloud) pour ne rien perdre en cas de problème.</p>
    <p>Dernier export : <strong>${lastExportText}</strong></p>
    <button id="export-btn">Exporter une sauvegarde</button>

    <h3>Restaurer une sauvegarde</h3>
    <p style="color:#dc2626">Attention : remplace entièrement le contenu et la progression actuels par ceux du fichier choisi.</p>
    <input type="file" id="restore-file" accept=".sqlite" />
    <p id="restore-status"></p>
  `;

  container.querySelector('#n-save-btn').addEventListener('click', async () => {
    const value = parseInt(container.querySelector('#n-input').value, 10);
    const status = container.querySelector('#n-status');
    if (!Number.isFinite(value) || value < 1) {
      status.textContent = 'Merci de saisir un nombre valide (≥ 1).';
      return;
    }
    await setSetting('new_items_per_day', value);
    status.textContent = 'Enregistré.';
  });

  container.querySelector('#export-btn').addEventListener('click', async () => {
    await exportToFile();
    renderSettings(container);
  });

  container.querySelector('#restore-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const status = container.querySelector('#restore-status');
    if (!confirm('Ceci va remplacer tout le contenu et toute la progression actuels par la sauvegarde sélectionnée. Continuer ?')) {
      e.target.value = '';
      return;
    }
    status.textContent = 'Restauration en cours…';
    try {
      await importFromFile(file);
      status.textContent = 'Sauvegarde restaurée avec succès.';
    } catch (err) {
      status.textContent = `Erreur : ${err.message}`;
    } finally {
      e.target.value = '';
    }
  });
}
