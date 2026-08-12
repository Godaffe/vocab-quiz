import './style.css';

const app = document.getElementById('app');
app.innerHTML = `
  <h1>Vocab Quiz</h1>
  <p>Coquille PWA installée avec succès. La logique de l'application arrive dans les prochaines étapes.</p>
`;

if ('storage' in navigator && 'persist' in navigator.storage) {
  navigator.storage.persist();
}
