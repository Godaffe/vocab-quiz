import { spawnShards } from './card.js';

// --- Journal des déplacements ----------------------------------------------

// Un mot qui change de catégorie pendant une séance laisse ici une trace « d'où → vers où »,
// que l'accueil consomme au retour pour animer le transfert. Le journal vit en mémoire vive
// seulement : un rechargement de l'appli repart d'un accueil calme, sans rejouer un passé
// dont on ne sait plus s'il vient d'être vécu.
const pending = [];

// Les prédicats ci-dessous rejouent, sur une ligne de progress, l'appartenance à chaque
// section de l'accueil. Ils doivent rester le miroir exact des requêtes de leitner.js
// (getFailedWordsPool, getHardModeItems, getInProgressCount, getLearnedCount) : c'est la
// comparaison avant/après qui décide des trajets, pas une relecture des règles Leitner.
const isHard = (r) => r.learning_process === 'hard';
const isLearned = (r) => !!r.is_learned;
const isInProgress = (r) => r.total_reviews > 0 && !isLearned(r);
const isFailed = (r) => r.learning_process === 'normal' && r.box_level === 0
  && r.total_reviews > 0 && !isLearned(r) && r.last_result === 'incorrect';

// La section de départ est la tuile d'où l'on est parti, pas une déduction sur l'état d'avant :
// c'est celle que l'utilisateur a touchée, donc celle qu'il s'attend à voir se vider.
const SOURCE_BY_KIND = { learning: 'new', review: 'review', failed: 'failed', hard: 'tricky' };

export function noteOutcome(kind, before, after) {
  const from = SOURCE_BY_KIND[kind];
  if (!from || !before || !after) return;
  if (isHard(after) && !isHard(before)) pending.push({ from, to: 'tricky' });
  // Un mot qui vient d'être appris quitte le compteur « en cours » pour celui des « appris » :
  // le trajet relie les deux pastilles du haut, pas la tuile de la séance — c'est le transfert
  // entre les deux compteurs qui se voit.
  if (isLearned(after) && !isLearned(before)) pending.push({ from: 'inprogress', to: 'learned' });
  else if (isInProgress(after) && !isInProgress(before)) pending.push({ from, to: 'inprogress' });
  if (isFailed(after) && !isFailed(before)) pending.push({ from, to: 'failed' });
  else if (isFailed(before) && !isFailed(after)) pending.push({ from: 'failed', to: 'release' });
}

// Sortie du mode compliqué : le mot ne rejoint aucune section aujourd'hui (il revient en
// découverte un jour suivant), sa particule est donc une libération — elle s'élève et éclate.
export function noteRelease(from) {
  pending.push({ from, to: 'release' });
}

export function takeMoves() {
  return pending.splice(0, pending.length);
}

export function forgetMoves() {
  pending.length = 0;
}

// --- Chorégraphie ----------------------------------------------------------

const FLIGHT_MS = 460;   // durée d'un vol d'une section à l'autre
const ARRIVAL_AT = 0.86; // instant (en fraction du vol) où la particule touche sa cible
const RISE_MS = 520;     // durée de la montée d'une libération, avant l'éclat
const POP_MS = 200;      // contraction du départ / gonflement de l'arrivée
const ROUTE_GAP = 120;   // chevauchement entre deux trajets successifs
const MAX_PARTICLES = 6; // au-delà, le chiffre dit le nombre, les particules disent le trajet

// Ordre du récit : d'abord ce qui régresse (un mot tombe dans les ratés, un mot part en
// compliqué), puis les libérations, puis les progressions vers les deux compteurs du haut,
// qui closent la séquence. Tout trajet non listé passe à la fin.
const ROUTE_ORDER = [
  'new>failed', 'review>failed',
  'new>tricky', 'review>tricky',
  'failed>release', 'tricky>release',
  'new>inprogress', 'review>inprogress', 'failed>inprogress',
  'inprogress>learned',
];

const SECTION_COLOR = {
  new: 'var(--cat-new)',
  review: 'var(--cat-review)',
  tricky: 'var(--cat-tricky)',
  failed: 'var(--cat-failed)',
  inprogress: 'var(--copper-500)',
  learned: 'var(--green-500)',
  release: 'var(--gold-400)',
};

// Trajets qui retirent réellement le mot de leur section de départ : eux seuls font décroître
// son chiffre au décollage. Une révision réussie vide aussi la tuile « à réviser », mais sans
// particule — ce chiffre-là descend en continu, indépendamment des vols.
const SHEDDING_ROUTES = new Set(['failed>release', 'tricky>release', 'inprogress>learned']);

// Couronne d'éclats de la libération : huit traits en étoile autour du point d'explosion.
const RELEASE_SHARDS = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2;
  return {
    x: 50 + Math.sin(a) * 50,
    y: 50 - Math.cos(a) * 50,
    dist: i % 2 ? 34 : 50,
    len: i % 2 ? 8 : 11,
    width: 2.5,
    delay: i % 2 ? 40 : 0,
  };
});
const BURST_BOX = 34;

function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

// Vol en arc : une quadratique dont le point de contrôle est le milieu remonté, échantillonnée
// en pas réguliers d'une progression déjà adoucie — la particule accélère puis ralentit le long
// de sa courbe, plutôt que de suivre une droite à vitesse constante.
function arcFrames(from, to) {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const lift = Math.min(96, Math.max(26, dist * 0.3));
  const cx = (from.x + to.x) / 2;
  const cy = (from.y + to.y) / 2 - lift;
  const steps = 18;
  const frames = [];
  for (let i = 0; i <= steps; i++) {
    const p = i / steps;
    const t = easeInOut(p);
    const mt = 1 - t;
    const x = mt * mt * from.x + 2 * mt * t * cx + t * t * to.x;
    const y = mt * mt * from.y + 2 * mt * t * cy + t * t * to.y;
    // Naissance rapide, croisière, puis absorption dans la section d'arrivée.
    const scale = p < 0.16 ? 0.3 + (p / 0.16) * 0.8
      : p > ARRIVAL_AT ? 1.1 - ((p - ARRIVAL_AT) / (1 - ARRIVAL_AT)) * 0.8 : 1.1;
    const opacity = p < 0.1 ? p / 0.1
      : p > ARRIVAL_AT ? 1 - (p - ARRIVAL_AT) / (1 - ARRIVAL_AT) : 1;
    frames.push({ offset: p, transform: `translate3d(${x}px,${y}px,0) scale(${scale})`, opacity, easing: 'linear' });
  }
  return frames;
}

// Libération : montée verticale qui ralentit, la particule s'effaçant juste au moment où
// l'éclat prend le relais à son point d'arrêt.
function riseFrames(from, height) {
  const steps = 12;
  const frames = [];
  for (let i = 0; i <= steps; i++) {
    const p = i / steps;
    const t = 1 - (1 - p) ** 3;
    const y = from.y - height * t;
    const scale = p < 0.16 ? 0.3 + (p / 0.16) * 0.8 : p > 0.8 ? 1.1 - ((p - 0.8) / 0.2) * 0.8 : 1.1;
    const opacity = p < 0.1 ? p / 0.1 : p > 0.8 ? 1 - (p - 0.8) / 0.2 : 1;
    frames.push({ offset: p, transform: `translate3d(${from.x}px,${y}px,0) scale(${scale})`, opacity, easing: 'linear' });
  }
  return frames;
}

function groupRoutes(moves) {
  const counts = new Map();
  for (const m of moves) {
    const key = `${m.from}>${m.to}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const rank = (key) => {
    const i = ROUTE_ORDER.indexOf(key);
    return i === -1 ? ROUTE_ORDER.length : i;
  };
  return [...counts.entries()]
    .map(([key, n]) => ({ key, from: key.slice(0, key.indexOf('>')), to: key.slice(key.indexOf('>') + 1), n }))
    .sort((a, b) => rank(a.key) - rank(b.key));
}

// Répartit un écart de valeur sur `total` instants : le dernier tombe toujours pile sur la
// valeur finale, quel que soit le nombre de particules réellement envoyées.
function stepValue(from, to, index, total) {
  return Math.round(from + ((to - from) * (index + 1)) / total);
}

/**
 * Joue les déplacements sur l'accueil déjà rendu à ses valeurs d'avant la séance.
 * `plan` est fourni par l'accueil, seul à savoir où sont ses sections et comment poser une
 * valeur dessus :
 *   el(id)             -> la boîte à contracter/gonfler
 *   point(id)          -> { x, y } d'où partent / où arrivent les particules
 *   setValue(id, v, p) -> pose la valeur v (p = avancement 0→1 vers la valeur finale)
 *   values             -> { [id]: { from, to } }
 *   finalize()         -> repose l'accueil dans son état final complet
 * La promesse est tenue une fois l'accueil final en place — un tap sur l'écran y coupe court.
 */
export function playHomeMoves(moves, plan) {
  return new Promise((resolve) => {
    const layer = document.createElement('div');
    layer.className = 'mv-layer';
    document.body.appendChild(layer);

    const timers = [];
    const anims = [];
    let settled = false;
    const at = (ms, fn) => { timers.push(setTimeout(fn, Math.max(0, Math.round(ms)))); };

    const finish = () => {
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout);
      anims.forEach((a) => a.cancel());
      layer.remove();
      plan.finalize();
      resolve();
    };
    // Un tap n'annule pas le résultat, il le pose : toutes les valeurs sautent à leur état
    // final et l'accueil redevient immédiatement manipulable.
    layer.addEventListener('pointerdown', finish);

    const routes = groupRoutes(moves)
      .filter((r) => plan.point(r.from) && (r.to === 'release' || plan.point(r.to)));
    if (routes.length === 0) { finish(); return; }

    const grandTotal = routes.reduce((sum, r) => sum + Math.min(MAX_PARTICLES, r.n), 0);
    const stagger = grandTotal > 18 ? 45 : 60;

    // Calendrier des décollages, trajet après trajet, avec un léger chevauchement.
    const launches = [];
    let cursor = 0;
    for (const route of routes) {
      const count = Math.min(MAX_PARTICLES, route.n);
      for (let i = 0; i < count; i++) launches.push({ t: cursor + i * stagger, route });
      cursor += (count - 1) * stagger + ROUTE_GAP;
    }
    const lastLanding = launches.reduce(
      (max, l) => Math.max(max, l.t + (l.route.to === 'release' ? RISE_MS : FLIGHT_MS)),
      0
    );

    // Registre des instants où chaque section voit son chiffre bouger : une arrivée le fait
    // monter, un décollage « qui retire » le fait descendre. Les sections sans aucun de ces
    // instants (à réviser, découverte) voient le leur défiler en continu à côté des vols.
    const ledger = new Map();
    const mark = (id, t) => {
      if (!plan.values[id]) return;
      if (!ledger.has(id)) ledger.set(id, []);
      ledger.get(id).push(t);
    };
    for (const l of launches) {
      if (l.route.to !== 'release') mark(l.route.to, l.t + FLIGHT_MS * ARRIVAL_AT);
      if (SHEDDING_ROUTES.has(l.route.key)) mark(l.route.from, l.t + 80);
    }

    for (const [id, times] of ledger) {
      const { from, to } = plan.values[id];
      times.sort((a, b) => a - b).forEach((t, i) => {
        at(t, () => plan.setValue(id, stepValue(from, to, i, times.length), (i + 1) / times.length));
      });
    }
    // Défilement continu pour tout le reste : la tuile « à réviser » se vide et sa barre
    // avance pendant que les particules volent, sans se caler sur aucune d'elles.
    for (const [id, { from, to }] of Object.entries(plan.values)) {
      if (ledger.has(id) || from === to) continue;
      const steps = Math.min(24, Math.abs(to - from));
      for (let i = 0; i < steps; i++) {
        at(((i + 1) / steps) * lastLanding, () => plan.setValue(id, stepValue(from, to, i, steps), (i + 1) / steps));
      }
    }

    const pop = (id, cls) => {
      const el = plan.el(id);
      if (!el) return;
      el.classList.remove(cls);
      void el.offsetWidth;
      el.classList.add(cls);
      at(POP_MS + 20, () => el.classList.remove(cls));
    };

    for (const l of launches) {
      at(l.t, () => {
        const from = plan.point(l.route.from);
        const to = l.route.to === 'release' ? null : plan.point(l.route.to);
        if (!from || (l.route.to !== 'release' && !to)) return;
        pop(l.route.from, 'mv-shrink');

        const card = document.createElement('span');
        card.className = 'mv-card';
        card.style.background = SECTION_COLOR[l.route.to] ?? SECTION_COLOR.release;
        layer.appendChild(card);

        if (l.route.to === 'release') {
          const height = Math.min(96, Math.max(40, from.y - 24));
          anims.push(card.animate(riseFrames(from, height), { duration: RISE_MS, easing: 'linear', fill: 'forwards' }));
          at(l.t + RISE_MS * 0.78, () => {
            const host = document.createElement('span');
            host.className = 'eclat-host mv-burst';
            host.style.left = `${from.x - BURST_BOX / 2}px`;
            host.style.top = `${from.y - height - BURST_BOX / 2}px`;
            layer.appendChild(host);
            spawnShards(host, RELEASE_SHARDS, SECTION_COLOR.release, BURST_BOX, BURST_BOX, 1);
            at(l.t + RISE_MS + 700, () => host.remove());
          });
          at(l.t + RISE_MS + 40, () => card.remove());
          return;
        }

        anims.push(card.animate(arcFrames(from, to), { duration: FLIGHT_MS, easing: 'linear', fill: 'forwards' }));
        at(l.t + FLIGHT_MS * ARRIVAL_AT, () => pop(l.route.to, 'mv-swell'));
        at(l.t + FLIGHT_MS + 40, () => card.remove());
      });
    }

    at(lastLanding + 140, finish);
  });
}
