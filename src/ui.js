import { parseWorkbookFile, importFromWorkbook } from './importer.js';
import { startSession, checkBase, checkConjugation, finalizeVocabItem, checkAnswer, finalizeItem } from './quiz.js';

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
  container.innerHTML = `
    <h1>Vocab Quiz</h1>
    <p>${session.length} item(s) à réviser aujourd'hui.</p>
    <button id="start-session-btn" ${session.length === 0 ? 'disabled' : ''}>Commencer la session</button>
  `;
  if (session.length > 0) {
    container.querySelector('#start-session-btn').addEventListener('click', () => onStartSession(session));
  }
}

function askInput(container, { header, prompt }) {
  return new Promise((resolve) => {
    container.innerHTML = `
      <p class="progress-header">${escapeHtml(header)}</p>
      <p class="prompt">${escapeHtml(prompt)}</p>
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
      <button id="next-btn">Suivant</button>
    `;
    container.querySelector('#next-btn').addEventListener('click', () => resolve());
  });
}

async function runVocabQuestion(container, item, header) {
  const baseAnswer = await askInput(container, { header, prompt: item.prompt });
  const baseCorrect = checkBase(item, baseAnswer);
  await showCorrection(container, {
    header,
    isCorrect: baseCorrect,
    expected: item.en_base,
    tag: item.type,
    example: item.example,
  });

  let conjugationCorrect = true;
  if (item.en_past_simple) {
    const conjAnswer = await askInput(container, {
      header,
      prompt: `Conjugaison de "${item.en_base}" — passé simple / participe passé ?`,
    });
    conjugationCorrect = checkConjugation(item, conjAnswer);
    await showCorrection(container, {
      header,
      isCorrect: conjugationCorrect,
      expected: `${item.en_past_simple} / ${item.en_past_participle}`,
    });
  }

  await finalizeVocabItem(item, baseCorrect, conjugationCorrect);
}

async function runGrammaireQuestion(container, item, header) {
  const answer = await askInput(container, { header, prompt: item.prompt });
  const isCorrect = checkAnswer(item, answer);
  await showCorrection(container, {
    header,
    isCorrect,
    expected: item.en,
    rule: item.explication,
  });
  await finalizeItem(item, isCorrect);
}

async function runExpressionQuestion(container, item, header) {
  const answer = await askInput(container, { header, prompt: item.prompt });
  const isCorrect = checkAnswer(item, answer);
  await showCorrection(container, {
    header,
    isCorrect,
    expected: item.en,
    example: item.example,
  });
  await finalizeItem(item, isCorrect);
}

export async function renderQuiz(container, session, { onComplete }) {
  for (let i = 0; i < session.length; i++) {
    const item = session[i];
    const header = `Question ${i + 1} / ${session.length}`;

    if (item.item_type === 'vocabulaire') {
      await runVocabQuestion(container, item, header);
    } else if (item.item_type === 'grammaire') {
      await runGrammaireQuestion(container, item, header);
    } else if (item.item_type === 'expressions') {
      await runExpressionQuestion(container, item, header);
    }
  }
  onComplete();
}
