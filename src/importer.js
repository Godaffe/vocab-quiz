import * as XLSX from 'xlsx';
import { get, run, save } from './db.js';

export function parseIrregularVerb(enText) {
  const text = String(enText ?? '').trim();
  const m = text.match(/^(.*?)\s*\(([^/]+)\/\s*([^)]+)\)\s*$/);
  if (m) {
    return { base: m[1].trim(), pastSimple: m[2].trim(), pastParticiple: m[3].trim() };
  }
  return { base: text, pastSimple: null, pastParticiple: null };
}

const SHEETS = [
  {
    table: 'vocabulaire',
    candidates: ['Voc'],
    required: ['ID', 'Fr', 'En'],
    fields: ['fr', 'en', 'en_base', 'en_past_simple', 'en_past_participle', 'example', 'type', 'context'],
    mapRow(row) {
      const { base, pastSimple, pastParticiple } = parseIrregularVerb(row.En);
      return {
        fr: String(row.Fr).trim(),
        en: String(row.En).trim(),
        en_base: base,
        en_past_simple: pastSimple,
        en_past_participle: pastParticiple,
        example: row['Exemple en En'] ? String(row['Exemple en En']).trim() : null,
        type: row.Type ? String(row.Type).trim() : null,
        context: row.Contexte ? String(row.Contexte).trim() : null,
      };
    },
  },
  {
    table: 'grammaire',
    candidates: ['Grammaire', 'Gammaire'],
    required: ['ID', 'Fr', 'En'],
    fields: ['fr', 'en', 'explication', 'context'],
    mapRow(row) {
      return {
        fr: String(row.Fr).trim(),
        en: String(row.En).trim(),
        explication: row.Explication ? String(row.Explication).trim() : null,
        context: row.Contexte ? String(row.Contexte).trim() : null,
      };
    },
  },
  {
    table: 'expressions',
    candidates: ['Expressions'],
    required: ['ID', 'En', 'Meaning'],
    fields: ['en', 'meaning', 'example', 'context'],
    mapRow(row) {
      return {
        en: String(row.En).trim(),
        meaning: String(row.Meaning).trim(),
        example: row['Exemple en En'] ? String(row['Exemple en En']).trim() : null,
        context: row.Contexte ? String(row.Contexte).trim() : null,
      };
    },
  },
];

function findSheetName(workbook, candidates) {
  for (const candidate of candidates) {
    const found = workbook.SheetNames.find((n) => n.toLowerCase() === candidate.toLowerCase());
    if (found) return found;
  }
  return null;
}

function fieldsDiffer(existing, fields, columns) {
  return columns.some((col) => (existing[col] ?? null) !== (fields[col] ?? null));
}

export async function importFromWorkbook(workbook, todayISO) {
  const summary = {};
  for (const cfg of SHEETS) {
    summary[cfg.table] = { new: 0, updated: 0, unchanged: 0, skipped: 0, duplicateId: [], sheetFound: false };
  }

  for (const cfg of SHEETS) {
    const sheetName = findSheetName(workbook, cfg.candidates);
    if (!sheetName) continue;
    summary[cfg.table].sheetFound = true;

    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
    const seenIds = new Set();

    for (const row of rows) {
      const hasRequired = cfg.required.every((col) => row[col] !== '' && row[col] != null);
      if (!hasRequired) {
        summary[cfg.table].skipped++;
        continue;
      }

      const key = String(row.ID).trim();
      if (seenIds.has(key)) {
        summary[cfg.table].duplicateId.push(key);
        continue;
      }
      seenIds.add(key);

      const fields = cfg.mapRow(row);
      const existing = get(`SELECT * FROM ${cfg.table} WHERE key = ?`, [key]);

      if (!existing) {
        const columns = ['key', ...cfg.fields, 'updated_at'];
        const placeholders = columns.map(() => '?').join(', ');
        const values = [key, ...cfg.fields.map((f) => fields[f] ?? null), todayISO];
        run(`INSERT INTO ${cfg.table} (${columns.join(', ')}) VALUES (${placeholders})`, values);
        run(
          'INSERT INTO progress (item_type, item_key, box_level, is_learned, total_reviews, created_at) VALUES (?, ?, 0, 0, 0, ?)',
          [cfg.table, key, todayISO]
        );
        summary[cfg.table].new++;
      } else if (fieldsDiffer(existing, fields, cfg.fields)) {
        const setClause = cfg.fields.map((f) => `${f} = ?`).join(', ');
        const values = [...cfg.fields.map((f) => fields[f] ?? null), todayISO, key];
        run(`UPDATE ${cfg.table} SET ${setClause}, updated_at = ? WHERE key = ?`, values);
        summary[cfg.table].updated++;
      } else {
        summary[cfg.table].unchanged++;
      }
    }
  }

  await save();
  return summary;
}

export function parseWorkbookFile(arrayBuffer) {
  return XLSX.read(arrayBuffer, { type: 'array' });
}
