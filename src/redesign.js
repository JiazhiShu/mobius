import {startHero} from './redesign-hero.js?v=20261106';

startHero(document.querySelector('#hero-canvas'));

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const root = document.documentElement, header = document.querySelector('.site-header');

function updateScroll() {
  const scrollable = root.scrollHeight - innerHeight;
  root.style.setProperty('--scroll-progress', scrollable > 0 ? (scrollY / scrollable).toFixed(4) : 0);
  root.style.setProperty('--hero-fade', Math.max(0, 1 - scrollY / (innerHeight * .85)).toFixed(3));
  header.classList.toggle('is-scrolled', scrollY > 24);
}
addEventListener('scroll', updateScroll, {passive: true});
addEventListener('resize', updateScroll);
updateScroll();

// Words arrive one at a time whenever a prompt or caption changes. The inspector re-renders
// when a motion finishes loading, so a repeat of the same text resumes the animation in place.
const WORD_STAGGER = 11, WORD_DELAY_LIMIT = 620, WORD_DURATION = 550;
const textState = new Map();
function animateText(card) {
  if (reduced || card.querySelector('.word')) return;
  const slot = `${card.closest('.studio')?.dataset.task}:${card.className}`;
  const text = card.textContent, now = performance.now();
  let state = textState.get(slot);
  if (state?.text !== text) { state = {text, start: now}; textState.set(slot, state); }
  const elapsed = now - state.start;
  if (elapsed > WORD_DELAY_LIMIT + WORD_DURATION) return;
  card.setAttribute('aria-label', text);
  card.replaceChildren(...text.split(/(\s+)/).map((part, index) => {
    if (!part.trim()) return document.createTextNode(part);
    const word = document.createElement('span');
    word.className = 'word'; word.setAttribute('aria-hidden', 'true');
    word.style.animationDelay = `${Math.min(index * WORD_STAGGER, WORD_DELAY_LIMIT) - elapsed}ms`;
    word.textContent = part;
    return word;
  }));
}
function arrangeStudios() {
  // The task guide is created beside the body; the redesign reads it alongside the stage.
  document.querySelectorAll('.studio > .task-guide').forEach(guide => guide.parentElement.querySelector('.studio-body').append(guide));
  document.querySelectorAll('.studio .prompt-card').forEach(animateText);
}
new MutationObserver(arrangeStudios).observe(document.querySelector('main'), {childList: true, subtree: true});
arrangeStudios();

const reveal = new IntersectionObserver(entries => entries.forEach(entry => {
  if (entry.isIntersecting) { entry.target.classList.add('is-revealed'); reveal.unobserve(entry.target); }
}), {threshold: .04});
if (!reduced) document.querySelectorAll('.benchmark-card,.studio').forEach(element => {
  element.classList.add('reveal-ready'); reveal.observe(element);
});

const video = document.querySelector('#demo-video video'), play = document.querySelector('.video-play');
play.addEventListener('click', () => video.play().catch(() => {}));
video.addEventListener('play', () => { play.hidden = true; });

// Crosshair for reading a value across a row and down a column.
document.querySelectorAll('.benchmark-table').forEach(table => {
  const clear = () => table.querySelectorAll('.is-column').forEach(cell => cell.classList.remove('is-column'));
  table.addEventListener('pointerover', event => {
    const cell = event.target.closest('td,th');
    clear();
    if (!cell || cell.colSpan > 1) return;
    table.querySelectorAll(`tr > :nth-child(${cell.cellIndex + 1})`).forEach(item => {
      if (item.colSpan === 1) item.classList.add('is-column');
    });
  });
  table.addEventListener('pointerleave', clear);
});
