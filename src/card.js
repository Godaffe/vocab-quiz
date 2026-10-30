// Briques des écrans de session : en-tête, pile de cartes, carte à retournement, carte
// question, carte résultat. Chaque fonction rend du HTML ; les gestes sont câblés à part.

import { icon } from './icons.js';

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// --- en-tête de session ------------------------------------------------------
// Quitter à gauche, compteur au centre, emplacement libre à droite (badge de phase), puis un
// emplacement de progression que renderModeShell remplace entièrement à chaque question — barre
// classique ou points, voir barHtml / dotsProgressHtml.
export function sessionHeaderHtml() {
  return `
    <div class="ds-sessionbar">
      <button id="exit-btn" class="ds-exit" aria-label="Quitter la session">✕</button>
      <span class="ds-counter" id="mode-counter"></span>
      <span class="ds-sessionbar__right" id="mode-right"></span>
    </div>
    <div class="session-progress" id="progress-slot"></div>
  `;
}

// Barre classique : remplissage plein en question, rayé en lecture (deux passages d'une même
// session, jamais les deux traitements à la fois).
export function barHtml(index, total, phase) {
  const pct = total > 0 ? Math.round((index / total) * 100) : 0;
  return `
    <div class="ds-progress" role="progressbar" aria-valuenow="${index}" aria-valuemin="0" aria-valuemax="${total}">
      <div class="ds-progress__fill${phase === 'discover' ? ' ds-progress__fill--phase2' : ''}" style="width:${pct}%"></div>
    </div>
  `;
}

// Points : un par question, colorés par ce qui leur est réellement arrivé — jamais recalculés
// depuis la position courante seule. `results[i]` est `true` (juste du premier coup), `false`
// (raté — reste rouge même si corrigé à une redemande, seule la 1ère tentative compte pour la
// note Leitner) ou `null` (pas encore atteint). Réservé aux sessions ≤ 20 questions : au-delà,
// la barre classique reste plus lisible qu'un mur de points.
export function dotsProgressHtml(total, results, currentIndex) {
  const dots = Array.from({ length: total }, (_, i) => {
    let cls = 'ds-dot';
    if (i === currentIndex) cls += ' ds-dot--current';
    else if (results[i] === true) cls += ' ds-dot--done';
    else if (results[i] === false) cls += ' ds-dot--wrong';
    return `<span class="${cls}"></span>`;
  }).join('');
  return `<div class="ds-dots">${dots}</div>`;
}

// --- pile de cartes ----------------------------------------------------------
// Profondeur de la file derrière la carte vivante : discrète, par pas de 8 px, filet seul.
export function cardStackHtml(remaining, innerHtml, { stretch = false } = {}) {
  const under = Math.max(0, Math.min(3, remaining));
  const layers = Array.from({ length: under }, (_, i) => {
    const d = under - i;
    return `<div class="ds-stack__under" data-depth="${d}" style="transform:translateY(${d * 8}px) scale(${1 - d * 0.025});opacity:${1 - d * 0.25}"></div>`;
  }).join('');
  const stack = stretch ? ' style="flex:1;min-height:0"' : '';
  return `<div class="ds-stack"${stack}>${layers}<div class="ds-stack__live">${innerHtml}</div></div>`;
}

// --- carte découverte --------------------------------------------------------
// Recto : le mot à apprendre, son type et son registre. Verso : la traduction, le même type et
// registre, l'exemple (côté français, choix d'Anto du 26/10), puis sens et usage. Le mot est
// ancré au même niveau sur les deux faces (espaceur fixe en tête) ; sens/usage sont épinglés en
// bas via un espaceur élastique — jamais centrés au milieu, qui ferait flotter le mot à une
// hauteur différente selon ce que la carte a d'autre à montrer. Les deux faces partagent la
// même case de grille (voir .ds-flip__inner) : la carte prend la hauteur de la plus haute, rien
// ne déborde ni ne se superpose.
// Mot allemand de la carte découverte sur plusieurs lignes (choix d'Anto du 27/10/2026) : le mot
// en noir (infinitif, ou nom avec son article), puis en dessous, plus petits, la 3e personne
// irrégulière et le pluriel en gris, les formes du verbe fort en orange foncé. Le mot seul
// décide de sa taille : il ne rétrécit plus à cause des formes écrites à côté.
function wordLinesHtml(lines) {
  const [main, ...rest] = lines;
  return `<div class="ds-flip__wordlines">
              <div class="${wordSizeClass(main.text)}">${escapeHtml(main.text)}</div>
              ${rest.map((line) => `<div class="ds-flip__subline ds-flip__subline--${line.kind}">${escapeHtml(line.text)}</div>`).join('')}
            </div>`;
}

export function flipCardHtml({ word, wordLines, aux = [], pos, example, translation, registre, sens, usage, region, foot }) {
  // L'auxiliaire qualifie le verbe allemand : face allemande seulement (choix d'Anto du 30/10/2026).
  const tags = flipTagsHtml(pos, registre);
  const wordTags = (aux.length ? auxChipsHtml(aux, 'ds-auxchips--flip') : '') + tags;
  return `
    <div class="ds-flip" id="flip-card">
      <div class="ds-flip__inner">
        <div class="ds-flip__face ds-flip__face--front">
          <div class="ds-flip__spacer"></div>
          <div class="ds-flip__head">
            <span class="ds-prompt">Nouveau mot</span>
            ${wordLines ? wordLinesHtml(wordLines) : withRegion(`<div class="${wordSizeClass(word)}">${escapeHtml(word)}</div>`, region)}
            ${wordTags}
          </div>
          <div class="ds-flip__fill"></div>
          <div class="ds-flip__foot">${escapeHtml(foot)}</div>
        </div>
        <div class="ds-flip__face ds-flip__face--back">
          <div class="ds-flip__spacer"></div>
          <div class="ds-flip__head">
            <span class="ds-prompt">Traduction</span>
            <div class="${wordSizeClass(translation)}">${escapeHtml(translation)}</div>
            ${tags}
          </div>
          ${example ? `
          <div class="ds-example--tab">
            <span class="ds-example__tab">Exemple</span>
            <div class="ds-example__text">${exampleHtml(example)}</div>
          </div>` : ''}
          <div class="ds-flip__fill"></div>
          ${(sens || usage) ? `
          <div class="ds-flip__fields">
            ${sens ? fieldCardHtml('Sens', sens, 'sens') : ''}
            ${usage ? fieldCardHtml('Usage', usage, 'usage') : ''}
          </div>` : ''}
          <div class="ds-flip__foot">${escapeHtml(foot)}</div>
        </div>
      </div>
    </div>
  `;
}

// Type et registre qualifient le mot anglais : affichés à l'identique sur les deux faces,
// pour qu'ils restent sous les yeux une fois la carte retournée. Côte à côte sur une même
// ligne, en deux pastilles distinctes et sans libellé « Registre » (choix d'Anto du 26/10, pour
// gagner de la place) ; ils ne passent à la ligne que si l'écran est trop étroit.
function flipTagsHtml(pos, registre) {
  if (!pos && !registre) return '';
  return `<div class="ds-flip__tags">
              ${pos ? `<span class="ds-flip__pos">${escapeHtml(pos)}</span>` : ''}
              ${registre ? `<span class="ds-flip__registre">${escapeHtml(registre)}</span>` : ''}
            </div>`;
}

// Mention régionale (ex. « usa ») : un élément à part, collé à droite du mot anglais, jamais
// dans le texte du mot lui-même — elle n'entre ni dans sa taille (wordSizeClass), ni dans la
// vérification des réponses. Sans région, le mot est rendu tel quel, sans enveloppe.
function regionTagHtml(region, extraClass = '') {
  return `<span class="ds-region${extraClass ? ` ${extraClass}` : ''}">(${escapeHtml(region)})</span>`;
}

function withRegion(wordHtml, region) {
  if (!region) return wordHtml;
  return `<div class="ds-wordline">${wordHtml}${regionTagHtml(region)}</div>`;
}

// Taille du mot dégressive selon sa longueur : un mot ou une expression trop longue à 42px
// déborderait ou casserait la mise en page — 3 paliers plutôt qu'un seul rétrécissement
// continu, pour rester net à chaque taille plutôt que flou entre deux valeurs arbitraires.
function wordSizeClass(text) {
  const len = String(text ?? '').length;
  if (len > 22) return 'ds-word ds-word--sm';
  if (len > 14) return 'ds-word ds-word--md';
  return 'ds-word ds-word--lg';
}

// Carte Sens / Usage du verso : une pastille carrée porte le libellé, le texte suit à droite —
// deux teintes cuivre qui montent en intensité (sens, puis usage). Bascule sur une variante
// resserrée quand le texte est trop long pour respirer à 13px, pareil que le mot lui-même.
function fieldCardHtml(label, text, variant) {
  const compact = String(text ?? '').length > 90;
  return `
    <div class="ds-flip__field ds-flip__field--${variant}">
      <div class="ds-flip__fieldicon ds-flip__fieldicon--${variant}"><span class="ds-flip__fieldlabel ds-flip__fieldlabel--${variant}">${escapeHtml(label)}</span></div>
      <div class="ds-flip__fieldtext${compact ? ' ds-flip__fieldtext--sm' : ''}">${escapeHtml(variant === 'usage' ? usageLines(text) : text)}</div>
    </div>
  `;
}

// Exemples du classeur (colonne « Exemple en En ») : « **mot** » = gras en couleur (le mot
// appris), « __mot__ » = souligné (élément de la règle d'usage), combinables (« __**to**__ »).
// Les symboles disparaissent à l'affichage. Un exemple sans symbole reste du texte simple :
// l'appli ne devine plus le mot à mettre en gras (choix d'Anto du 13/10 : pas de gras plutôt
// qu'un gras faux). Un symbole resté ouvert agit jusqu'à la fin du texte.
export function exampleHtml(text) {
  let bold = false;
  let under = false;
  let html = '';
  for (const part of String(text ?? '').split(/(\*\*|__)/)) {
    if (part === '**') bold = !bold;
    else if (part === '__') under = !under;
    else if (part) {
      const cls = [bold && 'ds-result__hl', under && 'ds-result__ul'].filter(Boolean).join(' ');
      html += cls ? `<span class="${cls}">${escapeHtml(part)}</span>` : escapeHtml(part);
    }
  }
  return html;
}

export function answerFieldHtml({ placeholder = 'Ta réponse' } = {}) {
  // enterkeyhint="go" : iOS remplace la touche « retour » par une touche d'action colorée,
  // ce qui permet de valider sans jamais quitter le clavier.
  return `<input type="text" id="answer-input" class="ds-field" placeholder="${escapeHtml(placeholder)}"
    autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"
    enterkeyhint="go" inputmode="text" />`;
}

// --- carte à fusion : question → résultat ------------------------------------
// Un seul élément traverse toute la question : rien n'est remplacé. Voir le commentaire de
// bloc CSS « carte à fusion » dans style.css pour la mécanique des quatre temps (commit,
// trait si faux, morphose, dépli). Cette fonction ne rend que le squelette initial (phase
// « question ») ; runMorphCard (ci-dessous) pilote les classes d'état à la soumission.
export function morphCardHtml({
  instruction, question, badge = '', hint = '', retry = false, retryLabel = 'Deuxième tentative',
  answer = '', pos = '', translation = '', example = '', registre, sens, usage, sensHint = '',
  questionRegion = '', answerRegion = '', promptRegion = '', questionSentence = false, forms = '', chips = null, auxChips = [], auxQuiet = true,
  formsQuestion = false,
}) {
  return `
    <div class="ds-morph${retry ? ' ds-morph--retry' : ''}${formsQuestion ? ' ds-morph--formsq' : ''}" id="morph-card">
      <div class="ds-morph__band"></div>
      <div class="ds-morph__head">
        <div class="ds-morph__flood"></div>
        <div class="ds-morph__row">
          <span class="ds-morph__disc" id="m-disc"></span>
          <div class="ds-morph__col">
            <div class="ds-prompt ds-morph__label" id="m-label">${escapeHtml(retry ? retryLabel : instruction)}</div>
            ${badge}
            <div class="ds-morph__wordrows">
              <div class="ds-morph__wordclip">${withRegion(`<div class="ds-word ds-morph__word${questionSentence ? ' ds-morph__word--sentence' : ''}">${escapeHtml(question)}</div>`, questionRegion)}</div>
            </div>
            ${(pos || registre) ? `
            <div class="ds-morph__posrows">
              <div class="ds-morph__posclip" style="padding-top:8px">
                ${pos ? `<span class="ds-pos">${escapeHtml(pos)}</span>` : ''}
                ${registre ? `<span class="ds-pos ds-pos--registre">${escapeHtml(registre)}</span>` : ''}
              </div>
            </div>` : ''}
            ${hint ? `<div class="ds-qcard__hint">${hint}</div>` : ''}
            ${sensHint ? `<div class="ds-morph__senshint">${escapeHtml(sensHint)}</div>` : ''}
            ${promptRegion ? `<div class="ds-morph__regionhint">${regionTagHtml(promptRegion)}</div>` : ''}
            <div class="ds-morph__field" id="m-field">
              ${answerFieldHtml()}
              <span class="ds-morph__typedwrap">
                <span class="ds-morph__triedlabel">Ta réponse</span>
                <span class="ds-morph__typedinner">
                  <span class="ds-morph__typed" id="m-typed"></span>
                  <span class="ds-morph__strike"></span>
                </span>
                ${answerRegion ? regionTagHtml(answerRegion, 'ds-morph__typedregion') : ''}
              </span>
              <span class="ds-morph__fdisc" id="m-fdisc"></span>
            </div>
            <div class="ds-morph__answerrows">
              <div class="ds-morph__answerclip">${withRegion(`<div class="ds-result__answer" style="padding-top:6px">${escapeHtml(answer)}</div>`, answerRegion)}</div>
            </div>
            ${formsHtml(forms)}
            ${chips ? chipRowHtml(chips) : ''}
            ${auxChips.length ? auxChipsHtml(auxChips, `ds-morph__chips--static${auxQuiet ? ' ds-auxchips--quiet' : ''}`) : ''}
          </div>
        </div>
      </div>
      <div class="ds-morph__blocksrows">
        <div class="ds-morph__blocksclip">
          ${(translation || sens) ? `
          <div class="ds-result__translation" id="m-translation">
            ${translation ? `<div class="ds-result__blockvalue">${escapeHtml(translation)}</div>` : ''}
            ${sens ? `<div class="ds-result__sens">${escapeHtml(sens)}</div>` : ''}
          </div>` : ''}
          ${usage ? `
          <div class="ds-result__usage">
            <div class="ds-result__blockvalue">${escapeHtml(usageLines(usage))}</div>
          </div>` : ''}
          ${example ? `
          <div class="ds-result__example">
            <div class="ds-result__blockvalue">${exampleHtml(example)}</div>
          </div>` : ''}
        </div>
      </div>
    </div>
  `;
}

// Sous le mot de la correction : une chaîne (formes anglaises) ou, pour l'allemand, les lignes
// de la carte découverte (3e personne, formes du verbe fort, pluriel), même hiérarchie (choix
// d'Anto du 30/10/2026).
function formsHtml(forms) {
  if (!forms || !forms.length) return '';
  if (typeof forms === 'string') return `<div class="ds-morph__forms">${escapeHtml(forms)}</div>`;
  return forms.map((line) => `<div class="ds-morph__forms ds-morph__forms--${line.kind}">${escapeHtml(line.text)}</div>`).join('');
}

// Pastilles à choisir sous le champ de traduction allemande : article (der / die / das) ou
// auxiliaire du parfait (haben / sein). Choisies avant Valider, colorées au corrigé (morphCard).
function chipRowHtml({ options, multi, prefix }) {
  return `<div class="ds-morph__chips${prefix ? ' ds-morph__chips--prefix' : ''}" id="m-chips" role="${multi ? 'group' : 'radiogroup'}">
              ${options.map((option) => `<button type="button" class="ds-morph__chip" data-v="${escapeHtml(option)}"
                aria-pressed="false">${escapeHtml(option)}</button>`).join('')}
            </div>`;
}

// Auxiliaire d'un verbe allemand affiché (pas à choisir) : la même grande pastille que celle de la
// question, partout dans l'exercice (choix d'Anto du 27/10/2026) — carte découverte, corrections,
// fiche complète. « haben / sein » donne deux pastilles.
export function auxChipsHtml(aux, extraClass = '') {
  return `<div class="ds-morph__chips ds-auxchips${extraClass ? ` ${extraClass}` : ''}">
              ${aux.map((a) => `<span class="ds-morph__chip ds-morph__chip--right">${escapeHtml(a)}</span>`).join('')}
            </div>`;
}

// Règle d'usage sous le corrigé d'une carte d'usage ratée — seulement sur la dernière question
// du mot : plus tôt, elle donnerait la réponse des suivantes (choix d'Anto du 13/10).
export function usageRuleHtml(usage) {
  if (!usage) return '';
  return `<div class="ds-result__usage"><div class="ds-result__blockvalue">${escapeHtml(usageLines(usage))}</div></div>`;
}

// Une règle d'usage par ligne, dans le même bloc (choix d'Anto du 26/10) : le classeur les
// écrit à la suite, chacune finie par un point (« Présent : er fährt. Parfait avec sein. »).
// On coupe après un point suivi d'une majuscule, jamais à l'intérieur de « … » (une citation
// comme « Nice to meet you. – Likewise. » reste entière). Les retours à la ligne déjà présents
// dans la cellule sont gardés ; l'affichage repose sur white-space: pre-line.
export function usageLines(text) {
  const s = String(text ?? '');
  let out = '';
  let quote = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '«') quote += 1;
    else if (c === '»') quote = Math.max(0, quote - 1);
    if (quote === 0 && /[.!?]/.test(c) && s[i + 1] === ' ' && /[A-ZÀ-ÖØ-Þ«]/.test(s[i + 2] ?? '')) {
      out += `${c}\n`;
      i += 1;
      continue;
    }
    out += c;
  }
  return out;
}

// Carte phrase à trous (tests d'usage) : même gabarit compact que les cartes de placement et
// type de mot. La phrase avec « ___ » (et l'indice entre parenthèses s'il y en a un), le champ
// de saisie dessous. Au corrigé, le trou laisse place à la réponse dans la phrase : en vert si
// juste, sinon la saisie barrée suivie de la bonne réponse (voir gapCard dans ui.js).
export function gapCardHtml({ before, after, hint, badge = '', label = 'Complète la phrase', retry = false, rule = '' }) {
  const blank = `<span class="ds-gap__slot" id="gap-slot">___${hint ? ` (${escapeHtml(hint)})` : ''}</span>`;
  return `
    <div class="ds-choice ds-gap${retry ? ' ds-choice--retry' : ''}" id="gap-card">
      <div class="ds-prompt">${escapeHtml(label)}</div>
      ${badge}
      <div class="ds-gap__sentence">${escapeHtml(before)} ${blank} ${escapeHtml(after)}</div>
      <div class="ds-gap__field">${answerFieldHtml()}</div>
      ${rule ? `<div class="ds-choice__rule" hidden>${rule}</div>` : ''}
    </div>
  `;
}

// Carte de placement (tests d'usage) : le mot à placer, puis des phrases complètes à cocher —
// une ou plusieurs, toujours, même quand une seule est juste, pour que l'interface ne trahisse
// pas le nombre de bonnes réponses. Après validation, chaque phrase prend sa teinte (voir
// choiceCard dans ui.js) ; ratée et dernière question du mot, la règle d'usage s'affiche dessous.
// `prompt` et `help` : la carte sert aussi au test d'article allemand (« Quel article ? »).
export function choiceCardHtml({
  word, options, badge = '', retry = false, rule = '',
  prompt = 'Quelle phrase est correcte ?', help = 'Coche la ou les phrases correctes',
}) {
  const items = options.map((option, i) => `
    <button type="button" class="ds-choice__opt" data-i="${i}" aria-pressed="false">
      <span class="ds-choice__box"></span>
      <span class="ds-choice__text">${escapeHtml(option.text)}</span>
    </button>`).join('');
  return `
    <div class="ds-choice${retry ? ' ds-choice--retry' : ''}" id="choice-card">
      <div class="ds-prompt">${retry ? 'Mot déjà raté' : escapeHtml(prompt)}</div>
      ${badge}
      <div class="ds-choice__word">${escapeHtml(word)}</div>
      <div class="ds-choice__help">${escapeHtml(help)}</div>
      <div class="ds-choice__list">${items}</div>
      ${rule ? `<div class="ds-choice__rule" hidden>${rule}</div>` : ''}
    </div>
  `;
}

// Carte type de mot (tests d'usage) : la règle brute avec des cases vides (« ask after + [ ] »),
// puis les boutons de types. On touche une case pour la rendre active, puis les types qui
// vont dedans (un 2e appui retire le type). Ni exemple ni règle avant la validation (voir
// typeCard dans ui.js).
export function typeSlotHtml(index, chips = '', active = false) {
  return `<button type="button" class="ds-type__slot${active ? ' ds-type__slot--active' : ''}" data-s="${index}"
    aria-label="Case ${index + 1}" aria-pressed="${active}"><span class="ds-type__chips">${chips}</span></button>`;
}

export function typeChipHtml(type, variant = '') {
  return `<span class="ds-type__chip${variant ? ` ds-type__chip--${variant}` : ''}">${escapeHtml(type)}</span>`;
}

export function typeCardHtml({ parts, buttons, badge = '', retry = false, rule = '' }) {
  // Chaque case reste collée au texte qui la précède (« + lest + [ ] ») et le texte final à la
  // dernière case (« [ ] + as ») : le retour à la ligne ne laisse jamais un « + » orphelin.
  let slot = 0;
  const groups = [];
  let pending = '';
  for (const part of parts) {
    if (!part.slot) {
      const text = `<span class="ds-type__text">${escapeHtml(part.text)}</span>`;
      if (slot > 0 && part === parts[parts.length - 1]) groups[groups.length - 1] += text;
      else pending += text;
      continue;
    }
    const index = slot++;
    groups.push(pending + typeSlotHtml(index, '', index === 0));
    pending = '';
  }
  const ruleLine = groups.map((g) => `<span class="ds-type__group">${g}</span>`).join('');
  const items = buttons.map((type) => `
    <button type="button" class="ds-type__btn" data-t="${escapeHtml(type)}" aria-pressed="false">${escapeHtml(type)}</button>`).join('');
  return `
    <div class="ds-choice ds-type${retry ? ' ds-choice--retry' : ''}" id="type-card">
      <div class="ds-prompt">${retry ? 'Mot déjà raté' : 'Complète la règle'}</div>
      ${badge}
      <div class="ds-type__rule">${ruleLine}</div>
      <div class="ds-choice__help">${slot > 1 ? 'Touche une case, puis le ou les types de mots qui vont dedans' : 'Choisis le ou les types de mots qui vont dans la case'}</div>
      <div class="ds-type__btns">${items}</div>
      ${rule ? `<div class="ds-choice__rule" hidden>${rule}</div>` : ''}
    </div>
  `;
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
export function statPillHtml({ id = null, variant = 'home', side = 'left', value, delta, deltaColor, label, glyph = '' }) {
  const peekClass = side === 'right' ? 'stat-pill--right' : 'stat-pill--left';
  const deltaHtml = delta != null ? `<span class="stat-pill__delta" style="color:${deltaColor}">${escapeHtml(delta)}</span>` : '';
  const nums = `<div class="stat-pill__nums"><span class="stat-pill__n">${escapeHtml(value)}</span>${deltaHtml}</div>`;
  const body = `<div class="stat-pill__row">${nums}<span class="stat-pill__glyph">${glyph}</span></div><span class="stat-pill__label">${escapeHtml(label)}</span>`;
  return `
    <div class="stat-pill stat-pill--${variant} ${peekClass}"${id ? ` id="${id}"` : ''}>
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

// --- éclats (objectif du jour) ------------------------------------------------

// Direction radiale : un éclat posé sur le contour d'une boîte w×h au point (x%,y%) fuit le
// centre de cette boîte — le prolongement de toutes les trajectoires se coupe donc en un seul
// point, son centre. `x`/`y` sont des pourcentages de la boîte, pas des pixels.
function radial(w, h, x, y) {
  const dx = (x / 100) * w - w / 2;
  const dy = (y / 100) * h - h / 2;
  return Math.round((Math.atan2(dx, -dy) * 180) / Math.PI);
}

// Un éclat : un court trait arrondi qui naît sur le contour et file vers l'extérieur en
// s'effaçant — vol et effacement sont une seule courbe (@keyframes ds-eclat-*, une déclinaison
// par distance parcourue). `pos` = { x, y, dist, len, width, delay } en % de boîte / px / ms.
function eclatEl(pos, color, boxW, boxH, scale) {
  const wrap = document.createElement('span');
  wrap.className = 'eclat';
  wrap.style.left = `${pos.x}%`;
  wrap.style.top = `${pos.y}%`;
  wrap.style.transform = `rotate(${radial(boxW, boxH, pos.x, pos.y)}deg)`;
  const bar = document.createElement('i');
  bar.style.width = `${pos.width}px`;
  bar.style.height = `${pos.len}px`;
  bar.style.marginLeft = `${-pos.width / 2}px`;
  bar.style.background = color;
  bar.style.animation = `ds-eclat-${pos.dist} ${Math.round(560 * scale)}ms cubic-bezier(.2,.75,.25,1) ${Math.round(pos.delay * scale)}ms both`;
  wrap.appendChild(bar);
  return wrap;
}

// Fait naître une couronne d'éclats dans `host` (un `.eclat-host` posé en `position:absolute;
// inset:0` sur la boîte de référence) puis la retire une fois tous les éclats effacés — ils
// « n'existent que pendant l'éclat », une relance repart donc toujours de zéro.
export function spawnShards(host, positions, color, boxW, boxH, scale = 1) {
  if (!host) return;
  host.innerHTML = '';
  const frag = document.createDocumentFragment();
  let maxEnd = 0;
  positions.forEach((pos) => {
    frag.appendChild(eclatEl(pos, color, boxW, boxH, scale));
    maxEnd = Math.max(maxEnd, (pos.delay + 560) * scale);
  });
  host.appendChild(frag);
  setTimeout(() => { host.innerHTML = ''; }, Math.round(maxEnd) + 30);
}

const PRESS_CLASS = 'ds-flip--press';
const THROW_MS = 220;

// Anticipation : la carte s'incline dès la prise et se redresse au relâchement — ou si le
// pointeur quitte la zone sans rien déclencher. Attaché sur la même zone que onSwipe (la
// .session-body entière), pour que le retour visuel arrive même quand le pouce démarre à côté
// de la carte.
export function onCardPress(zone, card) {
  const release = () => card.classList.remove(PRESS_CLASS);
  zone.addEventListener('pointerdown', (e) => {
    if (e.target.closest('input, textarea, button')) return;
    card.classList.add(PRESS_CLASS);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((type) => zone.addEventListener(type, release));
}

// Sortie : la carte part vers le haut et la pile avance d'un cran. La promesse n'est tenue
// qu'à la fin de l'animation — l'appelant ne rend la carte suivante qu'après, sinon les deux
// se chevauchent dans le même emplacement.
export function throwCardOut(card) {
  return new Promise((resolve) => {
    card.classList.remove(PRESS_CLASS);
    card.classList.add('ds-flip--out');
    const stack = card.closest('.ds-stack');
    if (stack) advanceStack(stack);
    setTimeout(resolve, THROW_MS);
  });
}

// Chaque couche de la pile monte d'un cran : la première prend la place de la carte partante.
export function advanceStack(stack) {
  stack.querySelectorAll('.ds-stack__under').forEach((el) => {
    const d = Math.max(0, Number(el.dataset.depth) - 1);
    el.style.transform = `translateY(${d * 8}px) scale(${1 - d * 0.025})`;
    el.style.opacity = d === 0 ? '1' : String(1 - d * 0.25);
  });
}

// Entrée : la carte fraîchement rendue monte de 22 px. Deux trames sont nécessaires — la
// première pose l'état de départ sans transition, la seconde l'enlève pour que la transition
// de base s'applique. Une seule trame et le navigateur regroupe les deux états en un seul.
export function enterCard(card) {
  card.classList.add('ds-flip--in');
  requestAnimationFrame(() => requestAnimationFrame(() => card.classList.remove('ds-flip--in')));
}

// --- transition tuile <-> session (FLIP) --------------------------------------
// La tuile touchée à l'accueil devient l'écran de session, et inversement à la sortie
// (bouton ✕ ou bilan) : technique FLIP (First-Last-Invert-Play), un pur transform
// (translate + scale), jamais de propriété de mise en page — rien à recalculer pendant
// l'animation elle-même. `fromRect` = rectangle de départ voulu (la tuile), `toRect` =
// rectangle réel actuel de l'élément (sa position/taille naturelle, plein écran).
function flipTransform(fromRect, toRect) {
  const dx = fromRect.left + fromRect.width / 2 - (toRect.left + toRect.width / 2);
  const dy = fromRect.top + fromRect.height / 2 - (toRect.top + toRect.height / 2);
  const sx = fromRect.width / toRect.width;
  const sy = fromRect.height / toRect.height;
  return `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
}

// Minutage exact de la maquette « Ouverture de session » : 180 ms à l'aller (accélère puis
// ralentit franchement, cubic-bezier(.22,.7,.2,1)), 126 ms au retour — 70 % de l'aller, jamais
// un simple aller rejoué à l'envers — avec une courbe plus abrupte (cubic-bezier(.4,0,.7,.2)).
// L'opacité suit la même courbe que le transform, juste sur une fenêtre plus courte (70 ms /
// 49 ms) : les deux se resserrent ensemble, ce n'est jamais un fondu linéaire indépendant.
const GROW_MS = 180;
const GROW_OPACITY_MS = 70;
const GROW_EASE = 'cubic-bezier(.22,.7,.2,1)';
const SHRINK_MS = Math.round(GROW_MS * 0.7);
const SHRINK_OPACITY_MS = Math.round(GROW_OPACITY_MS * 0.7);
const SHRINK_EASE = 'cubic-bezier(.4,0,.7,.2)';

// Entrée : `el` est déjà à sa taille finale plein écran — on le pose d'abord (sans transition)
// à la position/taille de `tileRect`, puis on relâche vers l'identité à la trame suivante.
// Sans ce report d'une trame, le navigateur regroupe départ et arrivée en un seul état, et
// rien ne s'anime.
export function growFromRect(el, tileRect, { duration = GROW_MS, opacityDuration = GROW_OPACITY_MS, ease = GROW_EASE } = {}) {
  return new Promise((resolve) => {
    const finalRect = el.getBoundingClientRect();
    el.style.transformOrigin = 'center center';
    el.style.transition = 'none';
    el.style.transform = flipTransform(tileRect, finalRect);
    el.style.opacity = '0';
    el.getBoundingClientRect(); // force le calcul de style avant de relâcher
    requestAnimationFrame(() => {
      el.style.transition = `transform ${duration}ms ${ease}, opacity ${opacityDuration}ms ${ease}`;
      el.style.transform = 'none';
      el.style.opacity = '1';
    });
    setTimeout(() => {
      el.style.transition = '';
      el.style.transform = '';
      el.style.opacity = '';
      el.style.transformOrigin = '';
      resolve();
    }, duration + 20);
  });
}

// Sortie : l'inverse — `el` part de sa taille pleine actuelle et rétrécit vers `tileRect`.
// Les styles sont nettoyés avant de résoudre la promesse, pour que l'écran suivant (l'accueil,
// rendu juste après) ne hérite pas d'un transform/opacity resté collé sur #screen.
export function shrinkToRect(el, tileRect, { duration = SHRINK_MS, opacityDuration = SHRINK_OPACITY_MS, ease = SHRINK_EASE } = {}) {
  return new Promise((resolve) => {
    const startRect = el.getBoundingClientRect();
    el.style.transformOrigin = 'center center';
    el.style.transition = `transform ${duration}ms ${ease}, opacity ${opacityDuration}ms ${ease}`;
    el.style.transform = flipTransform(tileRect, startRect);
    el.style.opacity = '0';
    setTimeout(() => {
      el.style.transition = '';
      el.style.transform = '';
      el.style.opacity = '';
      el.style.transformOrigin = '';
      resolve();
    }, duration);
  });
}
