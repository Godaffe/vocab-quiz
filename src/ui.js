import { parseWorkbookFile, importFromWorkbook } from './importer.js';
import {
  startSession, checkBase, checkConjugation, finalizeVocabItem, checkAnswer, finalizeItem,
  checkReverse, gradeHardAttempt,
} from './quiz.js';
import { getSetting, setSetting } from './db.js';
import { exportToFile, importFromFile, daysSince } from './backup.js';
import {
  getAllProgress, advancedPhase, demotedPhase, getFailedWordsPool,
  getStreak, getLearnedCount, getInProgressCount, countNewIntroducedToday,
} from './leitner.js';
import { renderFlashcard, onSwipe } from './card.js';

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
    ? ` — <span style="color:#F0997B">ID en double ignorés : ${s.duplicateId.join(', ')}</span>`
    : '';
  return `<p><strong>${label}</strong> : ${s.new} nouveau(x), ${s.updated} mis à jour, ${s.unchanged} inchangé(s), ${s.skipped} ligne(s) ignorée(s) (ID/colonnes manquants)${dup}</p>`;
}

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

function formatDayFr(date) {
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

export async function renderHome(container, { onStartHard, onStartLearning, onStartReview, onStartFailedWords }) {
  container.innerHTML = '<p>Chargement…</p>';
  const session = await startSession();
  const failedWords = getFailedWordsPool();
  const streak = getStreak();
  const learnedCount = getLearnedCount();
  const inProgressCount = getInProgressCount();
  const dailyBudget = parseInt(getSetting('new_items_per_day') ?? '10', 10);
  const introducedToday = countNewIntroducedToday(todayISO());
  const newRemaining = session.newItems.length;
  const newPct = dailyBudget > 0 ? Math.min(100, Math.round((introducedToday / dailyBudget) * 100)) : 0;
  const reviewRemaining = session.reviewItems.length;

  container.innerHTML = `
    <div class="home-header">
      <span class="today">${escapeHtml(formatDayFr(new Date()))}</span>
      <span class="streak-badge">🔥 ${streak}</span>
    </div>
    <div class="stat-row">
      <div class="stat-chip">
        <div class="stat-value">${learnedCount}</div>
        <div class="stat-label">mots appris</div>
      </div>
      <div class="stat-chip">
        <div class="stat-value">${inProgressCount}</div>
        <div class="stat-label">en cours d'apprentissage</div>
      </div>
    </div>
    <button class="session-card" id="start-learning-btn" ${newRemaining === 0 ? 'disabled' : ''}>
      <div class="session-card-title">Mots nouveaux</div>
      <div class="session-card-count">${newRemaining} / ${dailyBudget}</div>
      <div class="progress-bar"><div class="progress-bar-fill" style="width:${newPct}%"></div></div>
    </button>
    <button class="session-card" id="start-review-btn" ${reviewRemaining === 0 ? 'disabled' : ''}>
      <div class="session-card-title">Révision</div>
      <div class="session-card-count">${reviewRemaining} mot(s) à réviser</div>
      <div class="progress-bar"><div class="progress-bar-fill" style="width:0%"></div></div>
    </button>
    <div class="compact-row">
      <button class="compact-card" id="start-hard-btn" ${session.hardItems.length === 0 ? 'disabled' : ''}>
        <div class="compact-card-value">${session.hardItems.length}</div>
        <div class="compact-card-label">Mots compliqués</div>
      </button>
      <button class="compact-card" id="start-failed-btn" ${failedWords.length === 0 ? 'disabled' : ''}>
        <div class="compact-card-value">${failedWords.length}</div>
        <div class="compact-card-label">Réviser mes mots ratés</div>
      </button>
    </div>
  `;
  if (session.hardItems.length > 0) {
    container.querySelector('#start-hard-btn').addEventListener('click', () => onStartHard(session));
  }
  if (newRemaining > 0) {
    container.querySelector('#start-learning-btn').addEventListener('click', () => onStartLearning(session));
  }
  if (reviewRemaining > 0) {
    container.querySelector('#start-review-btn').addEventListener('click', () => onStartReview(session));
  }
  if (failedWords.length > 0) {
    container.querySelector('#start-failed-btn').addEventListener('click', () => onStartFailedWords(failedWords));
  }
}

// --- Flashcard screens -----------------------------------------------------

function questionCard(area, { prompt, hint, badge, variant = 'question', index, total }) {
  return new Promise((resolve) => {
    const body = renderFlashcard(area, { variant, badge, dotsTotal: total, dotsFilled: index });
    body.innerHTML = `
      <p class="prompt">${escapeHtml(prompt)}</p>
      ${hint ? `<p><em>${escapeHtml(hint)}</em></p>` : ''}
      <input type="text" id="answer-input" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" />
      <button id="submit-btn">Valider</button>
    `;
    const input = body.querySelector('#answer-input');
    const submit = () => resolve(input.value);
    body.querySelector('#submit-btn').addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    input.focus();
  });
}

function retryCard(area, opts) {
  return questionCard(area, { ...opts, variant: 'retry', badge: opts.badge ?? 'À retenter' });
}

function resultCard(area, { isCorrect, prompt, expected, tag, example, rule, badge, index, total }) {
  return new Promise((resolve) => {
    const body = renderFlashcard(area, {
      variant: isCorrect ? 'correct' : 'incorrect',
      badge: badge ?? (tag ? escapeHtml(tag) : null),
      dotsTotal: total,
      dotsFilled: index,
    });
    body.innerHTML = `
      <div class="flashcard-result-icon">${isCorrect ? '✓' : '✗'}</div>
      <div class="flashcard-word">${escapeHtml(expected)}</div>
      ${prompt ? `<div class="answer-block answer-block--fr">${escapeHtml(prompt)}</div>` : ''}
      ${(example || rule) ? `<div class="answer-block answer-block--example">${escapeHtml(example || rule)}</div>` : ''}
      <button id="next-btn">${isCorrect ? 'Suivant' : 'Réessayer'}</button>
    `;
    body.querySelector('#next-btn').addEventListener('click', () => resolve());
  });
}

function discoverCard(area, { prompt, answer, tag, example, index, total }) {
  return new Promise((resolve) => {
    let flipped = false;
    function render() {
      const body = renderFlashcard(area, { variant: 'discover', badge: 'Nouveau', dotsTotal: total, dotsFilled: index });
      body.innerHTML = flipped ? `
        <div class="flashcard-word">${escapeHtml(answer)}</div>
        ${tag ? `<p><em>${escapeHtml(tag)}</em></p>` : ''}
        ${example ? `<div class="answer-block answer-block--example">${escapeHtml(example)}</div>` : ''}
        <button id="next-btn">Suivant</button>
      ` : `
        <div class="flashcard-word">${escapeHtml(prompt)}</div>
        <p>Glisse pour voir la traduction</p>
      `;
      const card = area.querySelector('.flashcard');
      onSwipe(card, {
        onLeft: () => { flipped = !flipped; render(); },
        onRight: () => { flipped = !flipped; render(); },
        onUp: () => resolve(),
      });
      const nextBtn = body.querySelector('#next-btn');
      if (nextBtn) nextBtn.addEventListener('click', () => resolve());
    }
    render();
  });
}

async function previewItem(container, item, { index, total }) {
  if (item.item_type === 'vocabulaire') {
    const answer = item.en_past_simple
      ? `${item.en_base} (${item.en_past_simple} / ${item.en_past_participle})`
      : item.en_base;
    await discoverCard(container, { prompt: item.prompt, answer, tag: item.type, example: item.example, index, total });
  } else if (item.item_type === 'grammaire') {
    await discoverCard(container, { prompt: item.prompt, answer: item.en, example: item.explication, index, total });
  } else if (item.item_type === 'expressions') {
    await discoverCard(container, { prompt: item.prompt, answer: item.en, example: item.example, index, total });
  }
}

// Redemande la même question jusqu'à une bonne réponse. Seule la première tentative
// (retournée ici) compte pour la note Leitner — les redemandes suivantes ne sont qu'un
// entraînement affiché à l'écran, sous la forme d'une carte "à retenter".
async function askUntilCorrect(container, { prompt, badge, index, total, forceRetry, checkFn, correctionFields }) {
  let first = null;
  let attempt = 0;
  while (true) {
    const useRetry = forceRetry || attempt > 0;
    const answer = useRetry
      ? await retryCard(container, { prompt, index, total })
      : await questionCard(container, { prompt, badge, index, total });
    const isCorrect = checkFn(answer);
    if (first === null) first = isCorrect;
    await resultCard(container, { isCorrect, prompt, index, total, ...correctionFields });
    if (isCorrect) break;
    attempt += 1;
  }
  return first;
}

async function runVocabQuestion(container, item, { index, total, badge, options, forceRetry }) {
  const baseCorrect = await askUntilCorrect(container, {
    prompt: item.prompt, badge, index, total, forceRetry,
    checkFn: (answer) => checkBase(item, answer),
    correctionFields: { expected: item.en_base, tag: item.type, example: item.example },
  });

  let conjugationCorrect = true;
  if (item.en_past_simple) {
    conjugationCorrect = await askUntilCorrect(container, {
      prompt: `Conjugaison de "${item.en_base}" — passé simple / participe passé ?`, badge, index, total, forceRetry,
      checkFn: (answer) => checkConjugation(item, answer),
      correctionFields: { expected: `${item.en_past_simple} / ${item.en_past_participle}` },
    });
  }

  await finalizeVocabItem(item, baseCorrect, conjugationCorrect, options);
}

async function runGrammaireQuestion(container, item, { index, total, badge, options, forceRetry }) {
  const isCorrect = await askUntilCorrect(container, {
    prompt: item.prompt, badge, index, total, forceRetry,
    checkFn: (answer) => checkAnswer(item, answer),
    correctionFields: { expected: item.en, rule: item.explication },
  });
  await finalizeItem(item, isCorrect, options);
}

async function runExpressionQuestion(container, item, { index, total, badge, options, forceRetry }) {
  const isCorrect = await askUntilCorrect(container, {
    prompt: item.prompt, badge, index, total, forceRetry,
    checkFn: (answer) => checkAnswer(item, answer),
    correctionFields: { expected: item.en, example: item.example },
  });
  await finalizeItem(item, isCorrect, options);
}

async function runQuestion(container, item, ctx) {
  if (item.item_type === 'vocabulaire') await runVocabQuestion(container, item, ctx);
  else if (item.item_type === 'grammaire') await runGrammaireQuestion(container, item, ctx);
  else if (item.item_type === 'expressions') await runExpressionQuestion(container, item, ctx);
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
    const badge = `Mots compliqués — Phase ${phase}`;
    const answer = await questionCard(container, { prompt, hint, badge, index: phase, total: 3 });
    const isCorrect = checkFn(answer);

    if (isCorrect && phase === 3) {
      await gradeHardAttempt(item, phase, true);
      await resultCard(container, { isCorrect: true, prompt, expected, index: 3, total: 3, badge: 'Sorti du mode compliqué !' });
      return;
    }

    const result = await gradeHardAttempt(item, phase, isCorrect);

    if (isCorrect) {
      phase = advancedPhase(phase, item.item_type);
      continue;
    }

    await resultCard(container, { isCorrect: false, prompt, expected, index: phase, total: 3 });
    if (result.cappedToday) {
      await resultCard(container, {
        isCorrect: false, prompt: "Trop d'erreurs sur cet item aujourd'hui", expected: 'On retente demain.', index: phase, total: 3,
      });
      return;
    }
    phase = demotedPhase(phase, item.item_type);
  }
}

function renderModeShell(container, onExit) {
  container.innerHTML = `
    <button id="exit-btn" class="exit-btn">Quitter</button>
    <div id="question-area"></div>
  `;
  container.querySelector('#exit-btn').addEventListener('click', onExit);
  return container.querySelector('#question-area');
}

export async function renderHardMode(container, { hardItems }, { onComplete, onExit }) {
  const area = renderModeShell(container, onExit);
  for (const item of hardItems) {
    await runHardModeItem(area, item);
  }
  onComplete();
}

export async function renderLearningMode(container, { newItems }, { onComplete, onExit }) {
  const area = renderModeShell(container, onExit);
  for (let i = 0; i < newItems.length; i++) {
    await previewItem(area, newItems[i], { index: i, total: newItems.length });
  }
  for (let i = 0; i < newItems.length; i++) {
    await runQuestion(area, newItems[i], { index: i, total: newItems.length });
  }
  onComplete();
}

export async function renderReviewMode(container, { reviewItems }, { onComplete, onExit }) {
  const area = renderModeShell(container, onExit);
  for (let i = 0; i < reviewItems.length; i++) {
    await runQuestion(area, reviewItems[i], { index: i, total: reviewItems.length });
  }
  onComplete();
}

export async function renderFailedWordsMode(container, { failedWords }, { onComplete, onExit }) {
  const area = renderModeShell(container, onExit);
  for (let i = 0; i < failedWords.length; i++) {
    await runQuestion(area, failedWords[i], {
      index: i, total: failedWords.length, forceRetry: true, options: { preserveSchedule: true },
    });
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

    <h2>Importer le vocabulaire</h2>
    <p>Sélectionne ton fichier Excel (.xlsx). Réimporter est sans risque : le contenu est mis à
    jour mais ta progression de révision n'est jamais effacée.</p>
    <input type="file" id="import-file" accept=".xlsx" />
    <div id="import-summary"></div>

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
    <p style="color:#F0997B">Attention : remplace entièrement le contenu et la progression actuels par ceux du fichier choisi.</p>
    <input type="file" id="restore-file" accept=".sqlite" />
    <p id="restore-status"></p>
  `;

  const importFile = container.querySelector('#import-file');
  const importSummary = container.querySelector('#import-summary');
  importFile.addEventListener('change', async () => {
    const file = importFile.files[0];
    if (!file) return;

    importSummary.innerHTML = '<p>Import en cours…</p>';
    try {
      const buffer = await file.arrayBuffer();
      const workbook = parseWorkbookFile(buffer);
      const summary = await importFromWorkbook(workbook, todayISO());

      importSummary.innerHTML = [
        summaryRowHtml('Vocabulaire', summary.vocabulaire),
        summaryRowHtml('Grammaire', summary.grammaire),
        summaryRowHtml('Expressions', summary.expressions),
      ].join('');
    } catch (err) {
      importSummary.innerHTML = `<p style="color:#F0997B">Erreur lors de l'import : ${err.message}</p>`;
    } finally {
      importFile.value = '';
    }
  });

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
