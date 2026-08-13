import './style.css';
import { initDb } from './db.js';
import { rotateInternalBackup } from './backup.js';
import {
  renderHome, renderHardMode, renderLearningMode, renderReviewMode,
  renderFailedWordsMode, renderSettings, renderProgress,
} from './ui.js';

if ('storage' in navigator && 'persist' in navigator.storage) {
  navigator.storage.persist();
}

const app = document.getElementById('app');
const screen = document.createElement('div');
screen.id = 'screen';
const nav = document.createElement('nav');
nav.className = 'bottom-nav';
nav.innerHTML = `
  <button id="nav-home" aria-label="Accueil">🏠</button>
  <button id="nav-progress" aria-label="Statistiques">📊</button>
  <button id="nav-settings" aria-label="Réglages">⚙️</button>
`;

function setActiveNav(id) {
  nav.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.id === id));
}

function showHome() {
  setActiveNav('nav-home');
  renderHome(screen, {
    onStartHard: (session) => renderHardMode(screen, { hardItems: session.hardItems }, { onComplete: showHome, onExit: showHome }),
    onStartLearning: (session) => renderLearningMode(screen, { newItems: session.newItems }, { onComplete: showHome, onExit: showHome }),
    onStartReview: (session) => renderReviewMode(screen, { reviewItems: session.reviewItems }, { onComplete: showHome, onExit: showHome }),
    onStartFailedWords: (failedWords) => renderFailedWordsMode(screen, { failedWords }, { onComplete: showHome, onExit: showHome }),
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
