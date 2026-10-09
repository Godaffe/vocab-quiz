// Date du jour à l'heure LOCALE de l'appareil (AAAA-MM-JJ) : le « jour » de l'appli change à
// minuit en France, pas à minuit UTC (2 h l'été, 1 h l'hiver) comme avec toISOString().
export function todayISO() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// Bornes UTC [début, fin[ du jour local donné, au format des horodatages stockés
// (new Date().toISOString()) : permet de filtrer last_reviewed_at par jour local.
export function localDayBoundsUTC(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return [new Date(y, m - 1, d).toISOString(), new Date(y, m - 1, d + 1).toISOString()];
}
