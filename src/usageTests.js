import { answersMatchExact } from './normalize.js';

// Lecture de la colonne « Tests usage » du classeur (format : comptes-rendus/spec-tests-usage.md).
// Le texte est découpé en manières (ligne « # … »), chacune avec ses tests :
//   trou      { kind: 'gap', before, after, answers, hint } — « cope [with] the pressure »
//   placement { kind: 'choice', options: [{ text, correct }] } — lignes « * » (juste) et « - »
//             (fausse) consécutives ; une ligne vide sépare deux tests de placement.
//   type      { kind: 'type', parts: [{ text } | { slot: [types] }], wrong: [types] } — ligne
//             « > ask after + <Quelqu'un> {Quelque chose, V-ing} » : on reconstitue la règle
//             en remplissant chaque case « <…> » avec le ou les types de mots (« & ») attendus.
// Une ligne mal formée est ignorée, une manière sans aucun test valide aussi : le mot garde
// alors ses autres questions.
const GAP_RE = /^(.*?)\[([^\]]+)\](?:\s*\(([^)]*)\))?(.*)$/;
const CHOICE_RE = /^([*-])\s+(.+)$/;
const TYPE_RE = /^>\s*(.*?)\s*(?:\{([^}]*)\})?\s*$/;
const SLOT_RE = /<([^>]*)>/g;

// Nombre de boutons de type proposés sur la carte (bons types + mauvais).
export const TYPE_BUTTONS = 6;

const splitList = (text, sep) => text.split(sep).map((s) => s.trim()).filter(Boolean);

// Ligne « > règle {mauvais, …} ». Ignorée sans aucune case, ou avec une case vide.
function parseTypeLine(line) {
  const m = line.match(TYPE_RE);
  if (!m) return null;
  const parts = [];
  let last = 0;
  for (const slot of m[1].matchAll(SLOT_RE)) {
    const text = m[1].slice(last, slot.index).trim();
    if (text) parts.push({ text });
    const types = [...new Set(splitList(slot[1], '&'))];
    if (types.length === 0) return null;
    parts.push({ slot: types });
    last = slot.index + slot[0].length;
  }
  const tail = m[1].slice(last).trim();
  if (tail) parts.push({ text: tail });
  const correct = new Set(parts.flatMap((p) => p.slot ?? []));
  if (correct.size === 0) return null;
  const wrong = [...new Set(splitList(m[2] ?? '', ','))].filter((t) => !correct.has(t));
  return { kind: 'type', parts, wrong };
}

function parseGapLine(line) {
  if ((line.match(/\[/g) || []).length !== 1) return null;
  const m = line.match(GAP_RE);
  if (!m) return null;
  const answers = m[2].split('|').map((s) => s.trim()).filter(Boolean);
  if (answers.length === 0) return null;
  return { kind: 'gap', before: m[1].trimEnd(), after: m[4].trimStart(), answers, hint: m[3]?.trim() || null };
}

// Un test de placement n'est gardé que s'il a au moins une phrase juste et une fausse.
function isValidChoice(test) {
  return test.options.some((o) => o.correct) && test.options.some((o) => !o.correct);
}

export function parseUsageTests(text) {
  const raw = String(text ?? '').trim();
  if (!raw || raw === '—' || raw === '-') return [];
  const ways = [];
  let current = null;
  let choice = null;

  const closeChoice = () => {
    if (choice && isValidChoice(choice)) current.tests.push(choice);
    choice = null;
  };
  const ensureWay = () => {
    // Tests écrits sans ligne « # » au-dessus : une manière sans nom les regroupe.
    if (!current) {
      current = { label: '', tests: [] };
      ways.push(current);
    }
  };

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      if (current) closeChoice();
      continue;
    }
    // « # » et pas « = » : une cellule qui commence par « = » est une formule pour Excel.
    if (line.startsWith('#')) {
      if (current) closeChoice();
      current = { label: line.slice(1).trim(), tests: [] };
      ways.push(current);
      continue;
    }
    ensureWay();
    if (line.startsWith('>')) {
      closeChoice();
      const typeTest = parseTypeLine(line);
      if (typeTest) current.tests.push(typeTest);
      continue;
    }
    const choiceLine = line.match(CHOICE_RE);
    if (choiceLine) {
      if (!choice) choice = { kind: 'choice', options: [] };
      choice.options.push({ text: choiceLine[2].trim(), correct: choiceLine[1] === '*' });
      continue;
    }
    closeChoice();
    const gap = parseGapLine(line);
    if (gap) current.tests.push(gap);
  }
  if (current) closeChoice();
  return ways.filter((way) => way.tests.length > 0);
}

// Un test par manière à chaque révision, en rotation : la n-ième révision du mot pose le
// n-ième test (modulo) de chaque manière, si bien que toutes les phrases reviennent à tour de rôle.
export function pickUsageTests(ways, reviewCount) {
  return ways.map((way) => ({ label: way.label, test: way.tests[(reviewCount ?? 0) % way.tests.length] }));
}

export function checkGap(test, answer) {
  return test.answers.some((expected) => answersMatchExact(answer, expected));
}

// Juste si au moins une bonne phrase est cochée et aucune fausse : quand plusieurs phrases
// sont justes, en cocher une seule suffit. `selected` contient des indices dans test.options.
export function checkChoice(test, selected) {
  const chosen = new Set(selected);
  const picked = test.options.filter((_, i) => chosen.has(i));
  return picked.length > 0 && picked.every((option) => option.correct);
}

// Phrase complète d'un trou, avec la première réponse admise : sert de corrigé.
export function gapSolution(test) {
  return [test.before, test.answers[0], test.after].filter(Boolean).join(' ');
}

// Phrase d'un trou telle qu'affichée dans la question : « ___ », suivi de l'indice s'il y en a un.
export function gapQuestion(test) {
  const gap = test.hint ? `___ (${test.hint})` : '___';
  return [test.before, gap, test.after].filter(Boolean).join(' ');
}

// Boutons de la carte type de mot : tous les bons types (sans doublon), complétés par des
// mauvais tirés au hasard jusqu'à TYPE_BUTTONS, le tout mélangé. `random` est injectable
// pour les tests.
export function typeButtons(test, random = Math.random) {
  const shuffle = (list) => list.map((v) => [random(), v]).sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  const correct = [...new Set(test.parts.flatMap((p) => p.slot ?? []))];
  const wrong = shuffle(test.wrong).slice(0, Math.max(0, TYPE_BUTTONS - correct.length));
  return shuffle([...correct, ...wrong]);
}

// Cases de la règle, dans l'ordre : chacune est la liste des types attendus.
export function typeSlots(test) {
  return test.parts.filter((p) => p.slot).map((p) => p.slot);
}

// Juste seulement si chaque case contient exactement ses types (ordre libre dans la case),
// case par case dans l'ordre de la règle. `filled` : un tableau de types par case.
export function checkTypeSlot(expected, chosen) {
  const set = new Set(chosen);
  return set.size === expected.length && expected.every((t) => set.has(t));
}

export function checkType(test, filled) {
  const slots = typeSlots(test);
  return slots.length === filled.length && slots.every((slot, i) => checkTypeSlot(slot, filled[i] ?? []));
}
