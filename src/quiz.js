import { getSetting } from './db.js';
import { buildDailySession, gradeAnswer } from './leitner.js';
import { answersMatch } from './normalize.js';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export async function startVocabSession() {
  const n = parseInt(getSetting('new_items_per_day') ?? '10', 10);
  const session = buildDailySession(n, todayISO());
  return session.filter((item) => item.item_type === 'vocabulaire');
}

export function checkBase(item, answer) {
  return answersMatch(answer, item.en_base, { tolerant: true });
}

export function checkConjugation(item, answer) {
  const expectedSlash = `${item.en_past_simple} / ${item.en_past_participle}`;
  const expectedSpace = `${item.en_past_simple} ${item.en_past_participle}`;
  return answersMatch(answer, expectedSlash) || answersMatch(answer, expectedSpace);
}

export async function finalizeVocabItem(item, baseCorrect, conjugationCorrect) {
  const isCorrect = baseCorrect && (conjugationCorrect ?? true);
  await gradeAnswer('vocabulaire', item.item_key, isCorrect, todayISO());
  return isCorrect;
}
