import { answersMatchExact } from './normalize.js';

// Lecture de la colonne « Tests usage » du classeur (format : comptes-rendus/spec-tests-usage.md).
// Le texte est découpé en manières (ligne « # … »), chacune avec ses tests :
//   trou      { kind: 'gap', before, after, answers, hint } — « cope [with] the pressure »
//   placement { kind: 'choice', options: [{ text, correct }] } — lignes « * » (juste) et « - »
//             (fausse) consécutives ; une ligne vide sépare deux tests de placement.
// Une ligne mal formée est ignorée, une manière sans aucun test valide aussi : le mot garde
// alors ses autres questions.
const GAP_RE = /^(.*?)\[([^\]]+)\](?:\s*\(([^)]*)\))?(.*)$/;
const CHOICE_RE = /^([*-])\s+(.+)$/;

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

// Juste seulement si les phrases cochées sont exactement les bonnes : ni oubli, ni en trop.
// `selected` contient des indices dans test.options.
export function checkChoice(test, selected) {
  const chosen = new Set(selected);
  return test.options.every((option, i) => option.correct === chosen.has(i));
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
