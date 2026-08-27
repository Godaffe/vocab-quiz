export function normalizeAnswer(str) {
  return String(str ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Déterminants ignorés en début de réponse, dans les deux langues.
const FILLER_PREFIXES = ['to ', 'a ', 'an ', 'the ', 'le ', 'la ', 'les ', 'un ', 'une '];

function stripLeadingFiller(normalized) {
  for (const prefix of FILLER_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      return normalized.slice(prefix.length);
    }
  }
  return normalized;
}

// Groupes de synonymes anglais interchangeables. Pour en ajouter un : une nouvelle ligne,
// une nouvelle liste de formes équivalentes (minuscules, sans accent — le texte est déjà
// normalisé à ce stade). Le premier élément de chaque groupe sert de forme canonique.
const SYNONYM_GROUPS = [
  ['someone', 'somebody'],
  ['anyone', 'anybody'],
  ['everyone', 'everybody'],
  ['no one', 'nobody'],
  ['among', 'amongst'],
  ['while', 'whilst'],
  ['toward', 'towards'],
  ['autumn', 'fall'],
  ['movie', 'film'],
];

function canonicalizeSynonyms(normalized) {
  let result = normalized;
  for (const [canonical, ...variants] of SYNONYM_GROUPS) {
    for (const variant of variants) {
      result = result.replace(new RegExp(`\\b${variant}\\b`, 'g'), canonical);
    }
  }
  return result;
}

// Découpe une valeur "attendue" qui peut contenir plusieurs traductions valides séparées
// par " / " (convention déjà utilisée dans le classeur source pour fr/en_base/meaning/en),
// ex. "Chagrin / deuil" -> ["Chagrin", "deuil"].
export function splitAlternatives(text) {
  return String(text ?? '').split('/').map((s) => s.trim()).filter(Boolean);
}

// Formes -ing plausibles d'un verbe (candidates générées, pas toutes grammaticalement
// garanties) et, à l'inverse, bases plausibles reconstruites à partir d'une forme en -ing —
// couvre les cas courants (e final muet, consonne doublée, "ie" -> "y") pour qu'une réponse
// au gérondif ou à l'infinitif soit acceptée indifféremment, sans dictionnaire de verbes.
function verbFormVariants(word) {
  const variants = new Set([word]);
  if (word.endsWith('ing') && word.length > 4) {
    const stem = word.slice(0, -3);
    variants.add(stem);
    variants.add(`${stem}e`);
    if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2] && !'aeiou'.includes(stem[stem.length - 1])) {
      variants.add(stem.slice(0, -1));
    }
    if (stem.endsWith('y') && stem.length > 1 && !'aeiou'.includes(stem[stem.length - 2])) {
      variants.add(`${stem.slice(0, -1)}ie`);
    }
  } else {
    if (word.endsWith('ie')) {
      variants.add(`${word.slice(0, -2)}ying`);
    } else if (word.endsWith('e') && word.length > 2) {
      variants.add(`${word.slice(0, -1)}ing`);
    } else {
      variants.add(`${word}ing`);
      if (/[^aeiou][aeiou][^aeiouwxy]$/.test(word)) {
        variants.add(`${word}${word[word.length - 1]}ing`);
      }
    }
  }
  return variants;
}

// Verbe seul ou verbe à particule (« turn someone down », « give up ») : seul le premier mot
// tolère le gérondif/infinitif, le reste de la phrase doit correspondre à l'identique — un
// verbe à particule ne change jamais de forme ailleurs qu'à son verbe de tête.
function verbFormsEquivalent(a, b) {
  const wordsA = a ? a.split(' ') : [];
  const wordsB = b ? b.split(' ') : [];
  if (wordsA.length === 0 || wordsA.length !== wordsB.length) return false;
  if (wordsA.slice(1).join(' ') !== wordsB.slice(1).join(' ')) return false;
  const variantsA = verbFormVariants(wordsA[0]);
  for (const v of verbFormVariants(wordsB[0])) {
    if (variantsA.has(v)) return true;
  }
  return false;
}

export function answersMatch(userInput, expected) {
  const a = canonicalizeSynonyms(stripLeadingFiller(normalizeAnswer(userInput)));
  const b = canonicalizeSynonyms(stripLeadingFiller(normalizeAnswer(expected)));
  if (a.length === 0) return false;
  return a === b || verbFormsEquivalent(a, b);
}

// Accepte la réponse si elle correspond à au moins une des traductions listées dans
// expectedRaw (séparées par " / ").
export function answersMatchAny(userInput, expectedRaw) {
  return splitAlternatives(expectedRaw).some((alt) => answersMatch(userInput, alt));
}
