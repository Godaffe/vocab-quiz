// Briques des écrans de session : en-tête, pile de cartes, carte à retournement, carte
// question, carte résultat. Chaque fonction rend du HTML ; les gestes sont câblés à part.

import { icon } from './icons.js';

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// --- en-tête de session ------------------------------------------------------
// Quitter à gauche, compteur au centre, emplacement libre à droite (badge de phase),
// puis la barre de progression sur toute la largeur.
export function sessionHeaderHtml({ index, total, phase = 1, right = '' }) {
  const pct = total > 0 ? Math.max(0, Math.min(100, ((index - 1) / total) * 100)) : 0;
  return `
    <div class="ds-sessionbar">
      <button id="exit-btn" class="ds-exit" aria-label="Quitter la session">✕</button>
      <span class="ds-counter" id="mode-counter">${total > 0 ? `${index} / ${total}` : ''}</span>
      <span class="ds-sessionbar__right" id="mode-right">${right}</span>
    </div>
    <div class="session-progress">
      <div class="ds-progress" role="progressbar" aria-valuenow="${index - 1}" aria-valuemin="0" aria-valuemax="${total}">
        <div class="ds-progress__fill${phase === 2 ? ' ds-progress__fill--phase2' : ''}" id="mode-progress" style="width:${pct}%"></div>
      </div>
    </div>
  `;
}

// --- pile de cartes ----------------------------------------------------------
// Profondeur de la file derrière la carte vivante : discrète, par pas de 8 px, filet seul.
export function cardStackHtml(remaining, innerHtml, { stretch = false } = {}) {
  const under = Math.max(0, Math.min(3, remaining));
  const layers = Array.from({ length: under }, (_, i) => {
    const d = under - i;
    return `<div class="ds-stack__under" style="transform:translateY(${d * 8}px) scale(${1 - d * 0.025});opacity:${1 - d * 0.25}"></div>`;
  }).join('');
  const stack = stretch ? ' style="flex:1;min-height:0"' : '';
  return `<div class="ds-stack"${stack}>${layers}<div class="ds-stack__live">${innerHtml}</div></div>`;
}

// --- carte découverte --------------------------------------------------------
// Recto : le mot à apprendre, son type et son exemple. Verso : la traduction, et le
// contexte s'il désambiguë cette traduction précise (jamais sur le recto : il annote le
// mot français, pas le mot anglais qu'on introduit).
export function flipCardHtml({ word, pos, example, translation, context, foot }) {
  return `
    <div class="ds-flip" id="flip-card">
      <div class="ds-flip__inner">
        <div class="ds-flip__face ds-flip__face--front">
          <span class="ds-prompt">Nouveau mot</span>
          <div class="ds-word ds-word--lg">${escapeHtml(word)}</div>
          ${pos ? `<span class="ds-pos">${escapeHtml(pos)}</span>` : ''}
          ${example ? `<div class="ds-example">${escapeHtml(example)}</div>` : ''}
          <div class="ds-flip__foot">${escapeHtml(foot)}</div>
        </div>
        <div class="ds-flip__face ds-flip__face--back">
          <span class="ds-prompt">Traduction</span>
          <div class="ds-word ds-word--lg">${escapeHtml(translation)}</div>
          ${context ? `<div class="ds-context">(${escapeHtml(context)})</div>` : ''}
          <div class="ds-flip__foot">${escapeHtml(foot)}</div>
        </div>
      </div>
    </div>
  `;
}

// --- carte question ----------------------------------------------------------
// Le contexte (ex. « au four ») ne s'affiche que sous le mot posé en question : il
// désambiguë ce qui est demandé, il n'est jamais attendu dans la réponse tapée.
export function questionCardHtml({ instruction, question, badge = '', hint = '', slot = '', context = '', retry = false, retryLabel = 'Deuxième tentative' }) {
  return `
    <div class="ds-qcard${retry ? ' ds-qcard--retry' : ''}">
      <div class="ds-qcard__head">
        <span class="ds-prompt">${escapeHtml(retry ? retryLabel : instruction)}</span>
        ${badge}
      </div>
      <div class="ds-word" style="text-align:center">${escapeHtml(question)}</div>
      ${context ? `<div class="ds-context">(${escapeHtml(context)})</div>` : ''}
      ${hint ? `<div class="ds-qcard__hint">${hint}</div>` : ''}
      ${slot ? `<div class="ds-qcard__slot">${slot}</div>` : ''}
    </div>
  `;
}

export function answerFieldHtml({ placeholder = 'Ta réponse' } = {}) {
  // enterkeyhint="go" : iOS remplace la touche « retour » par une touche d'action colorée,
  // ce qui permet de valider sans jamais quitter le clavier.
  return `<input type="text" id="answer-input" class="ds-field" placeholder="${escapeHtml(placeholder)}"
    autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"
    enterkeyhint="go" inputmode="text" />`;
}

// Indice masqué : chaque mot montre sa première et sa dernière lettre, le reste devient des
// créneaux de largeur fixe — la coupure entre les mots reste visible sans compter les
// caractères. Un mot de 2 lettres ou moins s'affiche en entier (première = dernière sinon).
export function hintMaskHtml(answer) {
  const words = String(answer).split(/\s+/).map((w) => {
    const chars = w.split('');
    const slots = chars.map((ch, i) => {
      const show = chars.length <= 2 || i === 0 || i === chars.length - 1;
      return `<span class="ds-hint__slot${show ? ' ds-hint__slot--shown' : ''}">${show ? escapeHtml(ch) : ''}</span>`;
    }).join('');
    return `<span class="ds-hint__word">${slots}</span>`;
  }).join('');
  return `<div class="ds-hint">${words}</div>`;
}

// --- carte résultat ----------------------------------------------------------
// Trois temps de lecture : la bande + le disque (juste ou faux), la réponse attendue en
// plus gros que tout le reste, puis la traduction et l'exemple en blocs distincts. Le
// contexte, quand fourni, précise la traduction juste sous elle — l'appelant ne le passe
// que sur une réponse fausse, pour ne pas répéter ce qui vient déjà d'être vu en question.
export function resultCardHtml({ correct, answer, pos, translation, context, example }) {
  const deep = correct ? 'var(--green-600)' : 'var(--crimson-600)';
  const mid = correct ? 'var(--green-500)' : 'var(--crimson-500)';
  const soft = correct ? 'var(--green-50)' : 'var(--crimson-50)';
  const line = correct ? 'var(--green-100)' : 'var(--crimson-100)';
  const mark = icon(correct ? 'check' : 'x', { size: 30, color: '#fff', stroke: 3.4 });

  return `
    <div class="ds-result" id="result-card">
      <div class="ds-result__band" style="background:${mid}"></div>
      <div class="ds-result__head" style="background:${soft};border-bottom-color:${line}">
        <span class="ds-verdict ds-verdict--${correct ? 'correct' : 'wrong'}">${mark}</span>
        <div class="ds-result__headtext">
          <div class="ds-result__verdictlabel" style="color:${deep}">${correct ? 'Correct' : 'Réponse attendue'}</div>
          <div class="ds-result__answer">${escapeHtml(answer)}</div>
          ${pos ? `<span class="ds-pos">${escapeHtml(pos)}</span>` : ''}
        </div>
      </div>
      ${translation ? `
        <div class="ds-result__translation" style="background:${deep}">
          <div class="ds-result__blocklabel">Traduction</div>
          <div class="ds-result__blockvalue">${escapeHtml(translation)}</div>
          ${context ? `<div class="ds-context">(${escapeHtml(context)})</div>` : ''}
        </div>` : ''}
      ${example ? `
        <div class="ds-result__example" style="border-left-color:${mid}">
          <div class="ds-result__blocklabel">Exemple / règle</div>
          <div class="ds-result__blockvalue">${escapeHtml(example)}</div>
        </div>` : ''}
    </div>
  `;
}

// Ligne de conséquence Leitner, sous la carte ratée : la réponse fausse barrée, puis le
// niveau (ou la phase, ou le mode) avant/après en pastilles reliées par une flèche. Quand
// rien ne change (entraînement libre), la paire de pastilles est simplement omise.
export function consequenceHtml({ wrongAnswer, before, after }) {
  // Rien à montrer (entraînement libre, déjà au plancher, plafond du jour) : pas de carton
  // vide avec juste l'icône.
  if (!wrongAnswer && !(before && after)) return '';
  const typed = wrongAnswer
    ? `<span class="consequence__wrong">${escapeHtml(wrongAnswer)}</span>`
    : '';
  const transition = before && after ? `
    <div class="consequence__levels">
      <span class="consequence__level">${escapeHtml(before)}</span>
      ${icon('arrow-right', { size: 15, color: 'var(--crimson-700)', stroke: 2.4 })}
      <span class="consequence__level consequence__level--after">${escapeHtml(after)}</span>
    </div>` : '';
  return `
    <div class="consequence">
      <div class="consequence__answer">${icon('triangle-alert', { size: 17, color: '#C4123A' })}${typed}</div>
      ${transition}
    </div>
  `;
}

// --- pastille de stat ---------------------------------------------------------
// Pile à trois couches (deux liserés décalés en arrière-plan, le corps ink-500 au premier
// plan) : même mécanique visuelle pour la ligne de stats de l'accueil (icône + libellé sous
// le nombre) et le total du bilan (libellé à droite, sans icône).
export function statPillHtml({ variant = 'home', side = 'left', value, delta, deltaColor, label, glyph = '' }) {
  const peekClass = variant === 'recap' ? 'stat-pill--full' : side === 'right' ? 'stat-pill--right' : 'stat-pill--left';
  const deltaHtml = delta != null ? `<span class="stat-pill__delta" style="color:${deltaColor}">${escapeHtml(delta)}</span>` : '';
  const nums = `<div class="stat-pill__nums"><span class="stat-pill__n">${escapeHtml(value)}</span>${deltaHtml}</div>`;
  const body = variant === 'recap'
    ? `${nums}<span class="stat-pill__label">${escapeHtml(label)}</span>`
    : `<div class="stat-pill__row">${nums}<span class="stat-pill__glyph">${glyph}</span></div><span class="stat-pill__label">${escapeHtml(label)}</span>`;
  return `
    <div class="stat-pill stat-pill--${variant} ${peekClass}">
      <div class="stat-pill__peek stat-pill__peek--1"></div>
      <div class="stat-pill__peek stat-pill__peek--2"></div>
      <div class="stat-pill__body">${body}</div>
    </div>
  `;
}

// --- gestes ------------------------------------------------------------------

// Attache un clic « n'importe où sur la carte », en ignorant ceux qui arrivent juste après
// son affichage. Sans ce garde-fou, le clic tactile synthétisé par le navigateur après le
// tap précédent retombe sur la carte fraîchement rendue et la valide toute seule — on
// enchaînerait alors plusieurs cartes d'un seul tap.
const GHOST_CLICK_MS = 400;

export function onCardTap(card, handler) {
  const renderedAt = Date.now();
  card.addEventListener('click', (e) => {
    if (Date.now() - renderedAt < GHOST_CLICK_MS) return;
    handler(e);
  });
}

// Détection de glissement au pointeur. Chaque action déclenchable au geste reste
// atteignable autrement (bouton ou tap), le geste n'est qu'un raccourci.
export function onSwipe(el, { onLeft, onRight, onUp } = {}) {
  const threshold = 60;
  let startX = 0;
  let startY = 0;
  let tracking = false;

  el.addEventListener('pointerdown', (e) => {
    // Un champ de saisie garde son geste natif (sélection de texte) : un glissement qui y
    // commence ne doit jamais être confondu avec une action de carte.
    if (e.target.closest('input, textarea, button')) return;
    tracking = true;
    startX = e.clientX;
    startY = e.clientY;
  });

  el.addEventListener('pointerup', (e) => {
    if (!tracking) return;
    tracking = false;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > threshold) {
      if (dx < 0) onLeft?.();
      else onRight?.();
    } else if (dy < -threshold && Math.abs(dy) > Math.abs(dx)) {
      onUp?.();
    }
  });
}
