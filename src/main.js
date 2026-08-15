import './style.css';
import { initDb } from './db.js';
import { rotateInternalBackup } from './backup.js';
import { icon } from './icons.js';
import {
  renderHome, renderHardMode, renderLearningMode, renderReviewMode,
  renderFailedWordsMode, renderSettings, renderProgress, renderSessionRecap,
} from './ui.js';

if ('storage' in navigator && 'persist' in navigator.storage) {
  navigator.storage.persist();
}

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
  document.body.classList.remove('in-session');
  setStatusBar(false);
  nav.querySelectorAll('button').forEach((b) => b.classList.toggle('ds-tab--active', b.id === id));
}

function startSessionChrome() {
  document.body.classList.add('in-session');
  setStatusBar(true);
}

// Une session ne retombe pas directement sur l'accueil : elle passe par le bilan, qui est
// la seule sortie (ou le raccourci vers la révision du jour).
function finishSession(tally) {
  renderSessionRecap(screen, tally, {
    onHome: showHome,
    onReview: (session) => runMode(renderReviewMode, { reviewItems: session.reviewItems }),
  });
}

function runMode(renderMode, payload) {
  startSessionChrome();
  renderMode(screen, payload, { onComplete: finishSession, onExit: showHome });
}

function showHome() {
  setActiveNav('nav-home');
  renderHome(screen, {
    onStartHard: (session) => runMode(renderHardMode, { hardItems: session.hardItems }),
    onStartLearning: (session) => runMode(renderLearningMode, { newItems: session.newItems }),
    onStartReview: (session) => runMode(renderReviewMode, { reviewItems: session.reviewItems }),
    onStartFailedWords: (failedWords) => runMode(renderFailedWordsMode, { failedWords }),
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
