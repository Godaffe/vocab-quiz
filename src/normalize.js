export function normalizeAnswer(str) {
  return String(str ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const FILLER_PREFIXES = ['to ', 'a ', 'an ', 'the '];

function stripLeadingFiller(normalized) {
  for (const prefix of FILLER_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      return normalized.slice(prefix.length);
    }
  }
  return normalized;
}

export function answersMatch(userInput, expected, { tolerant = false } = {}) {
  let a = normalizeAnswer(userInput);
  let b = normalizeAnswer(expected);
  if (tolerant) {
    a = stripLeadingFiller(a);
    b = stripLeadingFiller(b);
  }
  return a === b && a.length > 0;
}
