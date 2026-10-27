import { all, get, run, save, getSetting } from './db.js';
import { localDayBoundsUTC } from './dates.js';

export const LEVEL_INTERVAL_DAYS = { 1: 1, 2: 2, 3: 4, 4: 8 };

export function nextLevelOnCorrect(level) {
  if (level >= 4) return { level: 4, learned: true };
  return { level: level + 1, learned: false };
}

// Échec d'un mot déjà réussi au moins une fois (règle du 26/10/2026) : N2, N3, N4 ou appris
// retombent à N1, N1 retombe à N0.
export function nextLevelOnIncorrect(level) {
  return level >= 2 ? 1 : 0;
}

// Un item qui arrive par la découverte (jamais noté, ou reprogrammé comme mot nouveau : mot
// neuf raté, sortie des mots compliqués) y retourne s'il est raté. Tout autre item est un mot
// en cours : raté, il reste en révision.
export function comesFromDiscovery(row) {
  return row.total_reviews === 0 || Boolean(row.requeue_date);
}

// Langue active (réglage « langue », anglais par défaut) : chaque langue a ses propres tables,
// sa progression, son quota de mots nouveaux et ses compteurs du jour. La série de jours reste
// commune.
const LANG_TABLES = { en: ['vocabulaire', 'grammaire', 'expressions'], de: ['allemand'] };
export const currentLang = () => (getSetting('langue') === 'de' ? 'de' : 'en');
const langTypeFilter = () => `item_type IN (${LANG_TABLES[currentLang()].map((t) => `'${t}'`).join(', ')})`;
// Les clés anglaises gardent leur nom d'origine : les compteurs déjà enregistrés restent valables.
const langKey = (key) => (currentLang() === 'en' ? key : `${key}_${currentLang()}`);

// Quota de mots nouveaux par jour, propre à chaque langue (10 par défaut). Une langue autre que
// l'anglais sans réglage propre reprend la valeur anglaise : rien ne change tant qu'on ne la règle pas.
export function getNewItemsPerDay(lang = currentLang()) {
  const base = parseInt(getSetting('new_items_per_day') ?? '10', 10);
  if (lang === 'en') return base;
  const own = getSetting(`new_items_per_day_${lang}`);
  return own == null ? base : parseInt(own, 10);
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Tracks the "streak" of consecutive days with at least one graded answer, via the settings
// table. Called once per calling function invocation; a no-op once today has already been
// counted (checked via last_active_date) so it's safe to call on every grade/hard attempt.
function bumpStreak(todayISO) {
  const last = getSetting('last_active_date');
  if (last === todayISO) return;
  const streak = last === addDays(todayISO, -1) ? parseInt(getSetting('streak_count') ?? '0', 10) + 1 : 1;
  run(
    "INSERT INTO settings (key, value) VALUES ('last_active_date', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [todayISO]
  );
  run(
    "INSERT INTO settings (key, value) VALUES ('streak_count', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [String(streak)]
  );
}

// La série stockée n'est remise à 1 qu'à la prochaine réponse notée : tant que la dernière
// activité date d'avant-hier ou plus, elle est déjà rompue et s'affiche à 0.
export function getStreak(todayISO) {
  const last = getSetting('last_active_date');
  if (last !== todayISO && last !== addDays(todayISO, -1)) return 0;
  return parseInt(getSetting('streak_count') ?? '0', 10);
}

// Deltas du jour affichés sur l'accueil (« +N » à côté des totaux) : deux compteurs datés,
// remis à zéro implicitement dès que la date stockée diffère d'aujourd'hui — même mécanique
// que bumpStreak/getStreak, appelés depuis gradeAnswer au moment exact du franchissement.
function bumpDailyCounter(baseCounterKey, baseDateKey, todayISO) {
  const counterKey = langKey(baseCounterKey);
  const dateKey = langKey(baseDateKey);
  const day = getSetting(dateKey);
  const count = day === todayISO ? parseInt(getSetting(counterKey) ?? '0', 10) + 1 : 1;
  run(
    `INSERT INTO settings (key, value) VALUES ('${dateKey}', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [todayISO]
  );
  run(
    `INSERT INTO settings (key, value) VALUES ('${counterKey}', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [String(count)]
  );
}

function getDailyCounter(baseCounterKey, baseDateKey, todayISO) {
  const counterKey = langKey(baseCounterKey);
  const dateKey = langKey(baseDateKey);
  return getSetting(dateKey) === todayISO ? parseInt(getSetting(counterKey) ?? '0', 10) : 0;
}

const bumpLearnedToday = (todayISO) => bumpDailyCounter('learned_today_count', 'learned_today_date', todayISO);
export const getLearnedToday = (todayISO) => getDailyCounter('learned_today_count', 'learned_today_date', todayISO);

const bumpStartedToday = (todayISO) => bumpDailyCounter('started_today_count', 'started_today_date', todayISO);
export const getStartedToday = (todayISO) => getDailyCounter('started_today_count', 'started_today_date', todayISO);

// Finds the earliest future day that still has room in the daily new-word budget, cascading
// forward day by day when a day is already full of scheduled requeues (review failures and
// "mots compliqués" graduates share this same daily cap).
function scheduleRequeue(todayISO) {
  const capacity = getNewItemsPerDay();
  let date = addDays(todayISO, 1);
  while (true) {
    const row = get(`SELECT COUNT(*) as c FROM progress WHERE requeue_date = ? AND ${langTypeFilter()}`, [date]);
    if ((row?.c ?? 0) < capacity) return date;
    date = addDays(date, 1);
  }
}

export async function gradeAnswer(itemType, itemKey, isCorrect, todayISO, { preserveSchedule = false } = {}) {
  const row = get('SELECT * FROM progress WHERE item_type = ? AND item_key = ?', [itemType, itemKey]);
  if (!row) throw new Error(`No progress row for ${itemType}/${itemKey}`);

  // Items with a pending requeue (review failures, or "mots compliqués" graduates) are
  // re-stamped as introduced today too, so they count against today's new-word budget like a
  // real new item.
  const introducedAt = (row.total_reviews === 0 || row.requeue_date) ? todayISO : row.introduced_at;
  // Ce grading est le tout premier de l'item — il bascule dans "en cours" à l'instant même,
  // quel que soit le résultat (même une première réponse fausse compte comme démarré).
  if (row.total_reviews === 0) bumpStartedToday(todayISO);
  let boxLevel, isLearned, nextReviewDate, correctStreak, requeueDate;

  const consecutiveFailures = isCorrect ? 0 : row.consecutive_failures + 1;
  const enteringHard = !isCorrect && consecutiveFailures >= 3;

  if (enteringHard) {
    boxLevel = 0;
    isLearned = 0;
    nextReviewDate = null;
    correctStreak = 0;
    requeueDate = null;
  } else if (isCorrect) {
    const { level, learned } = nextLevelOnCorrect(row.box_level);
    boxLevel = level;
    isLearned = learned ? 1 : 0;
    nextReviewDate = learned ? null : addDays(todayISO, LEVEL_INTERVAL_DAYS[level]);
    correctStreak = row.correct_streak + 1;
    requeueDate = null;
    // Franchissement 0 -> 1 de is_learned uniquement : un mot déjà appris qui revient en
    // renforcement (getLearnedSample) ne doit pas regonfler le delta du jour.
    if (learned && !row.is_learned) bumpLearnedToday(todayISO);
  } else if (preserveSchedule) {
    // Échec dans « Réviser mes mots ratés » : niveau et échéance inchangés, le mot reste raté.
    boxLevel = row.box_level;
    isLearned = 0;
    correctStreak = 0;
    nextReviewDate = row.next_review_date;
    requeueDate = row.requeue_date;
  } else if (comesFromDiscovery(row)) {
    // Mot neuf (ou reprogrammé) raté : il quitte le jour et revient comme mot nouveau (carte de
    // découverte + test) au premier jour suivant qui a encore de la place dans le quota.
    boxLevel = 0;
    isLearned = 0;
    correctStreak = 0;
    nextReviewDate = null;
    requeueDate = scheduleRequeue(todayISO);
  } else {
    // Mot en cours raté : il ne repasse jamais par la découverte. Il retombe à N1 (ou N0 s'il
    // était à N1), revient en révision demain et figure dans les mots ratés en attendant.
    boxLevel = nextLevelOnIncorrect(row.box_level);
    isLearned = 0;
    correctStreak = 0;
    nextReviewDate = addDays(todayISO, 1);
    requeueDate = null;
  }

  run(
    `UPDATE progress SET
       box_level = ?, is_learned = ?, next_review_date = ?, introduced_at = ?,
       last_result = ?, last_reviewed_at = ?, correct_streak = ?, total_reviews = total_reviews + 1,
       consecutive_failures = ?, requeue_date = ?,
       learning_process = ?, hard_phase = ?, hard_failures_today = ?, hard_session_date = ?
     WHERE item_type = ? AND item_key = ?`,
    [
      boxLevel,
      isLearned,
      nextReviewDate,
      introducedAt,
      isCorrect ? 'correct' : 'incorrect',
      new Date().toISOString(),
      correctStreak,
      consecutiveFailures,
      requeueDate,
      enteringHard ? 'hard' : 'normal',
      enteringHard ? initialHardPhase(itemType) : row.hard_phase,
      enteringHard ? 0 : row.hard_failures_today,
      enteringHard ? todayISO : row.hard_session_date,
      itemType,
      itemKey,
    ]
  );
  bumpStreak(todayISO);
  await save();
}

// Called on a Phase 3 success in the "mots compliqués" process: the item returns to the
// normal circuit at box_level 0, and reappears tomorrow like a brand-new item (previewed,
// then tested, and counted against the day's new-word budget).
export async function exitHardMode(itemType, itemKey, todayISO) {
  const requeueDate = scheduleRequeue(todayISO);
  run(
    `UPDATE progress SET
       learning_process = 'normal', hard_phase = NULL, hard_failures_today = 0, hard_session_date = NULL,
       requeue_date = ?, consecutive_failures = 2, box_level = 0, is_learned = 0,
       next_review_date = NULL, last_result = 'correct', last_reviewed_at = ?,
       correct_streak = correct_streak + 1, total_reviews = total_reviews + 1
     WHERE item_type = ? AND item_key = ?`,
    [requeueDate, new Date().toISOString(), itemType, itemKey]
  );
  bumpStreak(todayISO);
  await save();
}

// Phase 1/2 attempts, and failed Phase 3 attempts, within the "mots compliqués" process.
// A successful Phase 3 attempt is handled by exitHardMode instead, not this function.
// Un échec sort le mot de la séance en cours et le renvoie à sa phase de départ : il ne
// reviendra qu'à la prochaine séance de mots compliqués (même le jour même), en phase 1.
export async function recordHardAttempt(itemType, itemKey, isCorrect, currentPhase, todayISO) {
  const row = get('SELECT * FROM progress WHERE item_type = ? AND item_key = ?', [itemType, itemKey]);
  if (!row) throw new Error(`No progress row for ${itemType}/${itemKey}`);

  const hardPhase = isCorrect ? advancedPhase(currentPhase) : initialHardPhase(itemType);

  run(
    `UPDATE progress SET
       total_reviews = total_reviews + 1, last_reviewed_at = ?, last_result = ?, hard_phase = ?
     WHERE item_type = ? AND item_key = ?`,
    [new Date().toISOString(), isCorrect ? 'correct' : 'incorrect', hardPhase, itemType, itemKey]
  );
  bumpStreak(todayISO);
  await save();

  return { hardPhase };
}

export function advancedPhase(currentPhase) {
  return currentPhase === 1 ? 2 : 3; // a phase-3 success exits the process via exitHardMode, not this fn
}

// Phase de la question de rattrapage posée (non notée) après un échec : celle du dessous,
// sans descendre sous la phase de départ — à la phase la plus basse, la même question.
export function rescuePhase(currentPhase, itemType) {
  return Math.max(currentPhase - 1, initialHardPhase(itemType));
}

// Phase de départ d'un item en mode compliqué : 2 pour les expressions et la grammaire (qui
// sautent la phase 1, trajet 2 -> 3 -> sortie), 1 pour les mots.
export function initialHardPhase(itemType) {
  return itemType === 'expressions' || itemType === 'grammaire' ? 2 : 1;
}

// All branches must expose the same column list (SQLite UNION ALL requires matching
// column counts) — unused fields per type are padded with NULL.
const CONTENT_QUERIES = {
  vocabulaire: `SELECT 'vocabulaire' as item_type, key as item_key, fr as prompt, en_base, en_past_simple,
                       en_past_participle, example, type, NULL as explication, NULL as en, registre, sens, usage, usage_tests,
                       region, NULL as genre, NULL as pluriel
                FROM vocabulaire`,
  grammaire: `SELECT 'grammaire' as item_type, key as item_key, fr as prompt, NULL as en_base, NULL as en_past_simple,
                     NULL as en_past_participle, NULL as example, NULL as type, explication, en,
                     NULL as registre, NULL as sens, NULL as usage, NULL as usage_tests, NULL as region,
                     NULL as genre, NULL as pluriel
              FROM grammaire`,
  expressions: `SELECT 'expressions' as item_type, key as item_key, meaning as prompt, NULL as en_base, NULL as en_past_simple,
                       NULL as en_past_participle, example, NULL as type, NULL as explication, en,
                       NULL as registre, NULL as sens, NULL as usage, NULL as usage_tests, region,
                       NULL as genre, NULL as pluriel
                FROM expressions`,
  // Mot allemand : mêmes colonnes que Voc (de_base joue le rôle d'en_base), plus l'article
  // (genre) et le pluriel irrégulier.
  allemand: `SELECT 'allemand' as item_type, key as item_key, fr as prompt, de_base as en_base,
                    de_past_simple as en_past_simple, de_past_participle as en_past_participle, example, type,
                    NULL as explication, NULL as en, registre, sens, usage, usage_tests, NULL as region, genre, pluriel
             FROM allemand`,
};

function unionAll(clause) {
  return LANG_TABLES[currentLang()]
    .map((table) => CONTENT_QUERIES[table])
    .map((q) => `SELECT * FROM (${q}) JOIN progress USING (item_type, item_key) WHERE ${clause}`)
    .join(' UNION ALL ');
}

export function getDueItems(todayISO) {
  return all(unionAll(
    `learning_process = 'normal' AND is_learned = 0 AND total_reviews > 0 AND next_review_date <= '${todayISO}'`
  ));
}

export function countNewIntroducedToday(todayISO) {
  const row = get(
    `SELECT COUNT(*) as c FROM progress WHERE introduced_at = ? AND last_result = 'correct' AND ${langTypeFilter()}`,
    [todayISO]
  );
  return row ? row.c : 0;
}

export function getNewItemsPool(budget, todayISO) {
  if (budget <= 0) return [];
  // Requeued items (review failures, "mots compliqués" graduates) always take priority over
  // genuinely new items for the shared daily budget. Each tier is shuffled internally rather
  // than sorted by type, so "expressions" can't starve "vocabulaire"/"grammaire" out of it.
  const requeued = shuffle(all(unionAll(
    `requeue_date IS NOT NULL AND requeue_date <= '${todayISO}' AND learning_process = 'normal'`
  )));
  const fresh = shuffle(all(unionAll("total_reviews = 0 AND learning_process = 'normal'")));
  return [...requeued, ...fresh].slice(0, budget);
}

export function getLearnedSample(n) {
  if (n <= 0) return [];
  return shuffle(all(unionAll("is_learned = 1 AND learning_process = 'normal'"))).slice(0, n);
}

// Pas de remise à zéro quotidienne : un mot garde sa phase d'une séance à l'autre (seul un
// échec le renvoie à sa phase de départ). On corrige seulement une phase hors trajet — une
// grammaire encore en phase 1 d'avant le trajet 2 -> 3, ou une phase manquante.
export async function getHardModeItems() {
  const items = all(unionAll("learning_process = 'hard'"));
  let changed = false;
  for (const item of items) {
    const startPhase = initialHardPhase(item.item_type);
    if (![1, 2, 3].includes(item.hard_phase) || item.hard_phase < startPhase) {
      run(
        'UPDATE progress SET hard_phase = ? WHERE item_type = ? AND item_key = ?',
        [startPhase, item.item_type, item.item_key]
      );
      item.hard_phase = startPhase;
      changed = true;
    }
  }
  if (changed) await save();
  return items;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function getAllProgress() {
  return all(unionAll('1=1'));
}

// État brut d'un item, lu avant/après notation pour établir le bilan de fin de session
// (montées de niveau, reprogrammations, mots appris) sans deviner les règles Leitner.
export function getProgressRow(itemType, itemKey) {
  return get('SELECT * FROM progress WHERE item_type = ? AND item_key = ?', [itemType, itemKey]);
}

// Items du circuit normal déjà notés aujourd'hui — le dénominateur affiché sur l'accueil
// est ce compte plus ce qu'il reste à faire, jamais un total inventé.
// last_reviewed_at est un horodatage UTC : on le compare aux bornes UTC du jour local.
export function countReviewedToday(todayISO) {
  const [start, end] = localDayBoundsUTC(todayISO);
  const row = get(
    `SELECT COUNT(*) as c FROM progress WHERE learning_process = 'normal' AND last_reviewed_at >= ? AND last_reviewed_at < ? AND ${langTypeFilter()}`,
    [start, end]
  );
  return row ? row.c : 0;
}

export function getLearnedCount() {
  return get(`SELECT COUNT(*) as c FROM (${unionAll('is_learned = 1')})`).c;
}

export function getInProgressCount() {
  return get(`SELECT COUNT(*) as c FROM (${unionAll('total_reviews > 0 AND is_learned = 0')})`).c;
}

// Mots ratés : items du circuit normal déjà notés dont la dernière réponse est fausse, quel que
// soit leur niveau (N1 ou N0 après un échec). Une réussite, en révision ou ici, les fait sortir.
// Exclut les mots compliqués (circuit à part) et un mot qui vient de SORTIR du mode compliqué :
// exitHardMode note sa dernière réponse juste, il n'est pas raté.
export function getFailedWordsPool() {
  return all(unionAll(
    "learning_process = 'normal' AND total_reviews > 0 AND is_learned = 0 AND last_result = 'incorrect'"
  ));
}

// Rattrapage unique de la règle du 26/10/2026 : les mots en cours que l'ancienne règle a
// renvoyés en découverte (reprogrammés, dernière réponse fausse, déjà réussis au moins une fois,
// c.-à-d. plus de réponses que d'échecs d'affilée) reviennent en révision aujourd'hui, au niveau
// qu'ils auraient eu avec la nouvelle règle : l'ancienne avait ôté un niveau, donc N1 ou plus
// en attente (N2+ avant l'échec) -> N1, N0 en attente (N1 avant l'échec) -> N0. Les mots neufs
// ratés (jamais réussis) restent en découverte.
export async function migrateFailedReviewRequeues(todayISO) {
  if (getSetting('migration_echec_revision') === 'done') return;
  run(
    `UPDATE progress SET
       box_level = CASE WHEN box_level >= 1 THEN 1 ELSE 0 END,
       next_review_date = ?, requeue_date = NULL
     WHERE learning_process = 'normal' AND requeue_date IS NOT NULL AND last_result = 'incorrect'
       AND total_reviews > consecutive_failures`,
    [todayISO]
  );
  run("INSERT INTO settings (key, value) VALUES ('migration_echec_revision', 'done') ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  await save();
}

export async function buildDailySession(newItemsPerDay, todayISO) {
  const hardItems = await getHardModeItems();
  const due = getDueItems(todayISO);
  const budget = Math.max(0, newItemsPerDay - countNewIntroducedToday(todayISO));
  const fresh = getNewItemsPool(budget, todayISO);
  const learnedN = Math.min(3, Math.floor((due.length + fresh.length) * 0.1));
  const learned = getLearnedSample(learnedN);
  return {
    hardItems,
    newItems: shuffle(fresh),
    reviewItems: shuffle([...due, ...learned]),
  };
}
