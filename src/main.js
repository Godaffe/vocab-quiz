import './style.css';
import { initDb } from './db.js';
import { rotateInternalBackup } from './backup.js';
import { icon } from './icons.js';
import { growFromRect, shrinkToRect } from './card.js';
import {
  renderHome, renderHardMode, renderLearningMode, renderReviewMode,
  renderFailedWordsMode, renderSettings, renderProgress, renderSessionRecap,
} from './ui.js';

if ('storage' in navigator && 'persist' in navigator.storage) {
  navigator.storage.persist();
}

// Évite que le clavier ne recouvre la carte en cours, sans jamais bouger le reste de l'écran
// (en-tête, barre de progression, boutons du pied) : #app est en 100svh, immunisé au clavier
// (voir style.css), donc lui ne bouge déjà pas. Seul .session-body — la zone de la carte,
// distincte de l'en-tête et du pied de session — est décalé vers le haut, et seulement du
// strict nécessaire pour dégager le clavier, jamais recentré ni redimensionné.
function initKeyboardAvoidance() {
  const vv = window.visualViewport;
  if (!vv) return;
  const adjust = () => {
    const body = document.querySelector('.session-body');
    if (!body) return;
    body.style.transform = '';
    const rect = body.getBoundingClientRect();
    const visibleBottom = vv.height + vv.offsetTop;
    const covered = rect.bottom - visibleBottom;
    body.style.transform = covered > 0 ? `translateY(-${Math.ceil(covered)}px)` : '';
  };
  vv.addEventListener('resize', adjust);
  vv.addEventListener('scroll', adjust);
}
initKeyboardAvoidance();

const app = document.getElementById('app');
const screen = document.createElement('div');
screen.id = 'screen';

const TABS = [
  { id: 'nav-home', label: 'Accueil', glyph: 'house' },
  { id: 'nav-progress', label: 'Statistiques', glyph: 'chart' },
  { id: 'nav-settings', label: 'Réglages', glyph: 'settings' },
];

const nav = document.createElement('nav');
nav.className = 'ds-tabbar';
nav.innerHTML = TABS.map((t) => `
  <button id="${t.id}" class="ds-tab" type="button">
    ${icon(t.glyph, { size: 20 })}
    <span>${t.label}</span>
    <span class="ds-tab__mark"></span>
  </button>
`).join('');

// La barre d'état suit l'écran : lin clair hors session, lin profond pendant, comme les
// maquettes (--status-bar-default / --status-bar-session).
function setStatusBar(inSession) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', inSession ? '#DCD6C6' : '#EDE9DC');
}

// Toute sortie de session passe par l'une des routes ci-dessous : c'est donc ici qu'on
// lève la classe posée par la coque de session, qui masque la nav du bas.
function setActiveNav(id) {
  document.body.classList.remove('in-session', 'recap-bg-new', 'recap-bg-review', 'recap-bg-failed', 'recap-bg-tricky');
  setStatusBar(false);
  nav.querySelectorAll('button').forEach((b) => b.classList.toggle('ds-tab--active', b.id === id));
}

function startSessionChrome() {
  document.body.classList.add('in-session');
  setStatusBar(true);
}

// La tuile touchée à l'accueil devient l'écran de session (croissance depuis son rectangle),
// et inversement à la sortie (rétrécissement vers ce même rectangle) — qu'on quitte par le ✕
// ou par le bilan. Un seul rectangle mémorisé par session : les deux sorties possibles
// (abandon en cours, ou bilan une fois la séance terminée) reviennent toutes deux vers la
// tuile d'où l'on est parti, jamais recalculé entre-temps (la tuile n'existe déjà plus, sa
// séance étant en cours).
let lastEnterRect = null;

function goHome(celebrate) {
  const rect = lastEnterRect;
  lastEnterRect = null;
  if (rect) {
    shrinkToRect(screen, rect).then(() => showHome({ celebrate }));
  } else {
    showHome({ celebrate });
  }
}

// Une session ne retombe pas directement sur l'accueil : elle passe par le bilan, qui est
// la seule sortie (ou le raccourci vers la révision du jour). `mightCompleteDay` : posé au
// moment où la séance démarre, selon que l'autre file (celle que cette séance ne touche pas)
// était déjà vide — seule une séance de découverte ou de révision peut boucler la journée.
function finishSession(tally, mightCompleteDay) {
  renderSessionRecap(screen, tally, {
    onHome: () => goHome(mightCompleteDay),
    // Raccourci interne (pas parti d'une tuile) : pas de tuile d'origine à faire grossir pour
    // cette nouvelle séance, on n'anime donc pas son entrée.
    onReview: (session) => runMode(renderReviewMode, { reviewItems: session.reviewItems }),
  });
}

function runMode(renderMode, payload, mightCompleteDay = false, enterRect = null) {
  startSessionChrome();
  lastEnterRect = enterRect;
  renderMode(screen, payload, { onComplete: (tally) => finishSession(tally, mightCompleteDay), onExit: () => goHome(false) });
  if (enterRect) growFromRect(screen, enterRect);
}

function showHome({ celebrate = false } = {}) {
  setActiveNav('nav-home');
  renderHome(screen, {
    celebrate,
    onStartHard: (session, rect) => runMode(renderHardMode, { hardItems: session.hardItems }, false, rect),
    onStartLearning: (session, rect) => runMode(renderLearningMode, { newItems: session.newItems }, session.reviewItems.length === 0, rect),
    onStartReview: (session, rect) => runMode(renderReviewMode, { reviewItems: session.reviewItems }, session.newItems.length === 0, rect),
    onStartFailedWords: (failedWords, rect) => runMode(renderFailedWordsMode, { failedWords }, false, rect),
  });
}

function showSettings() {
  setActiveNav('nav-settings');
  renderSettings(screen);
}

function showProgress() {
  setActiveNav('nav-progress');
  renderProgress(screen);
}

async function main() {
  await initDb();
  await rotateInternalBackup();

  app.innerHTML = '';
  app.appendChild(screen);
  app.appendChild(nav);

  nav.querySelector('#nav-home').addEventListener('click', showHome);
  nav.querySelector('#nav-progress').addEventListener('click', showProgress);
  nav.querySelector('#nav-settings').addEventListener('click', showSettings);

  showHome();
}

main();
