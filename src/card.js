// Reusable flashcard shell + swipe gesture helper for the review/learning screens.

export function renderFlashcard(area, { variant, badge, dotsTotal = 0, dotsFilled = 0 }) {
  const dots = Array.from({ length: dotsTotal }, (_, i) => (
    `<span class="dot${i < dotsFilled ? ' dot--filled' : ''}"></span>`
  )).join('');

  area.innerHTML = `
    <div class="flashcard flashcard--${variant}">
      ${dotsTotal > 0 ? `<div class="dot-progress">${dots}</div>` : ''}
      ${badge ? `<span class="flashcard-badge">${badge}</span>` : ''}
      <div class="flashcard-body"></div>
    </div>
  `;
  return area.querySelector('.flashcard-body');
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
