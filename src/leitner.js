import { all, get, run, save, getSetting } from './db.js';

export const LEVEL_INTERVAL_DAYS = { 1: 1, 2: 2, 3: 4, 4: 8 };

export function nextLevelOnCorrect(level) {
  if (level >= 4) return { level: 4, learned: true };
  return { level: level + 1, learned: false };
}

export function nextLevelOnIncorrect(level) {
  return Math.max(level - 1, 0);
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Finds the earliest future day that still has room in the daily new-word budget, cascading
// forward day by day when a day is already full of scheduled requeues (review failures and
// "mots compliqués" graduates share this same daily cap).
function scheduleRequeue(todayISO) {
  const capacity = parseInt(getSetting('new_items_per_day') ?? '10', 10);
  let date = addDays(todayISO, 1);
  while (true) {
    const row = get('SELECT COUNT(*) as c FROM progress WHERE requeue_date = ?', [date]);
    if ((row?.c ?? 0) < capacity) return date;
    date = addDays(date, 1);
  }
}

export async function gradeAnswer(itemType, itemKey, isCorrect, todayISO) {
  const row = get('SELECT * FROM progress WHERE item_type = ? AND item_key = ?', [itemType, itemKey]);
  if (!row) throw new Error(`No progress row for ${itemType}/${itemKey}`);

  // Items with a pending requeue (review failures, or "mots compliqués" graduates) are
  // re-stamped as introduced today too, so they count against today's new-word budget like a
  // real new item.
  const introducedAt = (row.total_reviews === 0 || row.requeue_date) ? todayISO : row.introduced_at;
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
  } else {
    boxLevel = nextLevelOnIncorrect(row.box_level);
    isLearned = 0;
    correctStreak = 0;
    if (row.total_reviews > 0) {
      // Review-mode failure: leave today's review pool entirely, come back as a new item
      // (preview + test) on the earliest future day that still has room in the daily budget.
      nextReviewDate = null;
      requeueDate = scheduleRequeue(todayISO);
    } else {
      // A truly brand-new item failing its very first attempt: unchanged, stays due today.
      nextReviewDate = addDays(todayISO, LEVEL_INTERVAL_DAYS[boxLevel] ?? 0);
      requeueDate = null;
    }
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
      enteringHard ? 1 : row.hard_phase,
      enteringHard ? 0 : row.hard_failures_today,
      enteringHard ? todayISO : row.hard_session_date,
      itemType,
      itemKey,
    ]
  );
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
  await save();
}

// Phase 1/2 attempts, and failed Phase 3 attempts, within the "mots compliqués" process.
// A successful Phase 3 attempt is handled by exitHardMode instead, not this function.
export async function recordHardAttempt(itemType, itemKey, isCorrect, currentPhase, todayISO) {
  const row = get('SELECT * FROM progress WHERE item_type = ? AND item_key = ?', [itemType, itemKey]);
  if (!row) throw new Error(`No progress row for ${itemType}/${itemKey}`);

  let hardPhase = currentPhase;
  let hardFailuresToday = row.hard_failures_today;
  let cappedToday = false;

  if (isCorrect) {
    hardPhase = advancedPhase(currentPhase, itemType);
  } else {
    hardFailuresToday += 1;
    cappedToday = hardFailuresToday >= 9;
    if (!cappedToday) hardPhase = demotedPhase(currentPhase, itemType);
  }

  run(
    `UPDATE progress SET
       total_reviews = total_reviews + 1, last_reviewed_at = ?, last_result = ?,
       hard_phase = ?, hard_failures_today = ?
     WHERE item_type = ? AND item_key = ?`,
    [new Date().toISOString(), isCorrect ? 'correct' : 'incorrect', hardPhase, hardFailuresToday, itemType, itemKey]
  );
  await save();

  return { hardFailuresToday, cappedToday };
}

export function advancedPhase(currentPhase, itemType) {
  if (currentPhase === 1) return itemType === 'grammaire' ? 3 : 2;
  return 3; // phase 2 -> 3 (a phase-3 success exits the process via exitHardMode, not this fn)
}

export function demotedPhase(currentPhase, itemType) {
  if (currentPhase === 3) return itemType === 'grammaire' ? 1 : 2;
  return 1; // phase 1 or phase 2 failed -> (re)descend to phase 1
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
  return all(unionAll(
    `learning_process = 'normal' AND is_learned = 0 AND total_reviews > 0 AND next_review_date <= '${todayISO}'`
  ));
}

export function countNewIntroducedToday(todayISO) {
  const row = get(
    "SELECT COUNT(*) as c FROM progress WHERE introduced_at = ? AND last_result = 'correct'",
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

export async function getHardModeItems(todayISO) {
  const items = all(unionAll("learning_process = 'hard'"));
  let changed = false;
  for (const item of items) {
    if (item.hard_session_date !== todayISO) {
      run(
        `UPDATE progress SET hard_phase = 1, hard_failures_today = 0, hard_session_date = ?
         WHERE item_type = ? AND item_key = ?`,
        [todayISO, item.item_type, item.item_key]
      );
      item.hard_phase = 1;
      item.hard_failures_today = 0;
      item.hard_session_date = todayISO;
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

export async function buildDailySession(newItemsPerDay, todayISO) {
  const hardItems = await getHardModeItems(todayISO);
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
