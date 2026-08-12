import { all, get, run, save } from './db.js';

export const LEVEL_INTERVAL_DAYS = { 1: 1, 2: 2, 3: 4, 4: 8 };

export function nextLevelOnCorrect(level) {
  if (level >= 4) return { level: 4, learned: true };
  return { level: level + 1, learned: false };
}

export function nextLevelOnIncorrect(level) {
  if (level <= 0) return 0;
  return Math.max(level - 1, 1);
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function gradeAnswer(itemType, itemKey, isCorrect, todayISO) {
  const row = get('SELECT * FROM progress WHERE item_type = ? AND item_key = ?', [itemType, itemKey]);
  if (!row) throw new Error(`No progress row for ${itemType}/${itemKey}`);

  const introducedAt = row.total_reviews === 0 ? todayISO : row.introduced_at;
  let boxLevel, isLearned, nextReviewDate, correctStreak;

  if (isCorrect) {
    const { level, learned } = nextLevelOnCorrect(row.box_level);
    boxLevel = level;
    isLearned = learned ? 1 : 0;
    nextReviewDate = learned ? null : addDays(todayISO, LEVEL_INTERVAL_DAYS[level]);
    correctStreak = row.correct_streak + 1;
  } else {
    boxLevel = nextLevelOnIncorrect(row.box_level);
    isLearned = 0;
    nextReviewDate = addDays(todayISO, LEVEL_INTERVAL_DAYS[boxLevel] ?? 0);
    correctStreak = 0;
  }

  run(
    `UPDATE progress SET
       box_level = ?, is_learned = ?, next_review_date = ?, introduced_at = ?,
       last_result = ?, last_reviewed_at = ?, correct_streak = ?, total_reviews = total_reviews + 1
     WHERE item_type = ? AND item_key = ?`,
    [
      boxLevel,
      isLearned,
      nextReviewDate,
      introducedAt,
      isCorrect ? 'correct' : 'incorrect',
      new Date().toISOString(),
      correctStreak,
      itemType,
      itemKey,
    ]
  );
  await save();
}

// All three branches must expose the same column list (SQLite UNION ALL requires matching
// column counts) — unused fields per type are padded with NULL.
const CONTENT_QUERIES = {
  vocabulaire: `SELECT 'vocabulaire' as item_type, key as item_key, fr as prompt, en_base, en_past_simple,
                       en_past_participle, example, type, NULL as explication, NULL as en
                FROM vocabulaire`,
  grammaire: `SELECT 'grammaire' as item_type, key as item_key, fr as prompt, NULL as en_base, NULL as en_past_simple,
                     NULL as en_past_participle, NULL as example, NULL as type, explication, en
              FROM grammaire`,
  expressions: `SELECT 'expressions' as item_type, key as item_key, meaning as prompt, NULL as en_base, NULL as en_past_simple,
                       NULL as en_past_participle, example, NULL as type, NULL as explication, en
                FROM expressions`,
};

function unionAll(clause) {
  return Object.values(CONTENT_QUERIES)
    .map((q) => `SELECT * FROM (${q}) JOIN progress USING (item_type, item_key) WHERE ${clause}`)
    .join(' UNION ALL ');
}

export function getDueItems(todayISO) {
  return all(unionAll(`is_learned = 0 AND total_reviews > 0 AND next_review_date <= '${todayISO}'`));
}

export function countNewIntroducedToday(todayISO) {
  const row = get("SELECT COUNT(*) as c FROM progress WHERE introduced_at = ?", [todayISO]);
  return row ? row.c : 0;
}

export function getNewItemsPool(budget) {
  if (budget <= 0) return [];
  // Shuffled rather than sorted by type: sorting alphabetically would let "expressions"
  // starve "vocabulaire"/"grammaire" out of the shared daily budget entirely.
  return shuffle(all(unionAll('total_reviews = 0'))).slice(0, budget);
}

export function getLearnedSample(n) {
  if (n <= 0) return [];
  return shuffle(all(unionAll('is_learned = 1'))).slice(0, n);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function buildDailySession(newItemsPerDay, todayISO) {
  const due = getDueItems(todayISO);
  const budget = Math.max(0, newItemsPerDay - countNewIntroducedToday(todayISO));
  const fresh = getNewItemsPool(budget);
  const learnedN = Math.min(3, Math.floor((due.length + fresh.length) * 0.1));
  const learned = getLearnedSample(learnedN);
  return shuffle([...due, ...fresh, ...learned]);
}
