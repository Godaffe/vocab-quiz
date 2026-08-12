import { parseWorkbookFile, importFromWorkbook } from './importer.js';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function summaryRowHtml(label, s) {
  if (!s.sheetFound) {
    return `<p><strong>${label}</strong> : feuille introuvable dans le fichier.</p>`;
  }
  const dup = s.duplicateId.length
    ? ` — <span style="color:#dc2626">ID en double ignorés : ${s.duplicateId.join(', ')}</span>`
    : '';
  return `<p><strong>${label}</strong> : ${s.new} nouveau(x), ${s.updated} mis à jour, ${s.unchanged} inchangé(s), ${s.skipped} ligne(s) ignorée(s) (ID/colonnes manquants)${dup}</p>`;
}

export function renderImport(container) {
  container.innerHTML = `
    <h1>Importer le vocabulaire</h1>
    <p>Sélectionne ton fichier Excel (.xlsx). Réimporter est sans risque : le contenu est mis à
    jour mais ta progression de révision n'est jamais effacée.</p>
    <input type="file" id="import-file" accept=".xlsx" />
    <div id="import-summary"></div>
  `;

  const fileInput = container.querySelector('#import-file');
  const summaryEl = container.querySelector('#import-summary');

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;

    summaryEl.innerHTML = '<p>Import en cours…</p>';
    try {
      const buffer = await file.arrayBuffer();
      const workbook = parseWorkbookFile(buffer);
      const summary = await importFromWorkbook(workbook, todayISO());

      summaryEl.innerHTML = [
        summaryRowHtml('Vocabulaire', summary.vocabulaire),
        summaryRowHtml('Grammaire', summary.grammaire),
        summaryRowHtml('Expressions', summary.expressions),
      ].join('');
    } catch (err) {
      summaryEl.innerHTML = `<p style="color:#dc2626">Erreur lors de l'import : ${err.message}</p>`;
    } finally {
      fileInput.value = '';
    }
  });
}
