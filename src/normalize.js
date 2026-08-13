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

export function answersMatch(userInput, expected) {
  const a = canonicalizeSynonyms(stripLeadingFiller(normalizeAnswer(userInput)));
  const b = canonicalizeSynonyms(stripLeadingFiller(normalizeAnswer(expected)));
  return a === b && a.length > 0;
}

// Accepte la réponse si elle correspond à au moins une des traductions listées dans
// expectedRaw (séparées par " / ").
export function answersMatchAny(userInput, expectedRaw) {
  return splitAlternatives(expectedRaw).some((alt) => answersMatch(userInput, alt));
}
