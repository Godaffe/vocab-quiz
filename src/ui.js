import { parseWorkbookFile, importFromWorkbook } from './importer.js';
import {
  startSession, checkBase, checkConjugation, finalizeVocabItem, checkAnswer, finalizeItem,
  checkReverse, gradeHardAttempt,
} from './quiz.js';
import { getSetting, setSetting, resetDatabase } from './db.js';
import { exportToFile, importFromFile, daysSince } from './backup.js';
import {
  getAllProgress, advancedPhase, demotedPhase, getFailedWordsPool,
  getStreak, getLearnedCount, getInProgressCount, countNewIntroducedToday,
  countReviewedToday, getProgressRow, getLearnedToday, getStartedToday,
} from './leitner.js';
import {
  escapeHtml, sessionHeaderHtml, cardStackHtml, flipCardHtml, questionCardHtml,
  answerFieldHtml, hintMaskHtml, resultCardHtml, consequenceHtml, statPillHtml, onSwipe, onCardTap,
} from './card.js';
import { icon } from './icons.js';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

function formatWeekdayFr(date) {
  return WEEKDAYS[date.getDay()];
}

function formatDateFrLong(date) {
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

function wait(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

// Signal de passage, pas une vraie erreur : glisser vers la droite sur une carte question
// abandonne l'item en cours, à n'importe quelle tentative. Il traverse askUntilCorrect /
// runVocabQuestion / runHardModeRound sans que chacun ait à faire suivre un drapeau — la
// boucle de mode (une seule par écran) l'intercepte et enchaîne sur l'item suivant. Le mot
// n'est noté nulle part : il reste exactement où sa dernière notation l'avait laissé.
class ItemSkipped extends Error {}

// --- Accueil ---------------------------------------------------------------

// Recto de la tuile Découverte : l'anneau du jour, actif tant qu'il reste des mots.
function newTileActiveHtml({ introducedToday, dailyBudget, newRemaining }) {
  return `
    <span class="tile-label">${icon('sparkles', { size: 16, color: 'currentColor', stroke: 2.4 })}<span>Découverte</span></span>
    <span class="tile-ring-wrap">
      <span class="tile-ring" id="new-ring">
        <span class="tile-ring-in">
          <span>
            <span class="tile-ring-n">${introducedToday}</span>
            <span class="tile-ring-d">sur ${dailyBudget}</span>
          </span>
        </span>
      </span>
    </span>
    <span class="tile-title">Mots<br>nouveaux</span>
    <span class="tile-meta">${newRemaining} mot${newRemaining > 1 ? 's' : ''} restant${newRemaining > 1 ? 's' : ''} aujourd'hui</span>
  `;
}

// Découverte bouclée : le disque remplace l'anneau, le compte est ce qui a réellement été
// découvert aujourd'hui — pas l'objectif du réglage, qui peut ne pas être atteignable si le
// classeur importé n'a plus assez de mots neufs à proposer.
function newTileDoneHtml({ introducedToday }) {
  return `
    <span class="tile-label">Découverte</span>
    <span class="tile-disc-wrap">
      <span class="tile-disc">
        <span class="tile-disc__n">${introducedToday}</span>
        <span class="tile-disc__d">découverts</span>
      </span>
    </span>
    <span class="tile-title">Mots<br>nouveaux</span>
    <span class="tile-meta">Session bouclée</span>
  `;
}

function reviewTileActiveHtml({ reviewRemaining, reviewedToday, reviewTotal }) {
  return `
    <span class="tile-label">${icon('repeat', { size: 15, color: 'currentColor', stroke: 2.4 })}<span>À réviser</span></span>
    <span class="tile-count"><b>${reviewRemaining}</b><span>mot${reviewRemaining > 1 ? 's' : ''}</span></span>
    <span class="ds-progress"><span class="ds-progress__fill" id="review-fill" style="width:0%"></span></span>
    <span class="tile-meta">${reviewedToday} sur ${reviewTotal} révisé${reviewedToday > 1 ? 's' : ''} aujourd'hui</span>
  `;
}

function reviewTileDoneHtml({ reviewedToday }) {
  return `
    <span class="tile-label">Révision</span>
    <span class="tile-disc-wrap">
      <span class="tile-disc">
        <span class="tile-disc__n">${reviewedToday}</span>
        <span class="tile-disc__d">révisés</span>
      </span>
    </span>
    <span class="tile-meta">Session bouclée</span>
  `;
}

// Compliqués/ratés, actif : aplat pâle, icône de la catégorie en filigrane dans le coin —
// la couleur vive ne sert plus qu'au chiffre. Bouclé : disque plein + coche + statut, à la
// place du grisé désactivé générique, dès que le compte est à zéro n'importe quel jour.
function flatTileHtml({ count, title, glyphName, glyphColor, doneTitle, doneStatus }) {
  if (count === 0) {
    return `
      <span class="tile-check-disc">${icon('check', { size: 15, color: '#fff', stroke: 3.2 })}</span>
      <span>
        <span class="tile-status-title">${doneTitle}</span>
        <span class="tile-status">${doneStatus}</span>
      </span>
    `;
  }
  return `
    <span class="tile-glyph-bg">${icon(glyphName, { size: 52, color: glyphColor, stroke: 2 })}</span>
    <span class="tile-title">${title}</span>
    <span class="tile-count">${count}</span>
  `;
}

export async function renderHome(container, { onStartHard, onStartLearning, onStartReview, onStartFailedWords }) {
  container.innerHTML = '<div class="loading-block"><span class="ds-spinner"></span><div class="loading-msg">Chargement de la session</div></div>';
  const today = todayISO();
  const session = await startSession();
  const failedWords = getFailedWordsPool();
  const streak = getStreak();
  const learnedCount = getLearnedCount();
  const inProgressCount = getInProgressCount();
  const learnedToday = getLearnedToday(today);
  const startedToday = getStartedToday(today);
  const dailyBudget = parseInt(getSetting('new_items_per_day') ?? '10', 10);
  const introducedToday = countNewIntroducedToday(today);
  const newRemaining = session.newItems.length;
  const newPct = dailyBudget > 0 ? Math.min(100, Math.round((introducedToday / dailyBudget) * 100)) : 0;

  const reviewRemaining = session.reviewItems.length;
  // Le dénominateur est ce qui a réellement été noté aujourd'hui plus ce qu'il reste :
  // jamais un total inventé.
  const reviewedToday = countReviewedToday(today);
  const reviewTotal = reviewedToday + reviewRemaining;
  const reviewPct = reviewTotal > 0 ? Math.round((reviewedToday / reviewTotal) * 100) : 0;

  // La journée n'est « complète » que si les deux files sont vides — jamais entre les deux,
  // et jamais gardé en mémoire d'une visite à l'autre : recalculé à chaque rendu de l'accueil.
  const dayComplete = newRemaining === 0 && reviewRemaining === 0;
  const now = new Date();

  const headerInner = dayComplete ? `
    <div class="home-header__row">
      <div class="home-header__dates">
        <span class="home-header__eyebrow">${icon('check', { size: 13, color: '#FAF7EF', stroke: 3.2 })}<span>Journée complète</span></span>
        <span class="home-header__date">${escapeHtml(formatDateFrLong(now))}</span>
      </div>
      <span class="ds-streak">${icon('flame', { size: 17, color: '#2B1F00', stroke: 2.4 })}<span class="ds-streak__n">${streak}</span><span class="ds-streak__u">j</span></span>
    </div>
    <div class="home-header__next">${icon('clock', { size: 15, color: '#FDFBF5', stroke: 2.3 })}<span>Prochaine session demain</span></div>
  ` : `
    <div class="home-header__row">
      <div class="home-header__dates">
        <span class="home-header__eyebrow">${escapeHtml(formatWeekdayFr(now))}</span>
        <span class="home-header__date">${escapeHtml(formatDateFrLong(now))}</span>
      </div>
      <span class="ds-streak">${icon('flame', { size: 17, color: '#2B1F00', stroke: 2.4 })}<span class="ds-streak__n">${streak}</span><span class="ds-streak__u">j</span></span>
    </div>
  `;

  container.innerHTML = `
    <div class="home-header${dayComplete ? ' home-header--complete' : ''}">${headerInner}</div>

    <div class="screen-scroll">
      <div class="stat-row">
        ${statPillHtml({
          variant: 'home', side: 'left', value: learnedCount, delta: `+${learnedToday}`,
          deltaColor: 'var(--green-100)', label: 'Mots appris',
          glyph: icon('trophy', { size: 17, color: 'var(--green-100)', stroke: 2.2 }),
        })}
        ${statPillHtml({
          variant: 'home', side: 'right', value: inProgressCount, delta: `+${startedToday}`,
          deltaColor: 'var(--copper-100)', label: 'Mots en cours',
          glyph: icon('sprout', { size: 17, color: 'var(--copper-100)', stroke: 2.2 }),
        })}
      </div>

      <div class="home-grid">
        <button class="tile tile--new${newRemaining === 0 ? ' tile--done' : ''}" id="start-learning-btn" type="button" ${newRemaining === 0 ? 'disabled' : ''}>
          ${newRemaining === 0 ? newTileDoneHtml({ introducedToday }) : newTileActiveHtml({ introducedToday, dailyBudget, newRemaining })}
        </button>

        <button class="tile tile--review${reviewRemaining === 0 ? ' tile--done' : ''}" id="start-review-btn" type="button" ${reviewRemaining === 0 ? 'disabled' : ''}>
          ${reviewRemaining === 0 ? reviewTileDoneHtml({ reviewedToday }) : reviewTileActiveHtml({ reviewRemaining, reviewedToday, reviewTotal })}
        </button>

        <button class="tile tile--flat tile--tricky" id="start-hard-btn" type="button" ${session.hardItems.length === 0 ? 'disabled' : ''}>
          ${flatTileHtml({
            count: session.hardItems.length, title: 'Mots<br>compliqués', glyphName: 'brain', glyphColor: 'var(--violet-100)',
            doneTitle: 'Compliqués', doneStatus: 'À jour',
          })}
        </button>

        <button class="tile tile--flat tile--failed" id="start-failed-btn" type="button" ${failedWords.length === 0 ? 'disabled' : ''}>
          ${flatTileHtml({
            count: failedWords.length, title: 'Mots<br>ratés', glyphName: 'circle-x', glyphColor: 'var(--crimson-100)',
            doneTitle: 'Ratés', doneStatus: 'Aucun',
          })}
        </button>
      </div>
    </div>
  `;

  // L'anneau et la barre partent de zéro puis se remplissent : le mouvement dit la part
  // déjà faite, il ne décore pas. requestAnimationFrame ne se déclenche pas sur une page
  // masquée — le minuteur reprend la main pour que la valeur finisse toujours par être la
  // bonne, animée ou non. Absents une fois la tuile bouclée (plus d'anneau ni de barre).
  let painted = false;
  const paintProgress = () => {
    if (painted) return;
    painted = true;
    container.querySelector('#new-ring')?.style.setProperty('--pct', String(newPct));
    const fill = container.querySelector('#review-fill');
    if (fill) fill.style.width = `${reviewPct}%`;
  };
  requestAnimationFrame(paintProgress);
  setTimeout(paintProgress, 250);

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

// --- Coque de session ------------------------------------------------------

// Barre du haut (quitter + compteur + emplacement droit) puis la barre de progression,
// puis la zone de carte, qui occupe toute la hauteur restante — c'est ce qui pousse le
// bouton d'action en bas de l'écran. La nav du bas est masquée le temps de la session
// (classe sur <body>), retirée par les routes de main.js, par où passent toutes les sorties.
function renderModeShell(container, onExit) {
  container.innerHTML = `
    <div class="mode-shell">
      ${sessionHeaderHtml({ index: 0, total: 0 })}
      <div id="question-area"></div>
    </div>
  `;
  container.querySelector('#exit-btn').addEventListener('click', onExit);

  const fill = container.querySelector('#mode-progress');
  const counter = container.querySelector('#mode-counter');
  const right = container.querySelector('#mode-right');

  // phase 'discover' = passage de lecture des nouveaux mots (remplissage rayé), 'quiz' =
  // passage question/réponse (remplissage plein). Jamais les deux traitements à la fois.
  const setProgress = (index, total, { phase = 'quiz', badge = '' } = {}) => {
    counter.textContent = total > 0 ? `${index + 1} / ${total}` : '';
    fill.style.width = total > 0 ? `${Math.round((index / total) * 100)}%` : '0%';
    fill.classList.toggle('ds-progress__fill--phase2', phase === 'discover');
    right.innerHTML = badge;
  };

  return { area: container.querySelector('#question-area'), setProgress };
}

// --- Bilan de session ------------------------------------------------------

function newTally(kind) {
  return {
    kind,
    started: Date.now(),
    answered: 0,
    correct: 0,
    wrong: 0,
    learned: 0,
    levelUp: 0,
    requeued: 0,
    exitedHard: 0,
    phasesCleared: 0,
    nextDates: [],
  };
}

// Compare l'état Leitner de l'item avant et après notation : le bilan rapporte ce qui a
// réellement bougé en base, il ne rejoue pas les règles de son côté.
function recordOutcome(tally, before, after, firstCorrect) {
  tally.answered += 1;
  if (firstCorrect) tally.correct += 1;
  else tally.wrong += 1;
  if (after && before && after.is_learned && !before.is_learned) tally.learned += 1;
  if (after && before && after.box_level > before.box_level) tally.levelUp += 1;
  if (after && after.requeue_date && after.requeue_date !== before?.requeue_date) tally.requeued += 1;
  if (after && after.next_review_date) tally.nextDates.push(after.next_review_date);
}

// --- Écrans de carte -------------------------------------------------------

// Découverte : le mot au recto, la traduction au verso. Tap ou glissement horizontal pour
// retourner (480 ms, la seule animation longue du système), glissement vers le haut pour
// passer au suivant. Le bouton du bas reste le chemin fiable quand le geste n'est pas
// disponible (souris, clavier).
function discoverCard(area, { word, pos, example, translation, context, remaining }) {
  return new Promise((resolve) => {
    area.innerHTML = `
      <div class="session-body">
        ${cardStackHtml(remaining, flipCardHtml({ word, pos, example, translation, context, foot: 'Toucher ou glisser pour retourner' }), { stretch: true })}
      </div>
      <div class="session-foot">
        <button type="button" class="ds-btn ds-btn--hero ds-btn--secondary" id="next-btn">Mot suivant</button>
        <p class="session-note">Glisse vers le haut pour passer au mot suivant</p>
      </div>
    `;
    const card = area.querySelector('#flip-card');
    const flip = () => card.classList.toggle('ds-flip--back');
    onSwipe(card, { onLeft: flip, onRight: flip, onUp: () => resolve() });
    onCardTap(card, flip);
    area.querySelector('#next-btn').addEventListener('click', () => resolve());
  });
}

// Question : champ auto-focus, validation à la touche Entrée ou au bouton. Une mauvaise
// réponse fait passer le champ au cramoisi avec un écart de 4 px, une seule fois, avant
// que la carte résultat ne prenne le relais. Glisser la carte vers la droite (ou le bouton
// « Passer ») abandonne la question sans la noter — le mot n'avance ni ne recule.
function questionCard(area, { instruction, question, hint, badge, context, retry = false, retryLabel, remaining = 0, checkFn }) {
  return new Promise((resolve) => {
    const card = questionCardHtml({
      instruction,
      question,
      badge,
      retry,
      retryLabel,
      hint: hint || '',
      context: context || '',
      slot: answerFieldHtml(),
    });
    area.innerHTML = `
      <div class="session-body">
        ${remaining > 0 ? cardStackHtml(remaining, card) : card}
      </div>
      <div class="session-foot">
        <button type="button" class="ds-btn ds-btn--hero" id="submit-btn">Valider</button>
        <button type="button" class="ds-btn ds-btn--hero ds-btn--ghost" id="skip-btn">Passer</button>
      </div>
    `;

    const input = area.querySelector('#answer-input');
    const button = area.querySelector('#submit-btn');
    const skipBtn = area.querySelector('#skip-btn');
    const qcard = area.querySelector('.ds-qcard');
    let settled = false;

    const submit = async () => {
      if (settled) return;
      settled = true;
      const answer = input.value;
      const isCorrect = checkFn(answer);
      input.classList.add(isCorrect ? 'ds-field--correct' : 'ds-field--wrong');
      input.blur();
      button.disabled = true;
      skipBtn.disabled = true;
      await wait(isCorrect ? 240 : 420);
      resolve({ answer, isCorrect });
    };

    const skip = () => {
      if (settled) return;
      settled = true;
      resolve({ skipped: true });
    };

    button.addEventListener('click', submit);
    skipBtn.addEventListener('click', skip);
    if (qcard) onSwipe(qcard, { onRight: skip });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    input.addEventListener('input', () => {
      input.classList.remove('ds-field--correct', 'ds-field--wrong');
    });
    input.focus();
  });
}

// Résultat : bande + disque, la réponse attendue en plus gros que tout, la traduction et
// l'exemple en blocs distincts. Sur un échec, la conséquence Leitner est écrite en clair.
function resultCard(area, { isCorrect, answer, pos, translation, context, example, consequence, actionLabel }) {
  // Un texte simple reste une note de réussite (ex. sortie des mots compliqués) — la
  // pastille avant/après barrée est réservée aux échecs, elle n'aurait pas de sens ici.
  const consequenceBlock = !consequence ? ''
    : typeof consequence === 'string' ? `<div class="ds-alert ds-alert--success">${escapeHtml(consequence)}</div>`
    : consequenceHtml(consequence);
  return new Promise((resolve) => {
    area.innerHTML = `
      <div class="session-body">
        ${resultCardHtml({ correct: isCorrect, answer, pos, translation, context, example })}
        ${consequenceBlock}
      </div>
      <div class="session-foot">
        <button type="button" class="ds-btn ds-btn--hero${isCorrect ? '' : ' ds-btn--dark'}" id="next-btn">${escapeHtml(actionLabel)}</button>
      </div>
    `;
    // Un clic n'importe où sur la carte suffit à continuer : plus besoin de viser le bouton.
    onCardTap(area.querySelector('#result-card'), () => resolve());
    area.querySelector('#next-btn').addEventListener('click', () => resolve());
  });
}

// --- Passage de découverte -------------------------------------------------

function discoverFields(item) {
  if (item.item_type === 'vocabulaire') {
    const word = item.en_past_simple
      ? `${item.en_base} (${item.en_past_simple} / ${item.en_past_participle})`
      : item.en_base;
    return { word, pos: item.type, example: item.example, translation: item.prompt, context: item.context };
  }
  if (item.item_type === 'grammaire') {
    return { word: item.en, pos: null, example: item.explication, translation: item.prompt, context: item.context };
  }
  return { word: item.en, pos: null, example: item.example, translation: item.prompt, context: item.context };
}

// --- Questions -------------------------------------------------------------

// La conséquence d'un échec est lue dans la ligne de progression telle qu'elle est avant
// notation, donc elle décrit ce que la règle Leitner va réellement faire de l'item. Rendue
// en pastilles avant/après (pas une phrase) — omises quand rien ne change (entraînement
// libre, ou déjà au niveau plancher).
function failureConsequence(item, answer, { preserveSchedule = false } = {}) {
  const wrongAnswer = answer.trim() || null;
  if (preserveSchedule) return { wrongAnswer };
  const row = getProgressRow(item.item_type, item.item_key);
  if (row && row.consecutive_failures + 1 >= 3) {
    return { wrongAnswer, before: `N${row.box_level}`, after: 'compliqué' };
  }
  const current = row?.box_level ?? 0;
  const next = Math.max(current - 1, 0);
  if (current === next) return { wrongAnswer };
  return { wrongAnswer, before: `N${current}`, after: `N${next}` };
}

// Redemande la même question jusqu'à une bonne réponse. Seule la première tentative
// (retournée ici) compte pour la note Leitner — les redemandes suivantes ne sont qu'un
// entraînement affiché à l'écran, sous la forme d'une carte « deuxième tentative ».
async function askUntilCorrect(container, item, {
  instruction, question, expected, pos, example, context, index, total, badge, forceRetry, options, checkFn,
}) {
  let first = null;
  let attempt = 0;
  while (true) {
    const retry = forceRetry || attempt > 0;
    // L'indice n'apparaît qu'à la reprise : la première tentative se joue sans filet.
    const hint = attempt > 0 ? hintMaskHtml(expected) : '';
    const result = await questionCard(container, {
      instruction,
      question,
      badge,
      retry,
      // La carte or dit « on y revient » : au 2e essai c'est une reprise, en mode « mots
      // ratés » c'est un mot déjà tombé une fois.
      retryLabel: attempt > 0 ? 'Deuxième tentative' : 'Mot déjà raté',
      hint,
      context,
      remaining: Math.max(0, total - index - 1),
      checkFn,
    });
    if (result.skipped) throw new ItemSkipped();
    const { answer, isCorrect } = result;
    if (first === null) first = isCorrect;

    await resultCard(container, {
      isCorrect,
      answer: expected,
      pos,
      translation: `${question} = ${expected}`,
      // Le contexte a déjà été vu sur la carte question ; sur la carte résultat il ne
      // revient que si la réponse était fausse, pour expliquer la nuance ratée.
      context: !isCorrect ? context : null,
      example,
      // Seule la première tentative décide du sort de l'item : c'est la seule qui affiche
      // la conséquence.
      consequence: !isCorrect && attempt === 0 ? failureConsequence(item, answer, options) : null,
      actionLabel: isCorrect ? 'Suivant' : 'Réessayer',
    });
    if (isCorrect) break;
    attempt += 1;
  }
  return first;
}

async function runVocabQuestion(container, item, { index, total, badge, options, forceRetry, tally }) {
  const before = getProgressRow(item.item_type, item.item_key);

  const baseCorrect = await askUntilCorrect(container, item, {
    instruction: 'Traduis en anglais',
    question: item.prompt,
    expected: item.en_base,
    pos: item.type,
    example: item.example,
    context: item.context,
    index, total, badge, forceRetry, options,
    checkFn: (answer) => checkBase(item, answer),
  });

  let conjugationCorrect = true;
  if (item.en_past_simple) {
    conjugationCorrect = await askUntilCorrect(container, item, {
      instruction: 'Passé simple / participe passé',
      question: item.en_base,
      expected: `${item.en_past_simple} / ${item.en_past_participle}`,
      pos: item.type,
      example: item.example,
      index, total, badge, forceRetry, options,
      checkFn: (answer) => checkConjugation(item, answer),
    });
  }

  await finalizeVocabItem(item, baseCorrect, conjugationCorrect, options);
  recordOutcome(tally, before, getProgressRow(item.item_type, item.item_key), baseCorrect && conjugationCorrect);
}

async function runGrammaireQuestion(container, item, { index, total, badge, options, forceRetry, tally }) {
  const before = getProgressRow(item.item_type, item.item_key);
  const isCorrect = await askUntilCorrect(container, item, {
    instruction: 'Traduis en anglais',
    question: item.prompt,
    expected: item.en,
    pos: null,
    example: item.explication,
    context: item.context,
    index, total, badge, forceRetry, options,
    checkFn: (answer) => checkAnswer(item, answer),
  });
  await finalizeItem(item, isCorrect, options);
  recordOutcome(tally, before, getProgressRow(item.item_type, item.item_key), isCorrect);
}

async function runExpressionQuestion(container, item, { index, total, badge, options, forceRetry, tally }) {
  const before = getProgressRow(item.item_type, item.item_key);
  const isCorrect = await askUntilCorrect(container, item, {
    instruction: "Trouve l'expression",
    question: item.prompt,
    expected: item.en,
    pos: null,
    example: item.example,
    context: item.context,
    index, total, badge, forceRetry, options,
    checkFn: (answer) => checkAnswer(item, answer),
  });
  await finalizeItem(item, isCorrect, options);
  recordOutcome(tally, before, getProgressRow(item.item_type, item.item_key), isCorrect);
}

async function runQuestion(container, item, ctx) {
  if (item.item_type === 'vocabulaire') await runVocabQuestion(container, item, ctx);
  else if (item.item_type === 'grammaire') await runGrammaireQuestion(container, item, ctx);
  else if (item.item_type === 'expressions') await runExpressionQuestion(container, item, ctx);
}

// --- Mots compliqués -------------------------------------------------------

// Phase 1: En -> Fr/sens, sans indice. Phase 2: Fr/sens -> En, avec indice masqué.
// Phase 3: Fr/sens -> En, sans indice (la question du circuit normal).
function hardModeQuestion(item, phase) {
  const forwardExpected = item.item_type === 'vocabulaire' ? item.en_base : item.en;
  const forwardCheck = item.item_type === 'vocabulaire'
    ? (answer) => checkBase(item, answer)
    : (answer) => checkAnswer(item, answer);

  if (phase === 1) {
    return {
      instruction: 'Traduis en français',
      question: forwardExpected,
      expected: item.prompt,
      hint: '',
      // Le contexte annote le mot français : il ne s'affiche pas ici, où le français est
      // la réponse à trouver, pas la question posée (voir runHardModeRound pour la carte
      // résultat, qui peut encore s'en servir sur un échec).
      context: item.context,
      checkFn: (answer) => checkReverse(item, answer),
    };
  }
  if (phase === 2) {
    return {
      instruction: 'Traduis en anglais',
      question: item.prompt,
      expected: forwardExpected,
      hint: hintMaskHtml(forwardExpected),
      context: item.context,
      checkFn: forwardCheck,
    };
  }
  return {
    instruction: 'Traduis en anglais',
    question: item.prompt,
    expected: forwardExpected,
    hint: '',
    context: item.context,
    checkFn: forwardCheck,
  };
}

function phaseBadge(phase) {
  return `<span class="ds-badge ds-badge--tricky">Phase ${phase}</span>`;
}

// Interroge `item` à `targetPhase` jusqu'à ce qu'il quitte cette phase — en avançant
// (succès), en sortant du processus (succès en phase 3 ou plafond d'échecs du jour), ou en
// redescendant vers une autre phase. Rendre la main à chaque changement de phase est ce qui
// permet à renderHardMode de grouper les items par phase plutôt que de faire parcourir tout
// le trajet 1→2→3 à un item avant de passer au suivant.
async function runHardModeRound(container, item, targetPhase, tally) {
  while (true) {
    const { instruction, question, expected, hint, context, checkFn } = hardModeQuestion(item, targetPhase);
    const pos = item.item_type === 'vocabulaire' ? item.type : null;
    const attemptResult = await questionCard(container, {
      instruction,
      question,
      hint,
      // Le contexte n'annote que le mot français ; il ne s'affiche sous la question qu'en
      // phase 2/3, où c'est le français qui est demandé (en phase 1 c'est l'anglais).
      context: targetPhase === 1 ? null : context,
      // La phase est déjà nommée par le badge de l'en-tête : pas deux fois sur le même écran.
      checkFn,
    });
    if (attemptResult.skipped) throw new ItemSkipped();
    const { answer, isCorrect } = attemptResult;
    tally.answered += 1;
    if (isCorrect) tally.correct += 1;
    else tally.wrong += 1;

    if (isCorrect && targetPhase === 3) {
      await gradeHardAttempt(item, 3, true);
      tally.exitedHard += 1;
      tally.phasesCleared += 1;
      await resultCard(container, {
        isCorrect: true,
        answer: expected,
        pos,
        translation: `${question} = ${expected}`,
        example: item.example || item.explication,
        consequence: 'Sorti du mode compliqué : le mot revient demain en découverte',
        actionLabel: 'Suivant',
      });
      return { done: true };
    }

    const result = await gradeHardAttempt(item, targetPhase, isCorrect);

    if (isCorrect) {
      tally.phasesCleared += 1;
      await resultCard(container, {
        isCorrect: true,
        answer: expected,
        pos,
        translation: `${question} = ${expected}`,
        example: item.example || item.explication,
        actionLabel: 'Suivant',
      });
      return { done: false, newPhase: advancedPhase(targetPhase, item.item_type) };
    }

    // Plafonné : le plafond du jour bloque toute nouvelle tentative, mais la phase elle-même
    // ne bouge pas — pas de pastille de transition, juste la réponse barrée.
    await resultCard(container, {
      isCorrect: false,
      answer: expected,
      pos,
      translation: `${question} = ${expected}`,
      // La carte résultat peut porter le contexte même en phase 1 (question anglaise) :
      // ici le français révélé est la réponse attendue, et le contexte explique pourquoi
      // c'est précisément celle-là.
      context,
      example: item.example || item.explication,
      consequence: result.cappedToday
        ? { wrongAnswer: answer.trim() || null }
        : { wrongAnswer: answer.trim() || null, before: `Phase ${targetPhase}`, after: `Phase ${demotedPhase(targetPhase, item.item_type)}` },
      actionLabel: 'Réessayer',
    });
    if (result.cappedToday) return { done: true };
    const demoted = demotedPhase(targetPhase, item.item_type);
    if (demoted !== targetPhase) return { done: false, newPhase: demoted };
  }
}

// --- Modes -----------------------------------------------------------------

// Tous les items passent d'abord en phase 1, puis tous ceux encore actifs en phase 2, puis
// en phase 3 — jamais le trajet complet 1→2→3 d'un item avant le suivant. La phase 1 est
// toujours vidée en premier à chaque tour, si bien qu'un item redescendu en phase 1 (échec
// en phase 2) y repasse avant les items restants en phase 2/3, comme n'importe quel autre.
export async function renderHardMode(container, { hardItems }, { onComplete, onExit }) {
  const { area, setProgress } = renderModeShell(container, onExit);
  const tally = newTally('hard');
  const queues = { 1: [], 2: [], 3: [] };
  for (const item of hardItems) queues[item.hard_phase].push(item);

  // Chaque item doit franchir 3 phases : la progression compte les franchissements
  // réussis, pas les items, puisqu'un item peut redescendre de phase.
  const total = hardItems.length * 3;
  let done = 0;
  while (queues[1].length || queues[2].length || queues[3].length) {
    const phase = queues[1].length ? 1 : queues[2].length ? 2 : 3;
    setProgress(done, total, { badge: phaseBadge(phase) });
    const item = queues[phase].shift();
    try {
      const outcome = await runHardModeRound(area, item, phase, tally);
      done = Math.min(done + 1, total - 1);
      if (!outcome.done) queues[outcome.newPhase].push(item);
    } catch (err) {
      if (!(err instanceof ItemSkipped)) throw err;
      // Le mot passé ne revient dans aucune file : il reste exactement où il était.
      done = Math.min(done + 1, total - 1);
    }
  }
  onComplete(tally);
}

export async function renderLearningMode(container, { newItems }, { onComplete, onExit }) {
  const { area, setProgress } = renderModeShell(container, onExit);
  const tally = newTally('learning');
  // Deux passages, chacun reparti de zéro : la lecture des nouveaux mots (remplissage
  // rayé), puis la phase question/réponse (remplissage plein).
  for (let i = 0; i < newItems.length; i++) {
    setProgress(i, newItems.length, { phase: 'discover' });
    const fields = discoverFields(newItems[i]);
    await discoverCard(area, { ...fields, remaining: newItems.length - i - 1 });
  }
  for (let i = 0; i < newItems.length; i++) {
    setProgress(i, newItems.length);
    try {
      await runQuestion(area, newItems[i], { index: i, total: newItems.length, tally });
    } catch (err) {
      if (!(err instanceof ItemSkipped)) throw err;
    }
  }
  onComplete(tally);
}

export async function renderReviewMode(container, { reviewItems }, { onComplete, onExit }) {
  const { area, setProgress } = renderModeShell(container, onExit);
  const tally = newTally('review');
  for (let i = 0; i < reviewItems.length; i++) {
    setProgress(i, reviewItems.length);
    try {
      await runQuestion(area, reviewItems[i], { index: i, total: reviewItems.length, tally });
    } catch (err) {
      if (!(err instanceof ItemSkipped)) throw err;
    }
  }
  onComplete(tally);
}

export async function renderFailedWordsMode(container, { failedWords }, { onComplete, onExit }) {
  const { area, setProgress } = renderModeShell(container, onExit);
  const tally = newTally('failed');
  for (let i = 0; i < failedWords.length; i++) {
    setProgress(i, failedWords.length);
    try {
      await runQuestion(area, failedWords[i], {
        index: i, total: failedWords.length, forceRetry: true, options: { preserveSchedule: true }, tally,
      });
    } catch (err) {
      if (!(err instanceof ItemSkipped)) throw err;
    }
  }
  onComplete(tally);
}

// --- Session terminée ------------------------------------------------------

function formatDuration(ms) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  return `${Math.round(seconds / 60)} min`;
}

function formatDateFr(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// Bilan « médaille » (apprentissage / révision) : le score porte l'écran, l'objectif
// atteint est l'unique message — aucun détail de notation, disponible dans Statistiques.
async function renderRecapMedal(container, tally, onHome) {
  const streak = getStreak();
  const today = todayISO();
  const learnedCount = getLearnedCount();
  const learnedToday = getLearnedToday(today);

  container.innerHTML = `
    <div class="session-body" style="gap:22px">
      <div class="recap-medal-wrap">
        <div class="recap-medal">
          <div class="recap-medal__inner">
            <div class="recap-medal__n">${tally.answered}</div>
            <div class="recap-medal__d">/ ${tally.answered} MOTS</div>
          </div>
          <span class="recap-medal__check">${icon('check', { size: 26, color: '#FAF7EF', stroke: 3 })}</span>
        </div>
      </div>

      <div class="recap-goal">
        <div class="recap-goal__title">Objectif du jour atteint</div>
        ${streak > 0 ? `<div class="recap-goal__streak">${icon('flame', { size: 16, color: 'var(--gold-400)', stroke: 2.3 })}<span>${streak} jour${streak > 1 ? 's' : ''} d'affilée</span></div>` : ''}
      </div>

      ${statPillHtml({
        variant: 'recap', value: learnedCount, delta: `+${learnedToday}`,
        deltaColor: 'var(--green-400)', label: 'Mots appris au total',
      })}
    </div>
    <div class="session-foot">
      <button type="button" class="ds-btn ds-btn--hero" id="recap-home">Retour à l'accueil</button>
    </div>
  `;
  container.querySelector('#recap-home').addEventListener('click', onHome);
}

// Bilan détaillé (mots compliqués / mots ratés) : ce qui a bougé, chiffré — pas de médaille,
// « objectif du jour » ne concerne que découverte/révision.
async function renderRecapDetailed(container, tally, { onHome, onReview }) {
  const session = await startSession();
  const streak = getStreak();
  const nextDate = tally.nextDates.length ? tally.nextDates.slice().sort()[0] : null;
  const reviewLeft = session.reviewItems.length;

  const rows = tally.kind === 'hard'
    ? [
      ['Phases franchies', tally.phasesCleared],
      ['Sortis du mode compliqué', tally.exitedHard],
    ]
    : [
      ["Montés d'un niveau", tally.levelUp],
      ['Reprogrammés en découverte', tally.requeued],
      ['Prochaine révision', formatDateFr(nextDate)],
    ];

  const thirdColumn = tally.kind === 'hard'
    ? ['Sortis', tally.exitedHard]
    : ['Appris', tally.learned];

  container.innerHTML = `
    <div class="session-body" style="gap:16px">
      <div class="recap-title">Session terminée</div>
      <div class="recap-sub">Tu as répondu à ${tally.answered} ${tally.answered > 1 ? 'questions' : 'question'} en ${formatDuration(Date.now() - tally.started)}.</div>

      <div class="recap-card">
        <div class="recap-nums">
          <div>
            <div class="recap-num recap-num--ok">${tally.correct}</div>
            <div class="recap-numlabel">Corrects</div>
          </div>
          <div>
            <div class="recap-num recap-num--ko">${tally.wrong}</div>
            <div class="recap-numlabel">Ratés</div>
          </div>
          <div>
            <div class="recap-num">${thirdColumn[1]}</div>
            <div class="recap-numlabel">${thirdColumn[0]}</div>
          </div>
        </div>
        ${rows.map(([label, value]) => `
          <div class="recap-row"><span>${label}</span><b>${escapeHtml(value)}</b></div>
        `).join('')}
      </div>

      ${streak > 0 ? `<div class="recap-streak">${icon('flame', { size: 17, color: '#2B1F00', stroke: 2.4 })}<span>Série portée à ${streak} jour${streak > 1 ? 's' : ''}</span></div>` : ''}
    </div>
    <div class="session-foot">
      <button type="button" class="ds-btn ds-btn--hero" id="recap-home">Retour à l'accueil</button>
      ${reviewLeft > 0 ? `<button type="button" class="ds-btn ds-btn--hero ds-btn--secondary" id="recap-review">Réviser ${reviewLeft} mot${reviewLeft > 1 ? 's' : ''} dus</button>` : ''}
    </div>
  `;

  container.querySelector('#recap-home').addEventListener('click', onHome);
  if (reviewLeft > 0) {
    container.querySelector('#recap-review').addEventListener('click', () => onReview(session));
  }
}

export async function renderSessionRecap(container, tally, { onHome, onReview }) {
  container.innerHTML = '<div class="loading-block"><span class="ds-spinner"></span><div class="loading-msg">Calcul du bilan</div></div>';
  if (tally.kind === 'learning' || tally.kind === 'review') {
    await renderRecapMedal(container, tally, onHome);
  } else {
    await renderRecapDetailed(container, tally, { onHome, onReview });
  }
}

// --- Dialogue de confirmation ----------------------------------------------

// Requis avant toute action destructive. Le scrim floute l'écran, le titre nomme la perte,
// le bouton nomme l'acte — aucun « OK ».
function confirmDialog({ title, body, confirmLabel, cancelLabel = 'Annuler' }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'ds-overlay';
    overlay.innerHTML = `
      <div class="ds-scrim" id="dialog-scrim"></div>
      <div class="ds-dialog" role="dialog" aria-modal="true">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(body)}</p>
        <div class="ds-dialog__actions">
          <button type="button" class="ds-btn ds-btn--hero ds-btn--danger" id="dialog-confirm">${escapeHtml(confirmLabel)}</button>
          <button type="button" class="ds-btn ds-btn--hero ds-btn--ghost" id="dialog-cancel">${escapeHtml(cancelLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = (value) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(false); };

    overlay.querySelector('#dialog-confirm').addEventListener('click', () => close(true));
    overlay.querySelector('#dialog-cancel').addEventListener('click', () => close(false));
    overlay.querySelector('#dialog-scrim').addEventListener('click', () => close(false));
    document.addEventListener('keydown', onKey);
    overlay.querySelector('#dialog-confirm').focus();
  });
}

// --- Statistiques ----------------------------------------------------------

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
    <div class="screen-scroll">
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
    </div>
  `;
}

// --- Réglages --------------------------------------------------------------

function importSummaryLine(label, s) {
  if (!s.sheetFound) return `${label} : feuille introuvable`;
  const dup = s.duplicateId.length ? ` · ${s.duplicateId.length} ID en double ignorés` : '';
  return `${label} : ${s.new} nouveau(x) · ${s.updated} mis à jour · ${s.skipped} ignorée(s)${dup}`;
}

function toastHtml(tone, message, withIcon) {
  const glyph = withIcon ? icon('check', { size: 15, color: 'currentColor', stroke: 2.6 }) : '';
  return `<div class="ds-toast ds-toast--${tone}">${glyph}<span>${escapeHtml(message)}</span></div>`;
}

export function renderSettings(container) {
  const n = getSetting('new_items_per_day') ?? '10';
  const lastExport = getSetting('last_manual_export');
  const since = daysSince(lastExport);
  const lastExportText = since === null ? 'jamais' : since === 0 ? "aujourd'hui" : `il y a ${since} jour(s)`;

  container.innerHTML = `
    <h1>Réglages</h1>

    <div class="screen-scroll">
      <div class="ds-section">
        <div class="ds-section__head">${icon('upload', { size: 18, color: 'var(--copper-600)' })}<span class="ds-section__title">Importer le vocabulaire</span></div>
        <div class="ds-section__body">
          <p>Sélectionne ton fichier Excel (.xlsx). Réimporter est sans risque : le contenu est mis à
          jour, ta progression de révision n'est jamais effacée.</p>
          <input type="file" id="import-file" accept=".xlsx" />
          <div id="import-summary"></div>
        </div>
      </div>

      <div class="ds-section">
        <div class="ds-section__head">${icon('sparkles', { size: 18, color: 'var(--copper-600)' })}<span class="ds-section__title">Nouveaux items par jour</span></div>
        <div class="ds-section__body">
          <p>Nombre maximum de nouveaux mots/règles/expressions introduits chaque jour, tous types confondus.</p>
          <input type="number" id="n-input" min="1" step="1" value="${escapeHtml(n)}" />
          <button type="button" class="ds-btn ds-btn--sm" id="n-save-btn">Enregistrer</button>
          <div id="n-status"></div>
        </div>
      </div>

      <div class="ds-section">
        <div class="ds-section__head">${icon('download', { size: 18, color: 'var(--copper-600)' })}<span class="ds-section__title">Sauvegarde</span></div>
        <div class="ds-section__body">
          <p>Ta progression est stockée uniquement sur cet appareil. Exporte une sauvegarde de temps
          en temps (par ex. vers Fichiers/iCloud) pour ne rien perdre en cas de problème.</p>
          <div class="ds-kv"><span>Dernier export</span><span class="ds-kv__v">${escapeHtml(lastExportText)}</span></div>
          <button type="button" class="ds-btn ds-btn--hero" id="export-btn">Exporter une sauvegarde</button>
        </div>
      </div>

      <div class="ds-section ds-section--danger">
        <div class="ds-section__head">${icon('triangle-alert', { size: 18, color: 'currentColor' })}<span class="ds-section__title">Restaurer une sauvegarde</span></div>
        <div class="ds-section__body">
          <p>La restauration écrase toutes tes données actuelles : mots, niveaux, série et
          statistiques sont remplacés par le contenu du fichier.</p>
          <input type="file" id="restore-file" accept=".sqlite" />
          <div id="restore-status"></div>
        </div>
      </div>

      <div class="ds-section ds-section--danger">
        <div class="ds-section__head">${icon('triangle-alert', { size: 18, color: 'currentColor' })}<span class="ds-section__title">Zone de débogage</span></div>
        <div class="ds-section__body">
          <p>Efface définitivement tout le contenu et toute la progression actuels, pour repartir
          d'une base vide (à réimporter ensuite).</p>
          <button type="button" class="ds-btn ds-btn--hero ds-btn--danger" id="reset-db-btn">Réinitialiser la base de données</button>
          <div id="reset-db-status"></div>
        </div>
      </div>
    </div>
  `;

  const importFile = container.querySelector('#import-file');
  const importSummary = container.querySelector('#import-summary');
  importFile.addEventListener('change', async () => {
    const file = importFile.files[0];
    if (!file) return;

    // Pendant l'import : l'anneau et des squelettes à la place des lignes à venir. Jamais
    // de pourcentage inventé.
    importSummary.innerHTML = `
      <div class="loading-block"><span class="ds-spinner"></span><div class="loading-msg">Import du fichier en cours</div></div>
      <div class="skel-stack"><div class="ds-skel"></div><div class="ds-skel"></div><div class="ds-skel"></div></div>
    `;
    try {
      const buffer = await file.arrayBuffer();
      const workbook = parseWorkbookFile(buffer);
      const summary = await importFromWorkbook(workbook, todayISO());
      importSummary.innerHTML = [
        toastHtml('correct', importSummaryLine('Vocabulaire', summary.vocabulaire), true),
        toastHtml('correct', importSummaryLine('Grammaire', summary.grammaire), true),
        toastHtml('correct', importSummaryLine('Expressions', summary.expressions), true),
      ].join('');
    } catch (err) {
      importSummary.innerHTML = toastHtml('wrong', `Fichier illisible : ${err.message}`, false);
    } finally {
      importFile.value = '';
    }
  });

  container.querySelector('#n-save-btn').addEventListener('click', async () => {
    const value = parseInt(container.querySelector('#n-input').value, 10);
    const status = container.querySelector('#n-status');
    if (!Number.isFinite(value) || value < 1) {
      status.innerHTML = '<div class="ds-alert ds-alert--warning">Merci de saisir un nombre valide (≥ 1).</div>';
      return;
    }
    await setSetting('new_items_per_day', value);
    status.innerHTML = '<div class="ds-alert ds-alert--success">Enregistré.</div>';
  });

  container.querySelector('#export-btn').addEventListener('click', async () => {
    await exportToFile();
    renderSettings(container);
  });

  container.querySelector('#restore-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const status = container.querySelector('#restore-status');
    const ok = await confirmDialog({
      title: 'Restaurer cette sauvegarde ?',
      body: 'La restauration écrase toutes tes données actuelles. Mots, niveaux, série et statistiques seront remplacés par le contenu du fichier.',
      confirmLabel: 'Remplacer mes données',
    });
    if (!ok) {
      e.target.value = '';
      return;
    }
    status.innerHTML = '<div class="loading-block"><span class="ds-spinner"></span><div class="loading-msg">Restauration en cours</div></div>';
    try {
      await importFromFile(file);
      status.innerHTML = toastHtml('correct', 'Sauvegarde restaurée', true);
    } catch (err) {
      status.innerHTML = toastHtml('wrong', `Erreur : ${err.message}`, false);
    } finally {
      e.target.value = '';
    }
  });

  container.querySelector('#reset-db-btn').addEventListener('click', async () => {
    const status = container.querySelector('#reset-db-status');
    const ok = await confirmDialog({
      title: 'Effacer toute la base ?',
      body: 'Tout le contenu et toute la progression actuels sont supprimés définitivement. Il faudra réimporter ton fichier Excel ensuite.',
      confirmLabel: 'Tout effacer',
    });
    if (!ok) return;
    status.innerHTML = '<div class="loading-block"><span class="ds-spinner"></span><div class="loading-msg">Réinitialisation en cours</div></div>';
    try {
      await resetDatabase();
      renderSettings(container);
      container.querySelector('#reset-db-status').innerHTML = toastHtml('correct', 'Base réinitialisée', true);
    } catch (err) {
      status.innerHTML = toastHtml('wrong', `Erreur : ${err.message}`, false);
    }
  });
}
