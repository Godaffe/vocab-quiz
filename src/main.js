import './style.css';
import { initDb } from './db.js';
import { renderImport, renderHome, renderQuiz } from './ui.js';

if ('storage' in navigator && 'persist' in navigator.storage) {
  navigator.storage.persist();
}

const app = document.getElementById('app');
const nav = document.createElement('nav');
nav.innerHTML = `
  <button id="nav-home">Accueil</button>
  <button id="nav-import">Importer</button>
`;
const screen = document.createElement('div');
screen.id = 'screen';

function showHome() {
  renderHome(screen, { onStartSession: showQuiz });
}

function showImport() {
  renderImport(screen);
}

function showQuiz(session) {
  renderQuiz(screen, session, { onComplete: showHome });
}

async function main() {
  await initDb();

  app.innerHTML = '';
  app.appendChild(nav);
  app.appendChild(screen);

  nav.querySelector('#nav-home').addEventListener('click', showHome);
  nav.querySelector('#nav-import').addEventListener('click', showImport);

  showHome();
}

main();
