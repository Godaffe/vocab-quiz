import './style.css';
import { initDb } from './db.js';
import { rotateInternalBackup } from './backup.js';
import {
  renderImport, renderHome, renderHardMode, renderLearningMode, renderReviewMode,
  renderFailedWordsMode, renderSettings, renderProgress,
} from './ui.js';

if ('storage' in navigator && 'persist' in navigator.storage) {
  navigator.storage.persist();
}

const app = document.getElementById('app');
const nav = document.createElement('nav');
nav.innerHTML = `
  <button id="nav-home">Accueil</button>
  <button id="nav-import">Importer</button>
  <button id="nav-progress">Progression</button>
  <button id="nav-settings">Réglages</button>
`;
const screen = document.createElement('div');
screen.id = 'screen';

function showHome() {
  renderHome(screen, {
    onStartHard: (session) => renderHardMode(screen, { hardItems: session.hardItems }, { onComplete: showHome, onExit: showHome }),
    onStartLearning: (session) => renderLearningMode(screen, { newItems: session.newItems }, { onComplete: showHome, onExit: showHome }),
    onStartReview: (session) => renderReviewMode(screen, { reviewItems: session.reviewItems }, { onComplete: showHome, onExit: showHome }),
    onStartFailedWords: (failedWords) => renderFailedWordsMode(screen, { failedWords }, { onComplete: showHome, onExit: showHome }),
  });
}

function showImport() {
  renderImport(screen);
}

function showSettings() {
  renderSettings(screen);
}

function showProgress() {
  renderProgress(screen);
}

async function main() {
  await initDb();
  await rotateInternalBackup();

  app.innerHTML = '';
  app.appendChild(nav);
  app.appendChild(screen);

  nav.querySelector('#nav-home').addEventListener('click', showHome);
  nav.querySelector('#nav-import').addEventListener('click', showImport);
  nav.querySelector('#nav-progress').addEventListener('click', showProgress);
  nav.querySelector('#nav-settings').addEventListener('click', showSettings);

  showHome();
}

main();
