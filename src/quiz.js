import { getSetting } from './db.js';
import { buildDailySession, gradeAnswer, exitHardMode, recordHardAttempt } from './leitner.js';
import { answersMatch, answersMatchAny } from './normalize.js';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export async function startSession() {
  const n = parseInt(getSetting('new_items_per_day') ?? '10', 10);
  return buildDailySession(n, todayISO());
}

export function checkBase(item, answer) {
  return answersMatchAny(answer, item.en_base);
}

export function checkConjugation(item, answer) {
  const expectedSlash = `${item.en_past_simple} / ${item.en_past_participle}`;
  const expectedSpace = `${item.en_past_simple} ${item.en_past_participle}`;
  return answersMatch(answer, expectedSlash) || answersMatch(answer, expectedSpace);
}

export async function finalizeVocabItem(item, baseCorrect, conjugationCorrect, options) {
  const isCorrect = baseCorrect && (conjugationCorrect ?? true);
  await gradeAnswer('vocabulaire', item.item_key, isCorrect, todayISO(), options);
  return isCorrect;
}

// Grammaire (Fr sentence -> En translation) and Expressions (Meaning -> En expression)
// both boil down to "compare against item.en".
export function checkAnswer(item, answer) {
  return answersMatchAny(answer, item.en);
}

export async function finalizeItem(item, isCorrect, options) {
  await gradeAnswer(item.item_type, item.item_key, isCorrect, todayISO(), options);
  return isCorrect;
}

// Phase 1 of "mots compliqués" (En -> Fr/Meaning): item.prompt already holds the fr/meaning
// side for all 3 types, so this is just the mirror of the normal-direction checks above.
export function checkReverse(item, answer) {
  return answersMatchAny(answer, item.prompt);
}

export async function gradeHardAttempt(item, phase, isCorrect, today = todayISO()) {
  if (isCorrect && phase === 3) {
    await exitHardMode(item.item_type, item.item_key, today);
    return { exited: true };
  }
  const result = await recordHardAttempt(item.item_type, item.item_key, isCorrect, phase, today);
  return { exited: false, ...result };
}
