// Reusable flashcard shell + swipe gesture helper for the review/learning screens.

// Au-delà de ce seuil la colonne de points se tasse et devient illisible : la barre
// de progression horizontale de la coque de session prend alors le relais.
const MAX_DOTS = 15;

export function renderFlashcard(area, { variant, badge, badgeTone, dotsTotal = 0, dotsFilled = 0 }) {
  const showDots = dotsTotal > 0 && dotsTotal <= MAX_DOTS;
  const dots = showDots
    ? Array.from({ length: dotsTotal }, (_, i) => (
      `<span class="dot${i < dotsFilled ? ' dot--filled' : ''}"></span>`
    )).join('')
    : '';
  const badgeClass = `flashcard-badge${badgeTone ? ` flashcard-badge--${badgeTone}` : ''}`;

  area.innerHTML = `
    <div class="flashcard flashcard--fill flashcard--${variant}">
      ${showDots ? `<div class="dot-progress">${dots}</div>` : ''}
      ${badge ? `<span class="${badgeClass}">${badge}</span>` : ''}
      <div class="flashcard-body"></div>
    </div>
  `;
  return area.querySelector('.flashcard-body');
}

// Attache un clic "n'importe où sur la carte", en ignorant ceux qui arrivent juste après
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

// Basic pointer-based swipe detection. Buttons remain the reliable fallback for every
// action a swipe triggers, so this is a shortcut gesture rather than the only path.
export function onSwipe(el, { onLeft, onRight, onUp } = {}) {
  const threshold = 60;
  let startX = 0;
  let startY = 0;
  let tracking = false;

  const onPointerDown = (e) => {
    tracking = true;
    startX = e.clientX;
    startY = e.clientY;
  };

  const onPointerUp = (e) => {
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
  };

  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointerup', onPointerUp);
}
