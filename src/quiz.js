import { buildDailySession, getNewItemsPerDay, gradeAnswer, exitHardMode, recordHardAttempt } from './leitner.js';
import { answersMatch, answersMatchAny } from './normalize.js';
import { todayISO } from './dates.js';

export async function startSession() {
    return buildDailySession(getNewItemsPerDay(), todayISO());
}

export function checkBase(item, answer) {
  // Nom allemand : l'article se choisit en pastille, il est toléré mais pas exigé ici.
  const typed = item.item_type === 'allemand' ? String(answer ?? '').trim().replace(/^(der|die|das)\s+/i, '') : answer;
  return answersMatchAny(typed, item.en_base);
}

// Pastilles de la carte de traduction allemande (27/10/2026) : l'article d'un nom
// (der / die / das, un seul choix) ou l'auxiliaire du parfait d'un verbe (haben / sein, à
// cocher : un verbe « haben / sein » demande les deux). Null quand le mot n'a ni l'un ni l'autre.
export const ARTICLES = ['der', 'die', 'das'];
export const AUXILIARIES = ['haben', 'sein'];
export function chipTest(item) {
  if (item.item_type !== 'allemand') return null;
  // `prefix` : à la correction, l'article se lit devant le nom (« die Wirtschaft ») au lieu des
  // pastilles (choix d'Anto du 27/10/2026).
  if (ARTICLES.includes(item.genre)) return { options: ARTICLES, correct: [item.genre], multi: false, prefix: true };
  const aux = String(item.auxiliaire ?? '').split(' / ').filter((a) => AUXILIARIES.includes(a));
  if (aux.length) return { options: AUXILIARIES, correct: aux, multi: true };
  return null;
}

// Juste si les pastilles choisies sont exactement les bonnes.
export function checkChips(test, selected) {
  return selected.length === test.correct.length && test.correct.every((c) => selected.includes(c));
}

export function checkConjugation(item, answer) {
  const expectedSlash = `${item.en_past_simple} / ${item.en_past_participle}`;
  const expectedSpace = `${item.en_past_simple} ${item.en_past_participle}`;
  return answersMatch(answer, expectedSlash) || answersMatch(answer, expectedSpace);
}

export async function finalizeVocabItem(item, baseCorrect, conjugationCorrect, options) {
  const isCorrect = baseCorrect && (conjugationCorrect ?? true);
  await gradeAnswer(item.item_type, item.item_key, isCorrect, todayISO(), options);
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
