import './style.css';
import { initDb } from './db.js';
import { rotateInternalBackup } from './backup.js';
import { renderImport, renderHome, renderQuiz, renderSettings, renderProgress } from './ui.js';

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
  renderHome(screen, { onStartSession: showQuiz });
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

function showQuiz(session) {
  renderQuiz(screen, session, { onComplete: showHome });
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
