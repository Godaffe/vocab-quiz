import { parseWorkbookFile, importFromWorkbook, findMissingItems } from './importer.js';
import {
  startSession, checkBase, checkConjugation, finalizeVocabItem, checkAnswer, finalizeItem,
  checkReverse, gradeHardAttempt, articleTest, ARTICLES,
} from './quiz.js';
import { getSetting, setSetting, resetDatabase } from './db.js';
import { exportToFile, importFromFile, daysSince } from './backup.js';
import {
  getAllProgress, advancedPhase, rescuePhase, initialHardPhase, getFailedWordsPool,
  getStreak, getLearnedCount, getInProgressCount, countNewIntroducedToday,
  countReviewedToday, getProgressRow, getLearnedToday, getStartedToday, currentLang, getNewItemsPerDay,
} from './leitner.js';
import {
  escapeHtml, sessionHeaderHtml, barHtml, dotsProgressHtml, cardStackHtml, flipCardHtml, morphCardHtml, choiceCardHtml, typeCardHtml, typeChipHtml, usageRuleHtml, gapCardHtml,
  hintMaskHtml, consequenceHtml, statPillHtml, onSwipe, onCardTap,
  onCardPress, throwCardOut, enterCard, advanceStack, spawnShards,
} from './card.js';
import { icon } from './icons.js';
import {
  parseUsageTests, pickUsageTests, checkGap, checkChoice,
  typeButtons, typeSlots, checkType, checkTypeSlot,
} from './usageTests.js';
import { noteOutcome, noteRelease, takeMoves, forgetMoves, playHomeMoves } from './moves.js';
import { todayISO } from './dates.js';

// Mot à traduire (Voc anglais ou VocAllemand) : mêmes cartes, mêmes règles. Le reste
// (grammaire, expressions) n'existe qu'en anglais.
const isWord = (item) => item.item_type === 'vocabulaire' || item.item_type === 'allemand';
const translateInstruction = () => (currentLang() === 'de' ? 'Traduis en allemand' : 'Traduis en anglais');
const formsInstruction = (item) => (item.item_type === 'allemand' ? 'Präteritum / Partizip II' : 'Passé simple / participe passé');
// Nom allemand : l'article a sa carte, posée juste après la traduction.
const hasArticleTest = (item) => item.item_type === 'allemand' && ARTICLES.includes(item.genre);
const withArticle = (item) => (item.genre ? `${item.genre} ${item.en_base}` : item.en_base);
// Sous le mot : formes d'un verbe fort/irrégulier, ou pluriel irrégulier d'un nom allemand.
function wordExtras(item) {
  if (item.en_past_simple) return `(${item.en_past_simple} / ${item.en_past_participle})`;
  return item.pluriel ? `(Pl. ${item.pluriel})` : '';
}

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

function formatWeekdayFr(date) {
  return WEEKDAYS[date.getDay()];
}

function formatDateFrLong(date) {
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

function wait(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

// Signal de passage, pas une vraie erreur : glisser vers la droite sur une carte question
// abandonne l'item en cours, à n'importe quelle tentative. Il traverse askUntilCorrect /
// runVocabQuestion / runHardModeRound sans que chacun ait à faire suivre un drapeau — la
// boucle de mode (une seule par écran) l'intercepte et enchaîne sur l'item suivant. Le mot
// n'est noté nulle part : il reste exactement où sa dernière notation l'avait laissé.
class ItemSkipped extends Error {}

// --- Accueil ---------------------------------------------------------------

// Recto de la tuile Découverte : l'anneau du jour, actif tant qu'il reste des mots.
function newTileActiveHtml({ introducedToday, dailyBudget, newRemaining }) {
  return `
    <span class="tile-label">${icon('sparkles', { size: 16, color: 'currentColor', stroke: 2.4 })}<span>Découverte</span></span>
    <span class="tile-ring-wrap">
      <span class="tile-ring" id="new-ring">
        <span class="tile-ring-in">
          <span>
            <span class="tile-ring-n">${introducedToday}</span>
            <span class="tile-ring-d">sur ${dailyBudget}</span>
          </span>
        </span>
      </span>
    </span>
    <span class="tile-title">Mots<br>nouveaux</span>
    <span class="tile-meta">${newRemaining} mot${newRemaining > 1 ? 's' : ''} restant${newRemaining > 1 ? 's' : ''} aujourd'hui</span>
  `;
}

// Découverte bouclée : le disque remplace l'anneau, le compte est ce qui a réellement été
// découvert aujourd'hui — pas l'objectif du réglage, qui peut ne pas être atteignable si le
// classeur importé n'a plus assez de mots neufs à proposer.
function newTileDoneHtml({ introducedToday }) {
  return `
    <span class="tile-label">Découverte</span>
    <span class="tile-disc-wrap">
      <span class="tile-disc">
        <span class="tile-disc__n">${introducedToday}</span>
        <span class="tile-disc__d">découverts</span>
      </span>
    </span>
    <span class="tile-title">Mots<br>nouveaux</span>
    <span class="tile-meta">Session bouclée</span>
  `;
}

function reviewTileActiveHtml({ reviewRemaining, reviewedToday, reviewTotal }) {
  return `
    <span class="tile-label">${icon('repeat', { size: 15, color: 'currentColor', stroke: 2.4 })}<span>À réviser</span></span>
    <span class="tile-count"><b>${reviewRemaining}</b><span>mot${reviewRemaining > 1 ? 's' : ''}</span></span>
    <span class="ds-progress"><span class="ds-progress__fill" id="review-fill" style="width:0%"></span></span>
    <span class="tile-meta">${reviewedToday} sur ${reviewTotal} révisé${reviewedToday > 1 ? 's' : ''} aujourd'hui</span>
  `;
}

function reviewTileDoneHtml({ reviewedToday }) {
  return `
    <span class="tile-label">Révision</span>
    <span class="tile-disc-wrap">
      <span class="tile-disc">
        <span class="tile-disc__n">${reviewedToday}</span>
        <span class="tile-disc__d">révisés</span>
      </span>
    </span>
    <span class="tile-meta">Session bouclée</span>
  `;
}

// Compliqués/ratés, actif : aplat pâle, icône de la catégorie en filigrane dans le coin —
// la couleur vive ne sert plus qu'au chiffre. Bouclé : disque plein + coche + statut, à la
// place du grisé désactivé générique, dès que le compte est à zéro n'importe quel jour.
function flatTileHtml({ count, title, glyphName, glyphColor, doneTitle, doneStatus }) {
  if (count === 0) {
    return `
      <span class="tile-check-disc">${icon('check', { size: 15, color: '#fff', stroke: 3.2 })}</span>
      <span>
        <span class="tile-status-title">${doneTitle}</span>
        <span class="tile-status">${doneStatus}</span>
      </span>
    `;
  }
  return `
    <span class="tile-glyph-bg">${icon(glyphName, { size: 52, color: glyphColor, stroke: 2 })}</span>
    <span class="tile-title">${title}</span>
    <span class="tile-count">${count}</span>
  `;
}

// Positions des éclats en % de la boîte de référence (voir radial() dans card.js) : une
// couronne le long des quatre bords, plus denses en haut/bas (où le regard se pose) que sur
// les côtés. `dist`/`len` alternent pour casser la régularité ; `delay` étage le bord du bas
// derrière celui du haut de quelques dizaines de ms.
const STREAK_SHARD_POS = [
  ...[14, 32, 50, 68, 86].map((x, i) => ({ x, y: 0, dist: i % 2 ? 34 : 50, len: i % 2 ? 8 : 11, width: 2.5, delay: 0 })),
  ...[14, 32, 50, 68, 86].map((x, i) => ({ x, y: 100, dist: i % 2 ? 34 : 50, len: i % 2 ? 8 : 11, width: 2.5, delay: 40 })),
  { x: 0, y: 50, dist: 34, len: 9, width: 2.5, delay: 20 },
  { x: 100, y: 50, dist: 34, len: 9, width: 2.5, delay: 20 },
];
const HEADER_SHARD_POS = [
  ...[8, 22, 36, 50, 64, 78, 92].map((x, i) => ({ x, y: 0, dist: i % 2 ? 50 : 82, len: i % 2 ? 11 : 16, width: 3, delay: i % 2 ? 40 : 0 })),
  ...[8, 22, 36, 50, 64, 78, 92].map((x, i) => ({ x, y: 100, dist: i % 2 ? 50 : 82, len: i % 2 ? 11 : 16, width: 3, delay: i % 2 ? 40 : 0 })),
  { x: 0, y: 50, dist: 50, len: 12, width: 3, delay: 60 },
  { x: 100, y: 50, dist: 50, len: 12, width: 3, delay: 60 },
];

// Objectif du jour tout juste atteint, au retour de la séance qui a vidé la dernière file :
// le badge de série éclate seul (or), puis 300 ms plus tard le bloc d'en-tête grossit de 2 %,
// passe au vert et éclate à son tour, avant de se reposer exactement à sa taille d'origine —
// sur le vert, qui y reste. `prefers-reduced-motion` saute directement à l'état posé.
function playDailyGoalBurst(header, badge) {
  if (!header || !badge) return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    header.classList.add('home-header--complete');
    header.classList.remove('home-header--burst');
    return;
  }
  const headerRect = header.getBoundingClientRect();
  const badgeRect = badge.getBoundingClientRect();
  const headerShards = header.querySelector('#header-shards');
  const flash = header.querySelector('.home-header__flash');
  const badgeShards = badge.querySelector('#streak-shards');
  const GOLD = 'var(--gold-400)';
  const GREEN = 'var(--green-500)';

  setTimeout(() => {
    // Le badge de série éclate seul.
    badge.classList.add('ds-streak--pop');
    spawnShards(badgeShards, STREAK_SHARD_POS, GOLD, badgeRect.width, badgeRect.height, 1);
    setTimeout(() => badge.classList.remove('ds-streak--pop'), 160);

    setTimeout(() => {
      // 300 ms plus tard : le bloc entier grossit, vire au vert, éclate à son tour.
      header.classList.add('home-header--complete', 'home-header--swell');
      if (flash) flash.classList.add('home-header__flash--on');
      spawnShards(headerShards, HEADER_SHARD_POS, GREEN, headerRect.width, headerRect.height, 1);
      setTimeout(() => header.classList.remove('home-header--swell'), 180);
      setTimeout(() => flash?.classList.remove('home-header__flash--on'), 140);
    }, 300);
  }, 350);
}

// Les quatre tuiles, décrites une seule fois : leur markup dépend entièrement des chiffres
// qu'on leur passe, si bien que le même descripteur sert à rendre l'accueil d'aujourd'hui
// comme à le rendre tel qu'il était avant la séance, le temps de l'animation des transferts.
const HOME_TILES = {
  new: {
    node: 'start-learning-btn',
    cls: (s) => `tile tile--new${s.newRemaining === 0 ? ' tile--done' : ''}`,
    done: (s) => s.newRemaining === 0,
    html: (s) => (s.newRemaining === 0 ? newTileDoneHtml(s) : newTileActiveHtml(s)),
  },
  review: {
    node: 'start-review-btn',
    cls: (s) => `tile tile--review${s.reviewRemaining === 0 ? ' tile--done' : ''}`,
    done: (s) => s.reviewRemaining === 0,
    html: (s) => (s.reviewRemaining === 0
      ? reviewTileDoneHtml(s)
      : reviewTileActiveHtml({ ...s, reviewTotal: s.reviewedToday + s.reviewRemaining })),
  },
  tricky: {
    node: 'start-hard-btn',
    cls: () => 'tile tile--flat tile--tricky',
    done: (s) => s.hardCount === 0,
    html: (s) => flatTileHtml({
      count: s.hardCount, title: 'Mots<br>compliqués', glyphName: 'brain', glyphColor: 'var(--violet-100)',
      doneTitle: 'Compliqués', doneStatus: 'À jour',
    }),
  },
  failed: {
    node: 'start-failed-btn',
    cls: () => 'tile tile--flat tile--failed',
    done: (s) => s.failedCount === 0,
    html: (s) => flatTileHtml({
      count: s.failedCount, title: 'Mots<br>ratés', glyphName: 'circle-x', glyphColor: 'var(--crimson-100)',
      doneTitle: 'Ratés', doneStatus: 'Aucun',
    }),
  },
};
const TILE_ORDER = ['new', 'review', 'tricky', 'failed'];

// Sections de l'accueil vues par l'animation des déplacements : les quatre tuiles plus les
// deux pastilles du haut. Chacune expose sa boîte (à contracter/gonfler), le nœud qui porte
// son chiffre — différent selon que la tuile est active ou bouclée, absent quand elle est à
// jour — et le champ de l'instantané qui la chiffre.
const SECTION_BOX = {
  new: '#start-learning-btn', review: '#start-review-btn',
  tricky: '#start-hard-btn', failed: '#start-failed-btn',
  learned: '#stat-learned', inprogress: '#stat-inprogress',
};
const SECTION_COUNT = {
  new: '.tile-ring-n, .tile-disc__n', review: '.tile-count b, .tile-disc__n',
  tricky: '.tile-count', failed: '.tile-count',
  learned: '.stat-pill__n', inprogress: '.stat-pill__n',
};
const SECTION_FIELD = {
  new: 'introducedToday', review: 'reviewRemaining',
  tricky: 'hardCount', failed: 'failedCount',
  learned: 'learnedCount', inprogress: 'inProgressCount',
};

function newPctOf(s) {
  return s.dailyBudget > 0 ? Math.min(100, Math.round((s.introducedToday / s.dailyBudget) * 100)) : 0;
}
function reviewPctOf(s) {
  const total = s.reviewedToday + s.reviewRemaining;
  return total > 0 ? Math.round((s.reviewedToday / total) * 100) : 0;
}

function statRowHtml(s) {
  return `
    ${statPillHtml({
      id: 'stat-learned', variant: 'home', side: 'left', value: s.learnedCount,
      delta: s.learnedToday > 0 ? `+${s.learnedToday}` : null,
      deltaColor: 'var(--green-100)', label: 'Mots appris',
      glyph: icon('trophy', { size: 17, color: 'var(--green-100)', stroke: 2.2 }),
    })}
    ${statPillHtml({
      id: 'stat-inprogress', variant: 'home', side: 'right', value: s.inProgressCount,
      delta: s.startedToday > 0 ? `+${s.startedToday}` : null,
      deltaColor: 'var(--copper-100)', label: 'Mots en cours',
      glyph: icon('sprout', { size: 17, color: 'var(--copper-100)', stroke: 2.2 }),
    })}
  `;
}

function homeGridHtml(s) {
  return TILE_ORDER.map((id) => {
    const t = HOME_TILES[id];
    return `<button class="${t.cls(s)}" id="${t.node}" type="button"${t.done(s) ? ' disabled' : ''}>${t.html(s)}</button>`;
  }).join('');
}

function homeHeaderInner(s, now) {
  const streakHtml = `
    <span class="ds-streak${s.burst ? ' ds-streak--burst' : ''}">${icon('flame', { size: 17, color: '#2B1F00', stroke: 2.4 })}<span class="ds-streak__n">${s.streak}</span><span class="ds-streak__u">j</span>${s.burst ? '<span class="eclat-host" id="streak-shards"></span>' : ''}</span>
  `;
  const dayComplete = s.newRemaining === 0 && s.reviewRemaining === 0;
  return dayComplete ? `
    <div class="home-header__row">
      <div class="home-header__dates">
        <span class="home-header__eyebrow">${icon('check', { size: 13, color: '#FAF7EF', stroke: 3.2 })}<span>Journée complète</span></span>
        <span class="home-header__date">${escapeHtml(formatDateFrLong(now))}</span>
      </div>
      ${streakHtml}
    </div>
    <div class="home-header__next">${icon('clock', { size: 15, color: '#FDFBF5', stroke: 2.3 })}<span>Prochaine session demain</span></div>
  ` : `
    <div class="home-header__row">
      <div class="home-header__dates">
        <span class="home-header__eyebrow">${escapeHtml(formatWeekdayFr(now))}</span>
        <span class="home-header__date">${escapeHtml(formatDateFrLong(now))}</span>
      </div>
      ${streakHtml}
    </div>
  `;
}

// Instantané des chiffres du dernier rendu de l'accueil : c'est le point de départ de
// l'animation des déplacements au retour de séance. En mémoire vive comme le journal de
// moves.js — sans lui (première ouverture, rechargement), l'accueil s'affiche directement à
// ses valeurs du moment, sans rien rejouer.
let lastHomeStats = null;

export async function renderHome(container, { onStartHard, onStartLearning, onStartReview, onStartFailedWords, celebrate = false }) {
  container.innerHTML = '<div class="loading-block"><span class="ds-spinner"></span><div class="loading-msg">Chargement de la session</div></div>';
  const today = todayISO();
  const session = await startSession();
  const failedWords = getFailedWordsPool();
  const now = new Date();

  // Le dénominateur de la révision est ce qui a réellement été noté aujourd'hui plus ce qu'il
  // reste : jamais un total inventé.
  const stats = {
    streak: getStreak(today),
    learnedCount: getLearnedCount(),
    inProgressCount: getInProgressCount(),
    learnedToday: getLearnedToday(today),
    startedToday: getStartedToday(today),
    dailyBudget: getNewItemsPerDay(),
    introducedToday: countNewIntroducedToday(today),
    newRemaining: session.newItems.length,
    reviewRemaining: session.reviewItems.length,
    reviewedToday: countReviewedToday(today),
    hardCount: session.hardItems.length,
    failedCount: failedWords.length,
    burst: false,
  };

  // La journée n'est « complète » que si les deux files sont vides — jamais entre les deux,
  // et jamais gardé en mémoire d'une visite à l'autre : recalculé à chaque rendu de l'accueil.
  // L'éclat ne joue qu'à l'instant précis où elle bascule en complète (retour de la séance qui
  // vient de vider la dernière file) — jamais sur une simple revisite d'un jour déjà bouclé.
  stats.burst = celebrate && stats.newRemaining === 0 && stats.reviewRemaining === 0;

  // Déplacements de mots à rejouer : ceux notés depuis le dernier passage ici, quel que soit
  // le chemin de retour (bilan, croix d'abandon, onglet du bas). Sans instantané d'avant, ou
  // en mouvement réduit, on ne rejoue rien et l'accueil s'ouvre déjà à jour.
  const prev = lastHomeStats;
  const moves = takeMoves();
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const animating = !!prev && moves.length > 0 && !reduced;
  if (!animating) forgetMoves();
  // Pendant l'animation, l'accueil s'ouvre sur les chiffres d'avant la séance ; `shown` suit
  // ce qui est réellement affiché à l'écran et rejoint `stats` au fil des arrivées.
  const shown = animating ? { ...prev, streak: stats.streak, burst: false } : { ...stats };
  lastHomeStats = { ...stats, burst: false };

  const lang = currentLang();
  container.innerHTML = `
    <div class="home-header" id="home-header"></div>
    <div class="screen-scroll">
      <div class="lang-switch" role="group" aria-label="Langue">
        <button type="button" class="lang-switch__opt${lang === 'en' ? ' lang-switch__opt--on' : ''}" data-lang="en" aria-pressed="${lang === 'en'}">Anglais</button>
        <button type="button" class="lang-switch__opt${lang === 'de' ? ' lang-switch__opt--on' : ''}" data-lang="de" aria-pressed="${lang === 'de'}">Allemand</button>
      </div>
      <div class="stat-row" id="stat-row"></div>
      <div class="home-grid" id="home-grid"></div>
    </div>
  `;

  // Changer de langue recharge l'accueil sur l'autre progression, sans rien rejouer : les
  // chiffres d'avant appartiennent à l'autre langue.
  container.querySelectorAll('.lang-switch__opt').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.lang === lang) return;
      await setSetting('langue', btn.dataset.lang);
      lastHomeStats = null;
      forgetMoves();
      renderHome(container, { onStartHard, onStartLearning, onStartReview, onStartFailedWords });
    });
  });

  const paintHeader = (s) => {
    const header = container.querySelector('#home-header');
    const dayComplete = s.newRemaining === 0 && s.reviewRemaining === 0;
    // En temps normal, la classe --complete est posée dès le rendu. En éclat, elle est retenue
    // (le bandeau reste sur --stone-500) jusqu'à ce que playDailyGoalBurst l'ajoute au bon
    // instant — c'est elle qui fait basculer la couleur, pas ce rendu.
    header.className = `home-header${s.burst ? ' home-header--burst' : dayComplete ? ' home-header--complete' : ''}`;
    header.innerHTML = homeHeaderInner(s, now)
      + (s.burst ? '<span class="home-header__flash"></span><span class="eclat-host" id="header-shards"></span>' : '');
  };

  const paintTile = (id, s, { swap = false } = {}) => {
    const t = HOME_TILES[id];
    const el = container.querySelector(`#${t.node}`);
    if (!el) return;
    el.className = t.cls(s);
    el.disabled = t.done(s);
    el.innerHTML = t.html(s);
    if (swap) {
      el.classList.add('mv-swap-in');
      setTimeout(() => el.classList.remove('mv-swap-in'), 300);
    }
  };

  // L'anneau et la barre partent de zéro puis se remplissent : le mouvement dit la part déjà
  // faite, il ne décore pas. requestAnimationFrame ne se déclenche pas sur une page masquée —
  // le minuteur reprend la main pour que la valeur finisse toujours par être la bonne, animée
  // ou non. Absents une fois la tuile bouclée (plus d'anneau ni de barre).
  // `instant` : à la fin de la chorégraphie, l'anneau et la barre sont déjà à leur valeur —
  // les reposer avec leur transition les ferait repartir de zéro une seconde fois.
  const paintProgress = (s, instant = false) => {
    const ring = container.querySelector('#new-ring');
    const fill = container.querySelector('#review-fill');
    if (instant) {
      if (ring) ring.style.transition = 'none';
      if (fill) fill.style.transition = 'none';
    }
    ring?.style.setProperty('--pct', String(newPctOf(s)));
    if (fill) fill.style.width = `${reviewPctOf(s)}%`;
    if (instant) {
      void (ring ?? fill ?? container).offsetWidth;
      if (ring) ring.style.transition = '';
      if (fill) fill.style.transition = '';
    }
  };

  const paintBoard = (s, { instant = false } = {}) => {
    container.querySelector('#stat-row').innerHTML = statRowHtml(s);
    container.querySelector('#home-grid').innerHTML = homeGridHtml(s);
    if (instant) { paintProgress(s, true); return; }
    let painted = false;
    const once = () => { if (!painted) { painted = true; paintProgress(s); } };
    requestAnimationFrame(once);
    setTimeout(once, 250);
  };

  // La tuile touchée devient l'écran de session (voir growFromRect dans main.js) : son
  // rectangle est capturé au moment du tap, avant qu'elle ne disparaisse du DOM. Posés
  // seulement une fois l'accueil à son état final — pendant l'animation, il montre encore
  // des chiffres d'avant, sur lesquels on ne veut pas pouvoir lancer une séance.
  const attachTileHandlers = () => {
    const bind = (node, fn) => {
      const tile = container.querySelector(`#${node}`);
      if (tile && !tile.disabled) tile.addEventListener('click', () => fn(tile.getBoundingClientRect()));
    };
    bind('start-hard-btn', (rect) => onStartHard(session, rect));
    bind('start-learning-btn', (rect) => onStartLearning(session, rect));
    bind('start-review-btn', (rect) => onStartReview(session, rect));
    bind('start-failed-btn', (rect) => onStartFailedWords(failedWords, rect));
  };

  paintHeader(shown);
  paintBoard(shown);

  if (!animating) {
    if (stats.burst) playDailyGoalBurst(container.querySelector('#home-header'), container.querySelector('.ds-streak'));
    attachTileHandlers();
    return;
  }

  const countEl = (id) => container.querySelector(SECTION_BOX[id])?.querySelector(SECTION_COUNT[id]) ?? null;
  const fromPct = { new: newPctOf(shown), review: reviewPctOf(shown) };
  const toPct = { new: newPctOf(stats), review: reviewPctOf(stats) };
  const lerpPct = (id, p) => fromPct[id] + (toPct[id] - fromPct[id]) * p;

  await playHomeMoves(moves, {
    el: (id) => container.querySelector(SECTION_BOX[id]),
    point: (id) => {
      const box = container.querySelector(SECTION_BOX[id]);
      if (!box) return null;
      const rect = (countEl(id) ?? box).getBoundingClientRect();
      if (!rect.width && !rect.height) return null;
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    },
    values: Object.fromEntries(Object.entries(SECTION_FIELD)
      .map(([id, field]) => [id, { from: shown[field], to: stats[field] }])),
    setValue: (id, value, p) => {
      shown[SECTION_FIELD[id]] = value;
      // Compliqués / ratés : la tuile « à jour » se retourne en tuile chiffrée à l'instant de
      // la première arrivée — le chiffre naît avec elle, plutôt que d'attendre à 0 sous une
      // coche qui n'est déjà plus vraie.
      if ((id === 'tricky' || id === 'failed') && value > 0 && !countEl(id)) paintTile(id, shown, { swap: true });
      const el = countEl(id);
      if (el) {
        el.textContent = String(value);
        el.classList.remove('mv-count');
        void el.offsetWidth;
        el.classList.add('mv-count');
      }
      if (id === 'new') container.querySelector('#new-ring')?.style.setProperty('--pct', String(Math.round(lerpPct('new', p))));
      if (id === 'review') {
        const fill = container.querySelector('#review-fill');
        if (fill) fill.style.width = `${lerpPct('review', p)}%`;
      }
    },
    // Fin de la chorégraphie (ou tap qui l'abrège) : l'accueil est reposé en entier à son état
    // réel. Les tuiles qui changent d'état (bouclée <-> active) sont les seules à bouger
    // visiblement ici, les chiffres ayant déjà rejoint leur valeur finale.
    finalize: () => {
      // Comparé à ce qui est réellement rendu, pas aux chiffres suivis : une tuile dont le
      // compte est déjà tombé à zéro pendant les vols porte encore son visage actif, et c'est
      // bien elle qui doit se retourner ici.
      const swaps = TILE_ORDER.filter((id) => {
        const el = container.querySelector(`#${HOME_TILES[id].node}`);
        return !!el && el.disabled !== HOME_TILES[id].done(stats);
      });
      paintHeader(stats);
      paintBoard(stats, { instant: true });
      swaps.forEach((id) => {
        const el = container.querySelector(`#${HOME_TILES[id].node}`);
        el?.classList.add('mv-swap-in');
        setTimeout(() => el?.classList.remove('mv-swap-in'), 300);
      });
    },
  });

  // L'éclat de la journée complète couronne la séquence : il ne part qu'une fois tous les
  // mots arrivés à destination.
  if (stats.burst) playDailyGoalBurst(container.querySelector('#home-header'), container.querySelector('.ds-streak'));
  attachTileHandlers();
}

// --- Coque de session ------------------------------------------------------

// Barre du haut (quitter + compteur + emplacement droit) puis la barre de progression,
// puis la zone de carte, qui occupe toute la hauteur restante — c'est ce qui pousse le
// bouton d'action en bas de l'écran. La nav du bas est masquée le temps de la session
// (classe sur <body>), retirée par les routes de main.js, par où passent toutes les sorties.
// `useDots` bascule la ligne de progression en points colorés (un par question, voir
// dotsProgressHtml) — réservé aux sessions d'au plus 20 questions, la barre classique restant
// plus lisible au-delà. La phase 'discover' garde toujours la barre rayée : rien n'y est encore
// réussi ni raté, un point n'y aurait rien à montrer.
function renderModeShell(container, onExit, { total = 0, useDots = false } = {}) {
  container.innerHTML = `
    <div class="mode-shell">
      ${sessionHeaderHtml()}
      <div id="question-area"></div>
    </div>
  `;
  container.querySelector('#exit-btn').addEventListener('click', onExit);

  const counter = container.querySelector('#mode-counter');
  const right = container.querySelector('#mode-right');
  const slot = container.querySelector('#progress-slot');
  // `null` = pas encore atteint, `true`/`false` = résultat de la 1ère tentative — un mot raté
  // puis corrigé à la redemande reste rouge, seule la 1ère tentative compte pour la note Leitner.
  const results = new Array(total).fill(null);

  const setProgress = (index, total, { phase = 'quiz', badge = '' } = {}) => {
    counter.textContent = total > 0 ? `${index + 1} / ${total}` : '';
    right.innerHTML = badge;
    slot.innerHTML = useDots && phase !== 'discover'
      ? dotsProgressHtml(total, results, index)
      : barHtml(index, total, phase);
  };
  const markResult = (idx, correct) => { results[idx] = correct; };

  return { area: container.querySelector('#question-area'), setProgress, markResult };
}

// --- Bilan de session ------------------------------------------------------

function newTally(kind) {
  return {
    kind,
    started: Date.now(),
    answered: 0,
    correct: 0,
    wrong: 0,
    learned: 0,
    levelUp: 0,
    requeued: 0,
    enteredHard: 0,
    exitedHard: 0,
    phasesCleared: 0,
    // Mots compliqués uniquement : nombre de mots distincts engagés dans la séance (posé une
    // fois pour toutes par renderHardMode — tally.answered y compte des tentatives de phase,
    // pas des mots), pour que le bilan puisse rapporter « sauvés sur total engagé ».
    totalItems: 0,
    nextDates: [],
  };
}

// Compare l'état Leitner de l'item avant et après notation : le bilan rapporte ce qui a
// réellement bougé en base, il ne rejoue pas les règles de son côté.
function recordOutcome(tally, before, after, firstCorrect) {
  tally.answered += 1;
  if (firstCorrect) tally.correct += 1;
  else tally.wrong += 1;
  if (after && before && after.is_learned && !before.is_learned) tally.learned += 1;
  if (after && before && after.box_level > before.box_level) tally.levelUp += 1;
  if (after && after.requeue_date && after.requeue_date !== before?.requeue_date) tally.requeued += 1;
  // Bascule dans le mode compliqué à l'instant même de cette notation (3 échecs consécutifs) —
  // distinct d'une simple reprogrammation, pour que le bilan de révision puisse isoler ce qui
  // part en mode compliqué de ce qui redescend juste d'un niveau.
  if (after && after.learning_process === 'hard' && (!before || before.learning_process !== 'hard')) tally.enteredHard += 1;
  if (after && after.next_review_date) tally.nextDates.push(after.next_review_date);
  // Même comparaison, mais du point de vue des sections de l'accueil : ce que ce mot vient de
  // quitter et ce qu'il vient de rejoindre. Consommé au retour à l'accueil (voir moves.js).
  noteOutcome(tally.kind, before, after);
}

// --- Écrans de carte -------------------------------------------------------

// Découverte : le mot au recto, la traduction au verso. Tap ou glissement horizontal pour
// retourner (480 ms, la seule animation longue du système), glissement vers le haut pour
// passer au suivant. Le bouton du bas reste le chemin fiable quand le geste n'est pas
// disponible (souris, clavier).
function discoverCard(area, { word, pos, example, translation, registre, sens, usage, region, remaining }) {
  return new Promise((resolve) => {
    area.innerHTML = `
      <div class="session-body">
        ${cardStackHtml(remaining, flipCardHtml({ word, pos, example, translation, registre, sens, usage, region, foot: 'Toucher ou glisser pour retourner' }))}
      </div>
      <div class="session-foot">
        <button type="button" class="ds-btn ds-btn--hero ds-btn--secondary" id="next-btn">Mot suivant</button>
        <p class="session-note">Glisse vers le haut pour passer au mot suivant</p>
      </div>
    `;
    const card = area.querySelector('#flip-card');
    const zone = area.querySelector('.session-body');
    // Le sens du retournement suit le geste : le côté touché pour un tap, le sens du
    // glissement pour un swipe — jamais un sens fixe. `dir` (1 ou -1) ne change que le chemin
    // de la rotation (voir --flip-dir dans style.css) ; la face retournée est la même dans
    // les deux cas. `1` = comme si on tournait la carte par sa gauche (déjà le sens d'origine,
    // conservé pour un tap côté gauche ou un glissement vers la gauche).
    const flip = (dir) => {
      card.style.setProperty('--flip-dir', String(dir));
      card.classList.toggle('ds-flip--back');
    };
    // Le clic « click » qui suit un tap tactile (touch-action: none impose ce détour) remonte
    // souvent avec un clientX à 0 — un bug connu des navigateurs mobiles, pas une vraie position
    // au centre de l'écran. On capte donc la position réelle du doigt dès le pointerdown (fiable
    // dans tous les cas, tactile ou souris), et on ne retombe sur le clic lui-même que si aucun
    // pointerdown n'a été vu avant (clic déclenché par un autre moyen, ex. programmatique).
    let tapX = null;
    card.addEventListener('pointerdown', (e) => { tapX = e.clientX; });
    const flipFromTap = (e) => {
      const rect = card.getBoundingClientRect();
      const clientX = typeof tapX === 'number' && tapX !== 0 ? tapX : e.clientX;
      const x = typeof clientX === 'number' && clientX !== 0 ? clientX : rect.left + rect.width / 2;
      flip(x - rect.left < rect.width / 2 ? 1 : -1);
    };

    // Entrée de la carte (remonte de 14px) et inclinaison à la prise — l'anticipation courte
    // qui annonce le retournement ou le passage avant même que le geste soit achevé.
    enterCard(card);
    onCardPress(zone, card);

    // `leaving` garde la sortie unique : pendant les 220 ms d'animation, un second geste (ou un
    // second clic sur le bouton) ne doit ni relancer l'animation ni tenir la promesse deux fois.
    let leaving = false;
    const next = () => {
      if (leaving) return;
      leaving = true;
      throwCardOut(card).then(resolve);
    };

    // Le glissement (haut ou latéral) couvre toute la zone entre l'en-tête et le bouton, pas
    // seulement la carte — plus simple à déclencher au pouce sans viser précisément la carte.
    // Le tap pour retourner reste, lui, propre à la carte.
    onSwipe(zone, { onLeft: () => flip(1), onRight: () => flip(-1), onUp: next });
    onCardTap(card, flipFromTap);
    area.querySelector('#next-btn').addEventListener('click', next);

    // Carte plus haute que l'écran (sens et usage longs, petit téléphone) : on resserre d'abord
    // l'espace au-dessus du mot (--tall) ; si ça ne suffit pas, seul cas où le doigt doit
    // pouvoir faire défiler la zone (--scroll), sinon le bas de la carte serait inaccessible.
    const overflows = () => zone.scrollHeight > zone.clientHeight + 1;
    const fitScroll = () => {
      zone.classList.remove('session-body--tall');
      zone.classList.toggle('session-body--tall', overflows());
      zone.classList.toggle('session-body--scroll', overflows());
    };
    requestAnimationFrame(fitScroll);
    new ResizeObserver(fitScroll).observe(zone);
  });
}

// Carte à fusion : la carte de question devient la carte de résultat sans être remplacée
// (voir le commentaire de bloc CSS « carte à fusion » dans style.css). Champ auto-focus,
// validation à la touche Entrée ou au bouton. Glisser la carte vers la droite (ou le bouton
// « Passer ») abandonne la question sans la noter — le mot n'avance ni ne recule. `getConsequence`
// (peut être async — elle est attendue) calcule la conséquence Leitner à partir de la réponse
// et du verdict, une fois connus.
function morphCard(area, {
  instruction, question, hint, badge, retry = false, retryLabel, remaining = 0, checkFn,
  answer: expected, pos, translation, example, registre, sens, usage, sensHint, getConsequence,
  questionRegion, answerRegion, promptRegion, questionSentence = false,
}) {
  return new Promise((resolve) => {
    const card = morphCardHtml({
      instruction, question, badge, retry, retryLabel, hint: hint || '',
      answer: expected, pos, translation, example, registre, sens, usage, sensHint: sensHint || '',
      questionRegion: questionRegion || '', answerRegion: answerRegion || '', promptRegion: promptRegion || '',
      questionSentence,
    });
    area.innerHTML = `
      <div class="session-body">
        ${remaining > 0 ? cardStackHtml(remaining, card) : card}
      </div>
      <div class="session-foot" id="mode-foot">
        <button type="button" class="ds-btn ds-btn--hero" id="submit-btn">
          <span class="ds-btn__label ds-btn__label--q">Valider</span>
          <span class="ds-btn__label ds-btn__label--a" id="submit-label-a">Suivant</span>
        </button>
        <button type="button" class="ds-btn ds-btn--hero ds-btn--ghost" id="skip-btn">Passer</button>
      </div>
    `;

    const root = area.querySelector('#morph-card');
    const input = area.querySelector('#answer-input');
    const typed = area.querySelector('#m-typed');
    const label = area.querySelector('#m-label');
    const disc = area.querySelector('#m-disc');
    const fdisc = area.querySelector('#m-fdisc');
    const submitBtn = area.querySelector('#submit-btn');
    const submitLabelA = area.querySelector('#submit-label-a');
    const skipBtn = area.querySelector('#skip-btn');
    const foot = area.querySelector('#mode-foot');
    let settled = false;
    let answered = false;
    let lastAnswer = '';
    let lastCorrect = false;

    const skip = () => {
      if (settled) return;
      settled = true;
      resolve({ skipped: true });
    };

    const submit = async () => {
      if (settled) return;
      settled = true;
      const raw = input.value;
      const isCorrect = checkFn(raw);
      lastAnswer = raw;
      lastCorrect = isCorrect;
      const verdictIcon = icon(isCorrect ? 'check' : 'x', { size: 13, color: '#fff', stroke: 3.4 });
      const verdictIconSm = icon(isCorrect ? 'check' : 'x', { size: 18, color: '#fff', stroke: 3.4 });
      const consequence = getConsequence ? await getConsequence(raw, isCorrect) : null;

      typed.textContent = raw;
      disc.innerHTML = verdictIcon;
      fdisc.innerHTML = verdictIconSm;
      input.disabled = true;
      label.textContent = isCorrect ? 'Correct' : 'Réponse attendue';
      // Le bouton reste cuivre même sur un échec (comme la maquette) : « Réessayer » n'est pas
      // un second refus, c'est la reprise volontaire de la même question.
      submitLabelA.textContent = isCorrect ? 'Suivant' : 'Réessayer';

      // Un seul basculement d'état porte tout le dépli, en trois temps (voir le commentaire de
      // bloc « carte à fusion » dans style.css) : teinte immédiate, forme (90-260ms), contenu
      // (240-430ms) — rien n'attend ici entre les étapes, le CSS choréographie tout le décalage.
      root.classList.add(
        'ds-morph--committed', isCorrect ? 'ds-morph--correct' : 'ds-morph--wrong',
        'ds-morph--tinted', 'ds-morph--morphed', 'ds-morph--unfolded',
      );
      if (!isCorrect) root.classList.add('ds-morph--struck');
      answered = true;
      foot.classList.add('session-foot--answered');

      // La conséquence Leitner n'apparaît qu'une fois le dépli installé (430ms), pas dès la
      // réponse — 450ms laisse un souffle court après la fin de l'étape « contenu ».
      if (consequence) {
        await wait(450);
        const consequenceHtmlBlock = typeof consequence === 'string'
          ? `<div class="ds-alert ds-alert--success">${escapeHtml(consequence)}</div>`
          : consequenceHtml(consequence);
        area.querySelector('.session-body').insertAdjacentHTML('beforeend', consequenceHtmlBlock);
      }
    };

    const finish = () => resolve({ answer: lastAnswer, isCorrect: lastCorrect });
    // Une fois répondu, le même bouton (relibellé Suivant/Réessayer) fait continuer ; un clic
    // n'importe où sur la carte le fait tout autant, plus besoin de viser le bouton.
    submitBtn.addEventListener('click', () => (answered ? finish() : submit()));
    onCardTap(root, () => { if (answered) finish(); });
    skipBtn.addEventListener('click', skip);
    // Le glissement latéral pour passer fonctionne sur toute la zone entre l'en-tête et les
    // boutons, pas seulement la carte de question — le champ de saisie garde son geste natif
    // (voir onSwipe, qui ignore un glissement démarré dans un input).
    onSwipe(area.querySelector('.session-body'), { onRight: skip });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    // Le clavier s'ouvre par défaut dès que la question s'affiche, sans avoir à taper le champ
    // au préalable. L'appel reste synchrone (pas de rAF/setTimeout) : iOS n'ouvre le clavier
    // sur un focus() programmatique que s'il est rattaché sans détour au geste utilisateur qui
    // vient de faire apparaître cette carte (clic, tap, relâchement de glissement). preventScroll
    // évite que la mise au point ne déclenche un scroll natif — déjà bloqué par ailleurs via
    // touch-action:none sur la zone de session, mais la souris/le clavier physique y échappent.
    input.focus({ preventScroll: true });
  });
}

// Carte de placement (tests d'usage) : même contrat que morphCard — se résout sur
// { isCorrect } une fois la correction vue (ou { skipped: true }), et `getConsequence(isCorrect)`
// (attendue, peut être async) fournit la conséquence affichée sous la carte. Pas de deuxième
// tentative : avec les bonnes phrases déjà colorées, recocher ne serait qu'une formalité.
function choiceCard(area, { word, test, rule, badge, retry = false, remaining = 0, getConsequence, prompt, help, shuffle = true }) {
  return new Promise((resolve) => {
    // Ordre mélangé à chaque affichage : la bonne phrase ne tombe pas toujours au même rang.
    // Les articles gardent leur ordre habituel der / die / das.
    const order = test.options.map((_, i) => i);
    if (shuffle) order.sort(() => Math.random() - 0.5);
    const shown = order.map((i) => test.options[i]);
    const card = choiceCardHtml({ word, options: shown, badge, retry, rule, prompt, help });
    area.innerHTML = `
      <div class="session-body">
        ${remaining > 0 ? cardStackHtml(remaining, card) : card}
      </div>
      <div class="session-foot" id="mode-foot">
        <button type="button" class="ds-btn ds-btn--hero" id="submit-btn">Valider</button>
        <button type="button" class="ds-btn ds-btn--hero ds-btn--ghost" id="skip-btn">Passer</button>
      </div>
    `;

    const root = area.querySelector('#choice-card');
    const optionEls = [...root.querySelectorAll('.ds-choice__opt')];
    const submitBtn = area.querySelector('#submit-btn');
    const skipBtn = area.querySelector('#skip-btn');
    const foot = area.querySelector('#mode-foot');
    const selected = new Set();
    let settled = false;
    let answered = false;
    let lastCorrect = false;

    for (const el of optionEls) {
      el.addEventListener('click', () => {
        if (settled) return;
        const i = Number(el.dataset.i);
        if (selected.has(i)) selected.delete(i);
        else selected.add(i);
        el.classList.toggle('ds-choice__opt--on', selected.has(i));
        el.setAttribute('aria-pressed', String(selected.has(i)));
      });
    }

    const skip = () => {
      if (settled) return;
      settled = true;
      resolve({ skipped: true });
    };

    const submit = async () => {
      if (settled) return;
      settled = true;
      // Les indices cochés portent sur l'ordre affiché : on les ramène à l'ordre du test.
      const isCorrect = checkChoice(test, [...selected].map((i) => order[i]));
      lastCorrect = isCorrect;
      const consequence = getConsequence ? await getConsequence(isCorrect) : null;

      optionEls.forEach((el, i) => {
        const right = shown[i].correct;
        const picked = selected.has(i);
        el.disabled = true;
        if (right && picked) el.classList.add('ds-choice__opt--right');
        else if (right) el.classList.add('ds-choice__opt--missed');
        else if (picked) el.classList.add('ds-choice__opt--wrong');
      });
      root.classList.add(isCorrect ? 'ds-choice--correct' : 'ds-choice--wrong');
      const ruleEl = root.querySelector('.ds-choice__rule');
      if (ruleEl && !isCorrect) ruleEl.hidden = false;
      submitBtn.textContent = 'Suivant';
      answered = true;
      foot.classList.add('session-foot--answered');

      if (consequence) {
        await wait(450);
        const consequenceHtmlBlock = typeof consequence === 'string'
          ? `<div class="ds-alert ds-alert--success">${escapeHtml(consequence)}</div>`
          : consequenceHtml(consequence);
        area.querySelector('.session-body').insertAdjacentHTML('beforeend', consequenceHtmlBlock);
      }
    };

    submitBtn.addEventListener('click', () => (answered ? resolve({ isCorrect: lastCorrect }) : submit()));
    skipBtn.addEventListener('click', skip);
    onSwipe(area.querySelector('.session-body'), { onRight: skip });
  });
}

// Carte type de mot : une case active à la fois (la première au départ, puis celle qu'on
// touche) ; un bouton ajoute ou retire son type dans la case active. « Valider » s'allume
// quand chaque case a au moins un type. Corrigé case par case, et la règle d'usage si la carte
// est ratée et que c'est la dernière question du mot.
function typeCard(area, { test, rule, badge, retry = false, remaining = 0, getConsequence }) {
  return new Promise((resolve) => {
    const expected = typeSlots(test);
    const card = typeCardHtml({ parts: test.parts, buttons: typeButtons(test), badge, retry, rule });
    area.innerHTML = `
      <div class="session-body">
        ${remaining > 0 ? cardStackHtml(remaining, card) : card}
      </div>
      <div class="session-foot" id="mode-foot">
        <button type="button" class="ds-btn ds-btn--hero" id="submit-btn" disabled>Valider</button>
        <button type="button" class="ds-btn ds-btn--hero ds-btn--ghost" id="skip-btn">Passer</button>
      </div>
    `;

    const root = area.querySelector('#type-card');
    const slotEls = [...root.querySelectorAll('.ds-type__slot')];
    const buttonEls = [...root.querySelectorAll('.ds-type__btn')];
    const submitBtn = area.querySelector('#submit-btn');
    const skipBtn = area.querySelector('#skip-btn');
    const foot = area.querySelector('#mode-foot');
    const filled = expected.map(() => []);
    let active = 0;
    let settled = false;
    let answered = false;
    let lastCorrect = false;

    const render = () => {
      slotEls.forEach((el, i) => {
        el.classList.toggle('ds-type__slot--active', i === active);
        el.setAttribute('aria-pressed', String(i === active));
        el.querySelector('.ds-type__chips').innerHTML = filled[i].map((t) => typeChipHtml(t)).join('');
      });
      for (const el of buttonEls) {
        const on = filled[active].includes(el.dataset.t);
        el.classList.toggle('ds-type__btn--on', on);
        el.setAttribute('aria-pressed', String(on));
      }
      submitBtn.disabled = filled.some((slot) => slot.length === 0);
    };

    slotEls.forEach((el, i) => el.addEventListener('click', () => {
      if (settled) return;
      active = i;
      render();
    }));
    for (const el of buttonEls) {
      el.addEventListener('click', () => {
        if (settled) return;
        const slot = filled[active];
        const at = slot.indexOf(el.dataset.t);
        if (at >= 0) slot.splice(at, 1);
        else slot.push(el.dataset.t);
        render();
      });
    }

    const skip = () => {
      if (settled) return;
      settled = true;
      resolve({ skipped: true });
    };

    const submit = async () => {
      if (settled) return;
      settled = true;
      const isCorrect = checkType(test, filled);
      lastCorrect = isCorrect;
      const consequence = getConsequence ? await getConsequence(isCorrect) : null;

      // Case juste : ses types en vert. Case fausse : types en trop barrés, types oubliés en
      // pointillé vert — même code que la carte de placement.
      slotEls.forEach((el, i) => {
        const right = checkTypeSlot(expected[i], filled[i]);
        el.disabled = true;
        el.classList.remove('ds-type__slot--active');
        el.classList.add(right ? 'ds-type__slot--right' : 'ds-type__slot--wrong');
        const chips = filled[i].map((t) => typeChipHtml(t, expected[i].includes(t) ? 'right' : 'wrong'))
          .concat(expected[i].filter((t) => !filled[i].includes(t)).map((t) => typeChipHtml(t, 'missed')));
        el.querySelector('.ds-type__chips').innerHTML = chips.join('');
      });
      for (const el of buttonEls) {
        el.disabled = true;
        el.classList.remove('ds-type__btn--on');
      }
      root.classList.add(isCorrect ? 'ds-choice--correct' : 'ds-choice--wrong');
      const ruleEl = root.querySelector('.ds-choice__rule');
      if (ruleEl && !isCorrect) ruleEl.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Suivant';
      answered = true;
      foot.classList.add('session-foot--answered');

      if (consequence) {
        await wait(450);
        const consequenceHtmlBlock = typeof consequence === 'string'
          ? `<div class="ds-alert ds-alert--success">${escapeHtml(consequence)}</div>`
          : consequenceHtml(consequence);
        area.querySelector('.session-body').insertAdjacentHTML('beforeend', consequenceHtmlBlock);
      }
    };

    submitBtn.addEventListener('click', () => (answered ? resolve({ isCorrect: lastCorrect }) : submit()));
    skipBtn.addEventListener('click', skip);
    onSwipe(area.querySelector('.session-body'), { onRight: skip });
  });
}

// Carte phrase à trous (tests d'usage) : une tentative, corrigée sur la même vue — le trou
// laisse place à la réponse dans la phrase (en vert si juste, sinon la saisie barrée suivie de
// la bonne réponse), avec la règle d'usage si `rule` est fourni et que la réponse est fausse.
// Se résout sur { answer, isCorrect } ou { skipped: true }, comme morphCard.
function gapCard(area, { test, rule = '', badge, label, retry = false, remaining = 0, getConsequence }) {
  return new Promise((resolve) => {
    const card = gapCardHtml({ before: test.before, after: test.after, hint: test.hint, badge, label, retry, rule });
    area.innerHTML = `
      <div class="session-body">
        ${remaining > 0 ? cardStackHtml(remaining, card) : card}
      </div>
      <div class="session-foot" id="mode-foot">
        <button type="button" class="ds-btn ds-btn--hero" id="submit-btn">Valider</button>
        <button type="button" class="ds-btn ds-btn--hero ds-btn--ghost" id="skip-btn">Passer</button>
      </div>
    `;

    const root = area.querySelector('#gap-card');
    const input = area.querySelector('#answer-input');
    const slot = area.querySelector('#gap-slot');
    const submitBtn = area.querySelector('#submit-btn');
    const skipBtn = area.querySelector('#skip-btn');
    const foot = area.querySelector('#mode-foot');
    let settled = false;
    let answered = false;
    let lastAnswer = '';
    let lastCorrect = false;

    const skip = () => {
      if (settled) return;
      settled = true;
      resolve({ skipped: true });
    };

    const submit = async () => {
      if (settled) return;
      settled = true;
      const raw = input.value;
      const isCorrect = checkGap(test, raw);
      lastAnswer = raw;
      lastCorrect = isCorrect;
      const consequence = getConsequence ? await getConsequence(raw, isCorrect) : null;

      const typed = raw.trim();
      slot.innerHTML = isCorrect
        ? `<span class="ds-gap__right">${escapeHtml(typed)}</span>`
        : `${typed ? `<span class="ds-gap__wrong">${escapeHtml(typed)}</span> ` : ''}<span class="ds-gap__right">${escapeHtml(test.answers[0])}</span>`;
      slot.classList.add('ds-gap__slot--done');
      input.blur();
      root.querySelector('.ds-gap__field').hidden = true;
      root.classList.add(isCorrect ? 'ds-choice--correct' : 'ds-choice--wrong');
      const ruleEl = root.querySelector('.ds-choice__rule');
      if (ruleEl && !isCorrect) ruleEl.hidden = false;
      submitBtn.textContent = 'Suivant';
      answered = true;
      foot.classList.add('session-foot--answered');

      if (consequence) {
        await wait(450);
        const consequenceHtmlBlock = typeof consequence === 'string'
          ? `<div class="ds-alert ds-alert--success">${escapeHtml(consequence)}</div>`
          : consequenceHtml(consequence);
        area.querySelector('.session-body').insertAdjacentHTML('beforeend', consequenceHtmlBlock);
      }
    };

    const finish = () => resolve({ answer: lastAnswer, isCorrect: lastCorrect });
    submitBtn.addEventListener('click', () => (answered ? finish() : submit()));
    skipBtn.addEventListener('click', skip);
    onSwipe(area.querySelector('.session-body'), { onRight: skip });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    input.focus({ preventScroll: true });
  });
}

// Carte réponse complète d'un mot à questions d'usage, après la dernière d'entre elles : la
// carte réponse habituelle (mot, traduction, sens, usage, exemple) déjà dépliée, teintée selon
// le verdict du mot entier. Rien à saisir : « Suivant » passe au mot suivant.
function wordCard(area, item, isCorrect, { remaining = 0 } = {}) {
  return new Promise((resolve) => {
    const card = morphCardHtml({
      instruction: '', question: withArticle(item), answer: withArticle(item), pos: item.type,
      // Le bandeau ne porte que le français ; les formes irrégulières se lisent sous le mot.
      translation: item.prompt, registre: item.registre, sens: item.sens,
      forms: wordExtras(item),
      usage: item.usage, example: item.example, answerRegion: item.region,
    });
    area.innerHTML = `
      <div class="session-body">
        ${remaining > 0 ? cardStackHtml(remaining, card) : card}
      </div>
      <div class="session-foot session-foot--answered" id="mode-foot">
        <button type="button" class="ds-btn ds-btn--hero" id="submit-btn">Suivant</button>
      </div>
    `;
    const root = area.querySelector('#morph-card');
    area.querySelector('#answer-input').disabled = true;
    // Verdict juste : la carte à fusion affiche le mot dans la zone de saisie (comme une
    // réponse tapée) ; faux, il est dans la ligne « réponse attendue » et la zone reste vide.
    area.querySelector('#m-typed').textContent = withArticle(item);
    if (!isCorrect) root.classList.add('ds-morph--recap-wrong');
    area.querySelector('#m-label').textContent = isCorrect ? 'Mot réussi' : 'Mot à revoir';
    area.querySelector('#m-disc').innerHTML = icon(isCorrect ? 'check' : 'x', { size: 13, color: '#fff', stroke: 3.4 });
    root.classList.add(
      'ds-morph--committed', isCorrect ? 'ds-morph--correct' : 'ds-morph--wrong',
      'ds-morph--tinted', 'ds-morph--morphed', 'ds-morph--unfolded', 'ds-morph--recap',
    );
    area.querySelector('#submit-btn').addEventListener('click', () => resolve());
    onCardTap(root, () => resolve());
  });
}

// --- Tests d'usage ---------------------------------------------------------

// Tests d'usage posés à cette révision du mot : un par manière, en rotation sur le nombre de
// révisions déjà faites (spec : comptes-rendus/spec-tests-usage.md). Vide pour un mot sans
// colonne « Tests usage » exploitable — il garde alors exactement ses questions habituelles.
function usageStepsFor(item) {
  if (!isWord(item) || !item.usage_tests) return [];
  return pickUsageTests(parseUsageTests(item.usage_tests), item.total_reviews);
}

// Un test d'usage dans le circuit normal : un trou se rejoue, sans indice (la bonne réponse
// vient d'être montrée), jusqu'à la bonne réponse — seule la 1re tentative compte ; un
// placement ou un type de mot se joue une fois. `rule` : règle d'usage à montrer sur une
// carte ratée (dernière question du mot seulement).
async function askUsageTest(container, item, { test }, { index, total, badge, forceRetry, options, rule = '' }) {
  const remaining = Math.max(0, total - index - 1);
  if (test.kind === 'gap') {
    let first = null;
    for (let attempt = 0; ; attempt += 1) {
      const currentAttempt = attempt;
      const result = await gapCard(container, {
        test, rule, badge, remaining,
        retry: forceRetry || attempt > 0,
        label: attempt > 0 ? 'Deuxième tentative' : (forceRetry ? 'Mot déjà raté' : 'Complète la phrase'),
        // La faute est déjà barrée dans la phrase : sous la carte, seul le changement de niveau
        // (s'il y en a un) reste à montrer.
        getConsequence: (answer, isCorrect) => (!isCorrect && currentAttempt === 0 ? failureConsequence(item, '', options) : null),
      });
      if (result.skipped) throw new ItemSkipped();
      if (first === null) first = result.isCorrect;
      if (result.isCorrect) return first;
    }
  }
  const card = test.kind === 'type' ? typeCard : choiceCard;
  const result = await card(container, {
    word: item.en_base,
    test,
    rule,
    badge,
    retry: forceRetry,
    remaining,
    getConsequence: (isCorrect) => (isCorrect ? null : failureConsequence(item, '', options)),
  });
  if (result.skipped) throw new ItemSkipped();
  return result.isCorrect;
}

// Carte d'article d'un nom allemand : der / die / das, une seule tentative (comme une carte
// de phrases à cocher).
async function askArticle(container, item, { badge, remaining = 0, retry = false, getConsequence }) {
  const result = await choiceCard(container, {
    word: item.en_base, test: articleTest(item), badge, retry, remaining,
    prompt: 'Quel article ?', help: "Choisis l'article", getConsequence, shuffle: false,
  });
  if (result.skipped) throw new ItemSkipped();
  return result.isCorrect;
}

// --- Passage de découverte -------------------------------------------------

function discoverFields(item) {
  if (isWord(item)) {
    const word = [withArticle(item), wordExtras(item)].filter(Boolean).join(' ');
    return {
      word, pos: item.type, example: item.example, translation: item.prompt,
      registre: item.registre, sens: item.sens, usage: item.usage, region: item.region,
    };
  }
  if (item.item_type === 'grammaire') {
    return { word: item.en, pos: null, example: item.explication, translation: item.prompt };
  }
  return { word: item.en, pos: null, example: item.example, translation: item.prompt, region: item.region };
}

// --- Questions -------------------------------------------------------------

// La conséquence d'un échec est lue dans la ligne de progression telle qu'elle est avant
// notation, donc elle décrit ce que la règle Leitner va réellement faire de l'item. Rendue
// en pastilles avant/après (pas une phrase) — omises quand rien ne change (entraînement
// libre, ou déjà au niveau plancher).
function failureConsequence(item, answer, { preserveSchedule = false } = {}) {
  const wrongAnswer = answer.trim() || null;
  if (preserveSchedule) return { wrongAnswer };
  const row = getProgressRow(item.item_type, item.item_key);
  if (row && row.consecutive_failures + 1 >= 3) {
    return { wrongAnswer, before: `N${row.box_level}`, after: 'compliqué' };
  }
  const current = row?.box_level ?? 0;
  const next = Math.max(current - 1, 0);
  if (current === next) return { wrongAnswer };
  return { wrongAnswer, before: `N${current}`, after: `N${next}` };
}

// Redemande la même question jusqu'à une bonne réponse. Seule la première tentative
// (retournée ici) compte pour la note Leitner — les redemandes suivantes ne sont qu'un
// entraînement affiché à l'écran, sous la forme d'une carte « deuxième tentative ».
async function askUntilCorrect(container, item, {
  instruction, question, expected, pos, example, registre, sens, usage, sensHint, index, total, badge, forceRetry, options, checkFn,
  questionRegion, answerRegion, promptRegion, questionSentence = false, translation,
}) {
  let first = null;
  let attempt = 0;
  while (true) {
    const retry = forceRetry || attempt > 0;
    // L'indice n'apparaît qu'à la reprise : la première tentative se joue sans filet.
    const hint = attempt > 0 ? hintMaskHtml(expected) : '';
    // Seule la première tentative décide du sort de l'item : c'est la seule qui affiche la
    // conséquence.
    const currentAttempt = attempt;
    const result = await morphCard(container, {
      instruction,
      question,
      badge,
      retry,
      // La carte or dit « on y revient » : au 2e essai c'est une reprise, en mode « mots
      // ratés » c'est un mot déjà tombé une fois.
      retryLabel: attempt > 0 ? 'Deuxième tentative' : 'Mot déjà raté',
      hint,
      remaining: Math.max(0, total - index - 1),
      checkFn,
      answer: expected,
      pos,
      // Bandeau : le français seul. Par défaut la question (posée en français) ; la carte des
      // formes passées, posée sur le mot anglais, passe le français du mot.
      translation: translation ?? question,
      registre,
      sens,
      usage,
      sensHint,
      example,
      questionRegion,
      answerRegion,
      promptRegion,
      questionSentence,
      // La faute est déjà barrée dans la carte (« Ta réponse ») : sous la carte, seul le
      // changement de niveau reste à montrer.
      getConsequence: (answer, isCorrect) => (!isCorrect && currentAttempt === 0 ? failureConsequence(item, '', options) : null),
    });
    if (result.skipped) throw new ItemSkipped();
    const { isCorrect } = result;
    if (first === null) first = isCorrect;
    if (isCorrect) break;
    attempt += 1;
  }
  return first;
}

async function runVocabQuestion(container, item, { index, total, badge, options, forceRetry, tally, markResult }) {
  const before = getProgressRow(item.item_type, item.item_key);
  const usageSteps = usageStepsFor(item);
  const article = hasArticleTest(item);
  // Des questions d'usage ou d'article suivent : traduction et formes ne montrent ni la règle
  // ni l'exemple (ils donneraient leurs réponses) ; la fiche complète se déplie sous la dernière.
  const followUps = usageSteps.length > 0 || article;
  const example = followUps ? null : item.example;

  const baseCorrect = await askUntilCorrect(container, item, {
    instruction: translateInstruction(),
    question: item.prompt,
    expected: item.en_base,
    pos: item.type,
    example,
    registre: item.registre,
    sens: item.sens,
    usage: followUps ? null : item.usage,
    sensHint: item.sens,
    answerRegion: item.region,
    promptRegion: item.region,
    index, total, badge, forceRetry, options,
    checkFn: (answer) => checkBase(item, answer),
  });

  let conjugationCorrect = true;
  if (article) {
    conjugationCorrect = await askArticle(container, item, {
      badge, retry: forceRetry, remaining: Math.max(0, total - index - 1),
      getConsequence: (isCorrect) => (isCorrect ? null : failureConsequence(item, '', options)),
    });
  }
  if (item.en_past_simple) {
    const formsCorrect = await askUntilCorrect(container, item, {
      instruction: formsInstruction(item),
      question: item.en_base,
      translation: item.prompt,
      expected: `${item.en_past_simple} / ${item.en_past_participle}`,
      pos: item.type,
      example,
      questionRegion: item.region,
      index, total, badge, forceRetry, options,
      checkFn: (answer) => checkConjugation(item, answer),
    });
    conjugationCorrect = conjugationCorrect && formsCorrect;
  }

  // Tous les tests d'usage sont posés même après un échec : chacun est un entraînement utile,
  // et la note (une seule par mot) attend de toute façon la fin du circuit.
  let usageCorrect = true;
  for (const [i, step] of usageSteps.entries()) {
    const rule = i === usageSteps.length - 1 ? usageRuleHtml(item.usage) : '';
    const ok = await askUsageTest(container, item, step, { index, total, badge, forceRetry, options, rule });
    usageCorrect = usageCorrect && ok;
  }

  // Comme les formes passées : le mot n'est réussi que si tout le circuit l'est.
  await finalizeVocabItem(item, baseCorrect, conjugationCorrect && usageCorrect, options);
  const correct = baseCorrect && conjugationCorrect && usageCorrect;
  // Après la dernière question d'usage, la carte réponse complète du mot (masquée jusque-là).
  if (followUps) await wordCard(container, item, correct, { remaining: Math.max(0, total - index - 1) });
  recordOutcome(tally, before, getProgressRow(item.item_type, item.item_key), correct);
  markResult?.(index, correct);
}

async function runGrammaireQuestion(container, item, { index, total, badge, options, forceRetry, tally, markResult }) {
  const before = getProgressRow(item.item_type, item.item_key);
  const isCorrect = await askUntilCorrect(container, item, {
    instruction: 'Traduis en anglais',
    question: item.prompt,
    expected: item.en,
    pos: null,
    example: item.explication,
    index, total, badge, forceRetry, options,
    checkFn: (answer) => checkAnswer(item, answer),
  });
  await finalizeItem(item, isCorrect, options);
  recordOutcome(tally, before, getProgressRow(item.item_type, item.item_key), isCorrect);
  markResult?.(index, isCorrect);
}

async function runExpressionQuestion(container, item, { index, total, badge, options, forceRetry, tally, markResult }) {
  const before = getProgressRow(item.item_type, item.item_key);
  const isCorrect = await askUntilCorrect(container, item, {
    instruction: "Trouve l'expression",
    question: item.prompt,
    expected: item.en,
    pos: null,
    example: item.example,
    answerRegion: item.region,
    promptRegion: item.region,
    index, total, badge, forceRetry, options,
    checkFn: (answer) => checkAnswer(item, answer),
  });
  await finalizeItem(item, isCorrect, options);
  recordOutcome(tally, before, getProgressRow(item.item_type, item.item_key), isCorrect);
  markResult?.(index, isCorrect);
}

async function runQuestion(container, item, ctx) {
  if (isWord(item)) await runVocabQuestion(container, item, ctx);
  else if (item.item_type === 'grammaire') await runGrammaireQuestion(container, item, ctx);
  else if (item.item_type === 'expressions') await runExpressionQuestion(container, item, ctx);
}

// --- Mots compliqués -------------------------------------------------------

// Phase 1: En -> Fr/sens, sans indice. Phase 2: Fr/sens -> En, avec indice masqué.
// Phase 3: Fr/sens -> En, sans indice (la question du circuit normal).
function hardModeQuestion(item, phase) {
  const forwardExpected = isWord(item) ? item.en_base : item.en;
  const forwardCheck = isWord(item)
    ? (answer) => checkBase(item, answer)
    : (answer) => checkAnswer(item, answer);

  if (phase === 1) {
    return {
      instruction: 'Traduis en français',
      question: isWord(item) ? withArticle(item) : forwardExpected,
      expected: item.prompt,
      hint: '',
      questionRegion: item.region,
      checkFn: (answer) => checkReverse(item, answer),
    };
  }
  if (phase === 2) {
    return {
      instruction: translateInstruction(),
      question: item.prompt,
      expected: forwardExpected,
      hint: hintMaskHtml(forwardExpected),
      sensHint: item.sens,
      answerRegion: item.region,
      promptRegion: item.region,
      checkFn: forwardCheck,
    };
  }
  return {
    instruction: translateInstruction(),
    question: item.prompt,
    expected: forwardExpected,
    hint: '',
    sensHint: item.sens,
    answerRegion: item.region,
    promptRegion: item.region,
    checkFn: forwardCheck,
  };
}

function phaseBadge(phase) {
  return `<span class="ds-badge ds-badge--tricky">Phase ${phase}</span>`;
}

// Nombre de franchissements de phase qu'un item doit réussir pour sortir du mode compliqué :
// 3 pour les mots (1->2->3->sortie), 2 pour la grammaire et les expressions (2->3->sortie,
// pas de phase 1).
function hardModeTotalSteps(itemType) {
  return itemType === 'vocabulaire' || itemType === 'allemand' ? 3 : 2;
}

// Position (0-indexée) d'une phase dans le trajet de l'item, jusqu'à hardModeTotalSteps
// (= sorti). Sert à mesurer l'avancée d'un item dans la séance pour la barre.
function hardModeStepIndex(itemType, phase) {
  return phase - initialHardPhase(itemType);
}

// Interroge `item` une fois à `targetPhase` — il avance (succès), sort du processus (succès
// en phase 3), ou quitte la séance après un échec et la question de rattrapage, renvoyé à sa
// phase de départ pour la prochaine séance. Rendre la main à chaque changement de phase est ce qui
// permet à renderHardMode de grouper les items par phase plutôt que de faire parcourir tout
// le trajet 1→2→3 à un item avant de passer au suivant.
async function runHardModeRound(container, item, targetPhase, tally) {
  const {
    instruction, question, expected, hint, sensHint, checkFn, questionRegion, answerRegion, promptRegion,
  } = hardModeQuestion(item, targetPhase);
  const pos = isWord(item) ? item.type : null;
  // Rempli par getConsequence (elle seule connaît le verdict et le résultat de la notation
  // Leitner) puis lu une fois morphCard résolue : c'est la décision renvoyée par cette
  // fonction (`rescue` = phase de la question de rattrapage à poser avant de sortir le mot).
  let outcome = null;
  // Phase 3 d'un mot de vocabulaire : la traduction juste ne suffit pas, les cartes de suite
  // (formes passées d'un verbe irrégulier, puis un test d'usage par manière) doivent toutes
  // l'être aussi — comme dans le circuit normal.
  const followUps = targetPhase === 3 && isWord(item)
    ? [...(hasArticleTest(item) ? [{ article: true }] : []), ...(item.en_past_simple ? [{ forms: true }] : []), ...usageStepsFor(item)]
    : [];
  // L'article se lit aussi dans l'exemple : même masquage que pour l'usage.
  const hasUsage = followUps.some((step) => step.test || step.article);

  // Note une tentative de phase complète (base, plus formes passées le cas échéant) : une
  // seule entrée au bilan et une seule notation Leitner par tentative.
  const gradeRound = async (answer, isCorrect) => {
    tally.answered += 1;
    if (isCorrect) tally.correct += 1;
    else tally.wrong += 1;

    if (isCorrect && targetPhase === 3) {
      await gradeHardAttempt(item, 3, true);
      tally.exitedHard += 1;
      tally.phasesCleared += 1;
      // Le mot quitte les compliqués sans rejoindre aucune section aujourd'hui : à
      // l'accueil, sa particule s'élèvera et éclatera au lieu d'atterrir quelque part.
      noteRelease('tricky');
      outcome = { done: true };
      return 'Sorti du mode compliqué : le mot revient demain en découverte';
    }

    await gradeHardAttempt(item, targetPhase, isCorrect);

    if (isCorrect) {
      tally.phasesCleared += 1;
      outcome = { done: false, newPhase: advancedPhase(targetPhase) };
      return null;
    }

    outcome = { done: true, rescue: rescuePhase(targetPhase, item.item_type) };
    // La faute est déjà barrée dans la carte : seule la phase de reprise (prochaine séance)
    // reste dessous.
    return { wrongAnswer: null, before: `Phase ${targetPhase}`, after: `Phase ${initialHardPhase(item.item_type)}` };
  };

  const result = await morphCard(container, {
    instruction,
    question,
    hint,
    // Le sens annote le mot français : en phase 1, où le français est la réponse à trouver,
    // il ne s'affiche qu'avec le résultat, jamais sous la question.
    sensHint: targetPhase === 1 ? null : sensHint,
    questionRegion,
    answerRegion,
    promptRegion,
    answer: expected,
    pos,
    registre: item.registre,
    sens: item.sens,
    // Règle et exemple masqués quand des questions d'usage suivent (comme dans le circuit
    // normal) : ils donneraient leurs réponses. La fiche complète se déplie sous la dernière.
    usage: hasUsage ? null : item.usage,
    // Français seul ; en phase 1 la réponse attendue est le français, déjà en haut de la carte.
    translation: targetPhase === 1 ? '' : question,
    example: hasUsage ? null : (item.example || item.explication),
    checkFn,
    getConsequence: async (answer, isCorrect) => {
      // Des cartes de suite restent : la note attend la dernière d'entre elles, juste ou
      // fausse (comme finalizeVocabItem dans le circuit normal).
      if (followUps.length) return null;
      return gradeRound(answer, isCorrect);
    },
  });
  if (result.skipped) throw new ItemSkipped();

  // Même ordre que le circuit normal : toutes les cartes de suite sont posées, même après
  // une erreur, une seule fois chacune (pas de 2e tentative en mode compliqué). Une seule
  // notation par tentative de phase, portée par la dernière carte : la phase n'est réussie
  // que si tout est juste. La réponse barrée n'est montrée que si cette dernière carte est
  // elle-même fausse.
  let allCorrect = result.isCorrect;
  for (let i = 0; i < followUps.length; i += 1) {
    const last = i === followUps.length - 1;
    const consequence = (answer, ok) => {
      if (!last) return null;
      return gradeRound(ok ? '' : answer, allCorrect && ok);
    };
    const rule = last && followUps[i].test ? usageRuleHtml(item.usage) : '';
    const ok = await runHardFollowUp(container, item, followUps[i], pos, consequence, rule);
    allCorrect = allCorrect && ok;
  }
  if (hasUsage) await wordCard(container, item, allCorrect);
  if (outcome.rescue) await askHardRescue(container, item, outcome.rescue);
  return outcome;
}

// Question de rattrapage après un échec : celle de la phase du dessous (la même à la phase la
// plus basse), reposée jusqu'à la bonne réponse. Non notée — le mot est déjà renvoyé à sa
// phase de départ et quitte la séance. Passer la question l'abandonne simplement.
async function askHardRescue(container, item, phase) {
  const {
    instruction, question, expected, hint, sensHint, checkFn, questionRegion, answerRegion, promptRegion,
  } = hardModeQuestion(item, phase);
  while (true) {
    const result = await morphCard(container, {
      instruction,
      question,
      // Phase 2 : son indice habituel ; phase 1 : aucun (la réponse attendue est le français).
      hint,
      retry: true,
      retryLabel: 'Rattrapage',
      sensHint: phase === 1 ? null : sensHint,
      questionRegion,
      answerRegion,
      promptRegion,
      answer: expected,
      pos: isWord(item) ? item.type : null,
      registre: item.registre,
      sens: item.sens,
      usage: item.usage,
      translation: phase === 1 ? '' : question,
      example: item.example || item.explication,
      checkFn,
    });
    if (result.skipped || result.isCorrect) return;
  }
}

// Une carte de suite en phase 3 du mode compliqué (formes passées ou test d'usage), jouée une
// fois : `consequence(answer, isCorrect)` décide de la notation et de ce qui s'affiche.
async function runHardFollowUp(container, item, step, pos, consequence, rule = '') {
  if (step.article) return askArticle(container, item, { getConsequence: (ok) => consequence('', ok) });
  let result;
  if (step.forms) {
    const formsExpected = `${item.en_past_simple} / ${item.en_past_participle}`;
    result = await morphCard(container, {
      instruction: formsInstruction(item),
      question: item.en_base,
      questionRegion: item.region,
      answer: formsExpected,
      pos,
      translation: item.prompt,
      example: usageStepsFor(item).length || hasArticleTest(item) ? null : item.example,
      checkFn: (answer) => checkConjugation(item, answer),
      getConsequence: consequence,
    });
  } else if (step.test.kind === 'gap') {
    // Faute déjà barrée dans la phrase : la conséquence ne garde que le changement de phase.
    result = await gapCard(container, { test: step.test, rule, getConsequence: (answer, isCorrect) => consequence('', isCorrect) });
  } else {
    const card = step.test.kind === 'type' ? typeCard : choiceCard;
    result = await card(container, {
      word: item.en_base,
      test: step.test,
      rule,
      getConsequence: (isCorrect) => consequence('', isCorrect),
    });
  }
  if (result.skipped) throw new ItemSkipped();
  return result.isCorrect;
}

// --- Modes -----------------------------------------------------------------

// Tous les items passent d'abord en phase 1, puis tous ceux encore actifs en phase 2, puis
// en phase 3 — jamais le trajet complet 1→2→3 d'un item avant le suivant. Un item raté
// quitte la séance (après sa question de rattrapage) : il ne revient qu'à la suivante.
export async function renderHardMode(container, { hardItems }, { onComplete, onExit }) {
  // Toujours la barre classique : le total compte les franchissements de phase nécessaires
  // pour sortir chaque mot (3 ou 2 selon le type), pas les mots eux-mêmes — des points n'y
  // représenteraient rien de lisible.
  const total = hardItems.reduce((sum, item) => sum + hardModeTotalSteps(item.item_type), 0);
  const { area, setProgress } = renderModeShell(container, onExit, { total, useDots: false });
  const tally = newTally('hard');
  tally.totalItems = hardItems.length;
  const queues = { 1: [], 2: [], 3: [] };
  for (const item of hardItems) queues[item.hard_phase].push(item);

  // Plus-haut niveau atteint par item : la barre progresse toujours, sans jamais reculer.
  const key = (item) => `${item.item_type}:${item.item_key}`;
  const highWater = new Map(hardItems.map((item) => [key(item), hardModeStepIndex(item.item_type, item.hard_phase)]));
  // Un item quitte définitivement la session (sorti du mode compliqué, raté, ou passé) : sa part du total est alors comptée en entier, qu'il ait ou non
  // effectivement franchi toutes ses phases — il ne sera plus redemandé, la barre doit le
  // refléter plutôt que rester bloquée en dessous de 100 % en fin de session.
  const finished = new Set();

  const computeDone = () => hardItems.reduce((sum, item) => {
    const k = key(item);
    return sum + (finished.has(k) ? hardModeTotalSteps(item.item_type) : highWater.get(k));
  }, 0);

  while (queues[1].length || queues[2].length || queues[3].length) {
    const phase = queues[1].length ? 1 : queues[2].length ? 2 : 3;
    setProgress(computeDone(), total, { badge: phaseBadge(phase) });
    const item = queues[phase].shift();
    const k = key(item);
    try {
      const outcome = await runHardModeRound(area, item, phase, tally);
      if (outcome.done) {
        finished.add(k);
      } else {
        const idx = hardModeStepIndex(item.item_type, outcome.newPhase);
        highWater.set(k, Math.max(highWater.get(k), idx));
        queues[outcome.newPhase].push(item);
      }
    } catch (err) {
      if (!(err instanceof ItemSkipped)) throw err;
      // Le mot passé ne revient dans aucune file : il reste exactement où il était, mais ne
      // sera plus redemandé cette session — compté comme terminé pour la barre.
      finished.add(k);
    }
  }
  onComplete(tally);
}

export async function renderLearningMode(container, { newItems }, { onComplete, onExit }) {
  const useDots = newItems.length > 0 && newItems.length <= 20;
  const { area, setProgress, markResult } = renderModeShell(container, onExit, { total: newItems.length, useDots });
  const tally = newTally('learning');
  // Deux passages, chacun reparti de zéro : la lecture des nouveaux mots (remplissage
  // rayé, jamais de points), puis la phase question/réponse (points si la session tient en
  // 20 mots, barre classique sinon).
  for (let i = 0; i < newItems.length; i++) {
    setProgress(i, newItems.length, { phase: 'discover' });
    const fields = discoverFields(newItems[i]);
    await discoverCard(area, { ...fields, remaining: newItems.length - i - 1 });
  }
  for (let i = 0; i < newItems.length; i++) {
    setProgress(i, newItems.length);
    try {
      await runQuestion(area, newItems[i], { index: i, total: newItems.length, tally, markResult });
    } catch (err) {
      if (!(err instanceof ItemSkipped)) throw err;
    }
  }
  onComplete(tally);
}

export async function renderReviewMode(container, { reviewItems }, { onComplete, onExit }) {
  const useDots = reviewItems.length > 0 && reviewItems.length <= 20;
  const { area, setProgress, markResult } = renderModeShell(container, onExit, { total: reviewItems.length, useDots });
  const tally = newTally('review');
  for (let i = 0; i < reviewItems.length; i++) {
    setProgress(i, reviewItems.length);
    try {
      await runQuestion(area, reviewItems[i], { index: i, total: reviewItems.length, tally, markResult });
    } catch (err) {
      if (!(err instanceof ItemSkipped)) throw err;
    }
  }
  onComplete(tally);
}

export async function renderFailedWordsMode(container, { failedWords }, { onComplete, onExit }) {
  const useDots = failedWords.length > 0 && failedWords.length <= 20;
  const { area, setProgress, markResult } = renderModeShell(container, onExit, { total: failedWords.length, useDots });
  const tally = newTally('failed');
  for (let i = 0; i < failedWords.length; i++) {
    setProgress(i, failedWords.length);
    try {
      await runQuestion(area, failedWords[i], {
        index: i, total: failedWords.length, forceRetry: true, options: { preserveSchedule: true }, tally, markResult,
      });
    } catch (err) {
      if (!(err instanceof ItemSkipped)) throw err;
    }
  }
  onComplete(tally);
}

// --- Session terminée ------------------------------------------------------

// Teinte par catégorie de session : la même pour l'anneau, la coche et l'aplat de fond
// plein écran (posé sur <body>, seul moyen d'aller sous la marge de #app jusqu'au bord réel
// de l'écran — voir la classe body.recap-bg-* dans style.css).
const RECAP_ACCENTS = {
  new: { color: 'var(--cat-new)', soft: 'var(--copper-100)', shadow: 'rgba(176,74,15,.75)', text: 'var(--copper-600)', bodyClass: 'recap-bg-new' },
  review: { color: 'var(--cat-review)', soft: 'var(--teal-100)', shadow: 'rgba(13,110,122,.75)', text: 'var(--teal-600)', bodyClass: 'recap-bg-review' },
  failed: { color: 'var(--cat-failed)', soft: 'var(--crimson-100)', shadow: 'rgba(196,18,58,.7)', text: 'var(--crimson-600)', bodyClass: 'recap-bg-failed' },
  tricky: { color: 'var(--cat-tricky)', soft: 'var(--violet-100)', shadow: 'rgba(109,40,217,.6)', text: 'var(--violet-600)', bodyClass: 'recap-bg-tricky' },
};

function pluralFr(n, word, pluralWord = `${word}s`) {
  return n > 1 ? pluralWord : word;
}

// Contenu propre à chaque type de session : quelle proportion porte l'anneau, le titre, le
// sous-texte statique, et — sauf pour la découverte, qui n'a rien à répartir — les segments
// de la barre de répartition ci-dessous (valeur, couleur, libellé de légende).
function buildRecapVisual(tally) {
  if (tally.kind === 'learning') {
    const dailyBudget = getNewItemsPerDay();
    const introducedToday = countNewIntroducedToday(todayISO());
    return {
      accent: 'new',
      eyebrow: 'Mots nouveaux',
      num: introducedToday,
      den: dailyBudget,
      headline: `${introducedToday} mot${introducedToday > 1 ? 's' : ''} découvert${introducedToday > 1 ? 's' : ''}`,
      sub: 'Ils entrent au niveau 1 et reviennent en révision demain.',
      segments: null,
    };
  }
  if (tally.kind === 'review') {
    const requeuedOnly = tally.wrong - tally.enteredHard;
    const segments = [
      { value: tally.correct, color: 'var(--green-500)', label: 'réussis' },
      ...(requeuedOnly > 0 ? [{ value: requeuedOnly, color: 'var(--crimson-500)', label: 'ratés' }] : []),
      ...(tally.enteredHard > 0 ? [{ value: tally.enteredHard, color: 'var(--violet-500)', label: 'durs' }] : []),
    ];
    return {
      accent: 'review',
      eyebrow: 'Révision',
      num: tally.correct,
      den: tally.answered,
      headline: `${tally.correct} mot${tally.correct > 1 ? 's' : ''} ${pluralFr(tally.correct, 'monte', 'montent')} d'un niveau`,
      sub: '',
      segments: segments.length > 1 ? segments : null,
    };
  }
  if (tally.kind === 'failed') {
    return {
      accent: 'failed',
      eyebrow: 'Mots ratés',
      num: tally.correct,
      den: tally.answered,
      headline: `${tally.correct} mot${tally.correct > 1 ? 's' : ''} récupéré${tally.correct > 1 ? 's' : ''}`,
      sub: 'Ils repassent en révision.',
      segments: tally.wrong > 0 ? [
        { value: tally.correct, color: 'var(--green-500)', label: 'récupérés' },
        { value: tally.wrong, color: 'var(--crimson-500)', label: 'restent ratés' },
      ] : null,
    };
  }
  // hard
  const stillHard = Math.max(0, tally.totalItems - tally.exitedHard);
  return {
    accent: 'tricky',
    eyebrow: 'Mots compliqués',
    num: tally.exitedHard,
    den: tally.totalItems,
    headline: `${tally.exitedHard} mot${tally.exitedHard > 1 ? 's' : ''} sauvé${tally.exitedHard > 1 ? 's' : ''}`,
    sub: '',
    segments: stillHard > 0 ? [
      { value: tally.exitedHard, color: 'var(--green-500)', label: 'sauvés' },
      { value: stillHard, color: 'var(--violet-500)', label: 'toujours durs' },
    ] : null,
  };
}

// Rang visuel fixe des pastilles flottantes (toujours la même hiérarchie de tailles, quel
// que soit le poids réel du segment qu'elles annotent) : au plus 3 segments dans ce système.
const RECAP_CALLOUT_RANKS = [
  { size: 46, top: -33, font: 19 },
  { size: 36, top: -28, font: 15 },
  { size: 30, top: -24, font: 13 },
];

// Barre de répartition sous l'anneau : segments proportionnels, chacun annoté d'une pastille
// flottante centrée sur le milieu de sa portion (pas sur sa frontière), puis une légende.
function recapBarHtml(segments) {
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  let cumulative = 0;
  const callouts = segments.map((seg, i) => {
    const mid = ((cumulative + seg.value / 2) / total) * 100;
    cumulative += seg.value;
    const rank = RECAP_CALLOUT_RANKS[i] ?? RECAP_CALLOUT_RANKS[RECAP_CALLOUT_RANKS.length - 1];
    return `
      <div class="recap-v__callout" style="left:${mid}%;width:${rank.size}px;height:${rank.size}px;top:${rank.top}px;background:${seg.color};font-size:${rank.font}px">${seg.value}</div>
    `;
  }).join('');
  const bars = segments.map((seg) => `<div style="flex:${seg.value} 0 0;background:${seg.color}"></div>`).join('');
  const legend = segments.map((seg) => `
    <div class="recap-v__legenditem"><span class="recap-v__dot" style="background:${seg.color}"></span><span>${escapeHtml(seg.label)}</span></div>
  `).join('');
  return `
    <div class="recap-v__barcard">
      <div class="recap-v__bar">${bars}</div>
      <div class="recap-v__callouts">${callouts}</div>
      <div class="recap-v__legend" style="justify-content:${segments.length > 2 ? 'space-between' : 'space-around'}">${legend}</div>
    </div>
  `;
}

// Bilan unifié des quatre types de session : même geste partout (fond teinté, anneau,
// coche, titre), seuls la couleur, les chiffres et la barre de répartition changent. Le
// raccourci vers la révision du jour (présent avant seulement sur compliqués/ratés) reste
// réservé à ces deux-là — après une séance de découverte ou de révision, le proposer serait
// redondant avec ce qu'on vient de faire.
export async function renderSessionRecap(container, tally, { onHome, onReview }) {
  container.innerHTML = '<div class="loading-block"><span class="ds-spinner"></span><div class="loading-msg">Calcul du bilan</div></div>';
  const session = (tally.kind === 'hard' || tally.kind === 'failed') ? await startSession() : null;
  const reviewLeft = session ? session.reviewItems.length : 0;

  const { accent, eyebrow, num, den, headline, sub, segments } = buildRecapVisual(tally);
  const a = RECAP_ACCENTS[accent];
  const pct = den > 0 ? Math.min(100, Math.round((num / den) * 100)) : 100;

  document.body.classList.remove(...Object.values(RECAP_ACCENTS).map((x) => x.bodyClass));
  document.body.classList.add(a.bodyClass);

  container.innerHTML = `
    <div class="session-body recap-v">
      <div class="recap-v__eyebrow" style="color:${a.text}">${escapeHtml(eyebrow)}</div>
      <div class="recap-v__ringwrap">
        <div class="recap-v__ring" id="recap-ring" style="--recap-color:${a.color};--recap-soft:${a.soft};--recap-shadow:${a.shadow}">
          <div class="recap-v__disc">
            <div class="recap-v__n">${num}</div>
            <div class="recap-v__d">SUR ${den}</div>
          </div>
        </div>
        <div class="recap-v__check" style="background:${a.color};box-shadow:0 6px 14px -4px ${a.shadow},inset 0 -1.5px 0 rgba(33,31,20,.2)">${icon('check', { size: 22, color: '#FDFBF5', stroke: 3.2 })}</div>
      </div>
      <div class="recap-v__body">
        <div class="recap-v__headline">${escapeHtml(headline)}</div>
        ${sub ? `<div class="recap-v__sub">${escapeHtml(sub)}</div>` : ''}
      </div>
      ${segments ? recapBarHtml(segments) : ''}
    </div>
    <div class="session-foot">
      <button type="button" class="ds-btn ds-btn--hero" id="recap-home">Retour à l'accueil</button>
      ${reviewLeft > 0 ? `<button type="button" class="ds-btn ds-btn--hero ds-btn--secondary" id="recap-review">Réviser ${reviewLeft} mot${reviewLeft > 1 ? 's' : ''} dus</button>` : ''}
    </div>
  `;

  // Même mécanique qu'à l'accueil : l'anneau part de zéro puis se remplit à la vraie
  // proportion — requestAnimationFrame ne se déclenche pas sur une page masquée, le minuteur
  // reprend la main pour que la valeur finisse toujours par être la bonne.
  let ringPainted = false;
  const paintRing = () => {
    if (ringPainted) return;
    ringPainted = true;
    container.querySelector('#recap-ring')?.style.setProperty('--pct', String(pct));
  };
  requestAnimationFrame(paintRing);
  setTimeout(paintRing, 250);

  container.querySelector('#recap-home').addEventListener('click', onHome);
  if (reviewLeft > 0) {
    container.querySelector('#recap-review').addEventListener('click', () => onReview(session));
  }
}

// --- Dialogue de confirmation ----------------------------------------------

// Requis avant toute action destructive. Le scrim floute l'écran, le titre nomme la perte,
// le bouton nomme l'acte — aucun « OK ».
function confirmDialog({ title, body, confirmLabel, cancelLabel = 'Annuler' }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'ds-overlay';
    overlay.innerHTML = `
      <div class="ds-scrim" id="dialog-scrim"></div>
      <div class="ds-dialog" role="dialog" aria-modal="true">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(body)}</p>
        <div class="ds-dialog__actions">
          <button type="button" class="ds-btn ds-btn--hero ds-btn--danger" id="dialog-confirm">${escapeHtml(confirmLabel)}</button>
          <button type="button" class="ds-btn ds-btn--hero ds-btn--ghost" id="dialog-cancel">${escapeHtml(cancelLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = (value) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(false); };

    overlay.querySelector('#dialog-confirm').addEventListener('click', () => close(true));
    overlay.querySelector('#dialog-cancel').addEventListener('click', () => close(false));
    overlay.querySelector('#dialog-scrim').addEventListener('click', () => close(false));
    document.addEventListener('keydown', onKey);
    overlay.querySelector('#dialog-confirm').focus();
  });
}

// --- Statistiques ----------------------------------------------------------

function levelLabel(row) {
  if (row.learning_process === 'hard') return `Compliqué (Phase ${row.hard_phase})`;
  if (row.is_learned) return 'Appris';
  if (row.requeue_date) return `Reprogrammé (${row.requeue_date})`;
  if (row.total_reviews === 0) return 'Nouveau';
  return String(row.box_level);
}

export function renderProgress(container) {
  const rows = getAllProgress();

  rows.sort((a, b) => {
    if (a.total_reviews === 0 && b.total_reviews !== 0) return -1;
    if (b.total_reviews === 0 && a.total_reviews !== 0) return 1;
    if (a.is_learned !== b.is_learned) return a.is_learned - b.is_learned;
    const da = a.next_review_date ?? '9999-99-99';
    const db_ = b.next_review_date ?? '9999-99-99';
    return da.localeCompare(db_);
  });

  const tableRows = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.item_type)}</td>
      <td>${escapeHtml(row.prompt)}</td>
      <td>${escapeHtml(levelLabel(row))}</td>
      <td>${escapeHtml(row.next_review_date ?? '—')}</td>
      <td>${escapeHtml(row.correct_streak)}</td>
      <td>${escapeHtml(row.total_reviews)}</td>
      <td>${escapeHtml(row.last_result ?? '—')}</td>
    </tr>
  `).join('');

  container.innerHTML = `
    <h1>Progression</h1>
    <div class="screen-scroll">
      <p>${rows.length} item(s) au total.</p>
      <div class="progress-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Type</th><th>Prompt</th><th>Niveau</th><th>Prochaine révision</th>
              <th>Série</th><th>Total</th><th>Dernier résultat</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </div>
  `;
}

// --- Réglages --------------------------------------------------------------

function importSummaryLine(label, s) {
  if (!s.sheetFound) return `${label} : feuille introuvable`;
  const dup = s.duplicateId.length ? ` · ${s.duplicateId.length} ID en double ignorés` : '';
  const del = s.deleted ? ` · ${s.deleted} supprimé(s)` : '';
  return `${label} : ${s.new} nouveau(x) · ${s.updated} mis à jour · ${s.skipped} ignorée(s)${del}${dup}`;
}

function toastHtml(tone, message, withIcon) {
  const glyph = withIcon ? icon('check', { size: 15, color: 'currentColor', stroke: 2.6 }) : '';
  return `<div class="ds-toast ds-toast--${tone}">${glyph}<span>${escapeHtml(message)}</span></div>`;
}

export function renderSettings(container) {
  const nEn = getNewItemsPerDay('en');
  const nDe = getNewItemsPerDay('de');
  const lastExport = getSetting('last_manual_export');
  const since = daysSince(lastExport);
  const lastExportText = since === null ? 'jamais' : since === 0 ? "aujourd'hui" : `il y a ${since} jour(s)`;

  container.innerHTML = `
    <h1>Réglages</h1>

    <div class="screen-scroll">
      <div class="ds-section">
        <div class="ds-section__head">${icon('upload', { size: 18, color: 'var(--copper-600)' })}<span class="ds-section__title">Importer le vocabulaire</span></div>
        <div class="ds-section__body">
          <p>Sélectionne ton fichier Excel (.xlsx). Réimporter est sans risque : le contenu est mis à
          jour, ta progression de révision n'est jamais effacée.</p>
          <input type="file" id="import-file" accept=".xlsx" />
          <div id="import-summary"></div>
        </div>
      </div>

      <div class="ds-section">
        <div class="ds-section__head">${icon('sparkles', { size: 18, color: 'var(--copper-600)' })}<span class="ds-section__title">Nouveaux items par jour</span></div>
        <div class="ds-section__body">
          <p>Nombre maximum de nouveaux mots/règles/expressions introduits chaque jour, tous types confondus. Chaque langue a son propre objectif.</p>
          <label class="n-lang" for="n-input-en">Anglais</label>
          <input type="number" id="n-input-en" min="1" step="1" value="${nEn}" />
          <label class="n-lang" for="n-input-de">Allemand</label>
          <input type="number" id="n-input-de" min="1" step="1" value="${nDe}" />
          <button type="button" class="ds-btn ds-btn--sm" id="n-save-btn">Enregistrer</button>
          <div id="n-status"></div>
        </div>
      </div>

      <div class="ds-section">
        <div class="ds-section__head">${icon('download', { size: 18, color: 'var(--copper-600)' })}<span class="ds-section__title">Sauvegarde</span></div>
        <div class="ds-section__body">
          <p>Ta progression est stockée uniquement sur cet appareil. Exporte une sauvegarde de temps
          en temps (par ex. vers Fichiers/iCloud) pour ne rien perdre en cas de problème.</p>
          <div class="ds-kv"><span>Dernier export</span><span class="ds-kv__v">${escapeHtml(lastExportText)}</span></div>
          <button type="button" class="ds-btn ds-btn--hero" id="export-btn">Exporter une sauvegarde</button>
        </div>
      </div>

      <div class="ds-section ds-section--danger">
        <div class="ds-section__head">${icon('triangle-alert', { size: 18, color: 'currentColor' })}<span class="ds-section__title">Restaurer une sauvegarde</span></div>
        <div class="ds-section__body">
          <p>La restauration écrase toutes tes données actuelles : mots, niveaux, série et
          statistiques sont remplacés par le contenu du fichier.</p>
          <input type="file" id="restore-file" accept=".sqlite" />
          <div id="restore-status"></div>
        </div>
      </div>

      <div class="ds-section ds-section--danger">
        <div class="ds-section__head">${icon('triangle-alert', { size: 18, color: 'currentColor' })}<span class="ds-section__title">Zone de débogage</span></div>
        <div class="ds-section__body">
          <p>Efface définitivement tout le contenu et toute la progression actuels, pour repartir
          d'une base vide (à réimporter ensuite).</p>
          <button type="button" class="ds-btn ds-btn--hero ds-btn--danger" id="reset-db-btn">Réinitialiser la base de données</button>
          <div id="reset-db-status"></div>
        </div>
      </div>
    </div>
  `;

  const importFile = container.querySelector('#import-file');
  const importSummary = container.querySelector('#import-summary');
  importFile.addEventListener('change', async () => {
    const file = importFile.files[0];
    if (!file) return;

    // Pendant l'import : l'anneau et des squelettes à la place des lignes à venir. Jamais
    // de pourcentage inventé.
    importSummary.innerHTML = `
      <div class="loading-block"><span class="ds-spinner"></span><div class="loading-msg">Import du fichier en cours</div></div>
      <div class="skel-stack"><div class="ds-skel"></div><div class="ds-skel"></div><div class="ds-skel"></div></div>
    `;
    try {
      const buffer = await file.arrayBuffer();
      const workbook = parseWorkbookFile(buffer);
      // Un ID disparu de l'Excel : on supprime l'élément et sa progression, mais seulement après accord.
      const missing = findMissingItems(workbook);
      if (missing.length) {
        const n = missing.length;
        const labels = missing.slice(0, 10).map((m) => m.label).join(', ');
        const more = n > 10 ? ` et ${n - 10} autres` : '';
        const ok = await confirmDialog({
          title: n === 1 ? "Supprimer 1 mot absent de l'Excel ?" : `Supprimer ${n} mots absents de l'Excel ?`,
          body: `${n === 1 ? 'Ce mot et toute sa progression seront supprimés' : 'Ces mots et toute leur progression seront supprimés'} définitivement : ${labels}${more}.`,
          confirmLabel: 'Supprimer et importer',
          cancelLabel: "Annuler l'import",
        });
        if (!ok) {
          importSummary.innerHTML = '<div class="ds-alert ds-alert--warning">Import annulé</div>';
          return;
        }
      }
      const summary = await importFromWorkbook(workbook, todayISO(), { deleteMissing: missing.length > 0 });
      importSummary.innerHTML = [
        toastHtml('correct', importSummaryLine('Vocabulaire', summary.vocabulaire), true),
        toastHtml('correct', importSummaryLine('Grammaire', summary.grammaire), true),
        toastHtml('correct', importSummaryLine('Expressions', summary.expressions), true),
        toastHtml('correct', importSummaryLine('Allemand', summary.allemand), true),
      ].join('');
    } catch (err) {
      importSummary.innerHTML = toastHtml('wrong', `Fichier illisible : ${err.message}`, false);
    } finally {
      importFile.value = '';
    }
  });

  container.querySelector('#n-save-btn').addEventListener('click', async () => {
    const valueEn = parseInt(container.querySelector('#n-input-en').value, 10);
    const valueDe = parseInt(container.querySelector('#n-input-de').value, 10);
    const status = container.querySelector('#n-status');
    if (![valueEn, valueDe].every((v) => Number.isFinite(v) && v >= 1)) {
      status.innerHTML = '<div class="ds-alert ds-alert--warning">Merci de saisir un nombre valide (≥ 1) pour chaque langue.</div>';
      return;
    }
    await setSetting('new_items_per_day', valueEn);
    await setSetting('new_items_per_day_de', valueDe);
    status.innerHTML = '<div class="ds-alert ds-alert--success">Enregistré.</div>';
  });

  container.querySelector('#export-btn').addEventListener('click', async () => {
    await exportToFile();
    renderSettings(container);
  });

  container.querySelector('#restore-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const status = container.querySelector('#restore-status');
    const ok = await confirmDialog({
      title: 'Restaurer cette sauvegarde ?',
      body: 'La restauration écrase toutes tes données actuelles. Mots, niveaux, série et statistiques seront remplacés par le contenu du fichier.',
      confirmLabel: 'Remplacer mes données',
    });
    if (!ok) {
      e.target.value = '';
      return;
    }
    status.innerHTML = '<div class="loading-block"><span class="ds-spinner"></span><div class="loading-msg">Restauration en cours</div></div>';
    try {
      await importFromFile(file);
      status.innerHTML = toastHtml('correct', 'Sauvegarde restaurée', true);
    } catch (err) {
      status.innerHTML = toastHtml('wrong', `Erreur : ${err.message}`, false);
    } finally {
      e.target.value = '';
    }
  });

  container.querySelector('#reset-db-btn').addEventListener('click', async () => {
    const status = container.querySelector('#reset-db-status');
    const ok = await confirmDialog({
      title: 'Effacer toute la base ?',
      body: 'Tout le contenu et toute la progression actuels sont supprimés définitivement. Il faudra réimporter ton fichier Excel ensuite.',
      confirmLabel: 'Tout effacer',
    });
    if (!ok) return;
    status.innerHTML = '<div class="loading-block"><span class="ds-spinner"></span><div class="loading-msg">Réinitialisation en cours</div></div>';
    try {
      await resetDatabase();
      renderSettings(container);
      container.querySelector('#reset-db-status').innerHTML = toastHtml('correct', 'Base réinitialisée', true);
    } catch (err) {
      status.innerHTML = toastHtml('wrong', `Erreur : ${err.message}`, false);
    }
  });
}
