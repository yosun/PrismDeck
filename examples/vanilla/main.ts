import { createPrismDeck } from '@prismdeck/dom';
import '@prismdeck/dom/style.css';
import './style.css';

type Slide = { id: string; index: number; title: string; category: string; colors: readonly [string, string, string] };
const studies = [
  { title: 'Contours of tomorrow', category: 'FORM & SPACE', colors: ['#d7e8ae', '#6b9a65', '#244b48'] },
  { title: 'A quieter frequency', category: 'LIGHT & RHYTHM', colors: ['#e9c6a0', '#ca765c', '#5d4053'] },
  { title: 'Between the blue', category: 'COLOR & DEPTH', colors: ['#bdd9f0', '#628cae', '#314c71'] },
  { title: 'The shape of motion', category: 'MOVEMENT & MATTER', colors: ['#e9d0e6', '#ac80a1', '#504665'] },
  { title: 'An open horizon', category: 'LAND & POSSIBILITY', colors: ['#efdfa5', '#c3a65f', '#59654f'] },
] as const;

function collection(count: number): Slide[] {
  return Array.from({ length: count }, (_, index) => ({ ...studies[index % studies.length], index, id: `study-${index}` }));
}

/** Generate a preview only when a renderer needs it. No image network requests. */
function imageSource(slide: Slide): string {
  const [light, mid, dark] = slide.colors;
  const offset = (slide.index % 7) * 22;
  const xmlEntities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
  const xmlText = (value: string) => value.replace(/[&<>"']/g, (character) => xmlEntities[character]);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1440 900"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="${light}"/><stop offset="1" stop-color="${mid}"/></linearGradient><linearGradient id="hill" x2="0" y2="1"><stop stop-color="${mid}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs><rect width="1440" height="900" fill="url(#bg)"/><circle cx="${1090 - offset}" cy="${290 + offset / 2}" r="180" fill="${light}" opacity=".75"/><path d="M0 630 Q300 ${180 + offset} 710 590 T1440 450 V900 H0Z" fill="url(#hill)"/><path d="M0 780 Q430 ${390 - offset} 940 750 T1440 660 V900 H0Z" fill="${dark}" opacity=".86"/><path d="M0 655 Q330 ${205 + offset} 710 614 T1440 477" fill="none" stroke="${light}" stroke-width="2" opacity=".45"/><g fill="${dark}" font-family="Arial,Helvetica,sans-serif"><text x="76" y="88" font-size="19" letter-spacing="5">STUDIES IN PERSPECTIVE</text><text x="76" y="215" font-size="68" font-weight="500">${xmlText(slide.title)}</text><text x="78" y="265" font-size="20" letter-spacing="3">${xmlText(slide.category)}</text></g><text x="76" y="836" fill="${light}" font-family="Arial,Helvetica,sans-serif" font-size="21" letter-spacing="2">PRISMDECK / ${String(slide.index + 1).padStart(3, '0')}</text><path d="M1286 777h70m-24-24 24 24-24 24" stroke="${light}" stroke-width="3" fill="none"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing example element: ${id}`);
  return result as T;
}

const paneDialog = element<HTMLDialogElement>('pane-dialog');
const spatialDialog = element<HTMLDialogElement>('spatial-dialog');
const sequence = element<HTMLInputElement>('sequence');
const collectionSize = element<HTMLSelectElement>('collection-size');
let slides = collection(1000);
let focused = slides[0];

function updateFocus(slide: Slide, index: number) {
  focused = slide;
  element('focus-number').textContent = String(index + 1).padStart(3, '0');
  element('focus-title').textContent = slide.title;
  element('focus-kicker').textContent = slide.category;
  element('sequence-position').textContent = `${(index + 1).toLocaleString()} / ${slides.length.toLocaleString()}`;
  sequence.value = String(index);
}

function selectSlide(slide: Slide, index: number) {
  element('dialog-title').textContent = slide.title;
  element('dialog-kicker').textContent = slide.category;
  const image = element<HTMLImageElement>('dialog-image');
  image.src = imageSource(slide);
  image.alt = `${slide.title}, synthetic landscape study ${slide.index + 1}`;
  element('dialog-position').textContent = `${index + 1} / ${slides.length.toLocaleString()}`;
  if (!paneDialog.open) paneDialog.showModal();
}

const deck = createPrismDeck(element('deck'), {
  items: slides,
  getKey: (slide) => slide.id,
  adapter: { getKey: (slide) => slide.id, getLabel: (slide) => `${slide.title}, pane ${slide.index + 1}` },
  axis: { label: 'Sequence' },
  renderPane: (slide) => {
    const image = new Image();
    image.src = imageSource(slide);
    image.alt = `${slide.title}, synthetic landscape study ${slide.index + 1}`;
    image.draggable = false;
    image.decoding = 'async';
    return image;
  },
  onFocus: updateFocus,
  onSelect: selectSlide,
  maxVisible: 40,
  label: 'Studies in perspective. Browse ordered slides.',
});

function setCollection(count: number) {
  const safeCount = Math.max(0, Math.floor(Number.isFinite(count) ? count : 1000));
  slides = collection(safeCount);
  deck.update({ items: slides });
  sequence.max = String(Math.max(0, safeCount - 1));
  sequence.disabled = safeCount === 0;
  element('open-pane').toggleAttribute('disabled', safeCount === 0);
  element('collection-count').textContent = `${safeCount.toLocaleString()} panes`;
  collectionSize.value = String(safeCount);
  if (safeCount) updateFocus(slides[deck.controller.getSnapshot().focus], deck.controller.getSnapshot().focus);
  else {
    element('focus-number').textContent = '—';
    element('focus-title').textContent = 'No panes in this collection';
    element('sequence-position').textContent = '0 / 0';
  }
}

collectionSize.addEventListener('change', () => setCollection(Number(collectionSize.value)));
sequence.addEventListener('input', () => deck.controller.focus(Number(sequence.value)));
element('open-pane').addEventListener('click', () => deck.controller.select());
element('close-pane').addEventListener('click', () => paneDialog.close());
paneDialog.addEventListener('close', () => deck.controller.dismiss());
element('previous-pane').addEventListener('click', () => { deck.controller.move(-1); deck.controller.select(); });
element('next-pane').addEventListener('click', () => { deck.controller.move(1); deck.controller.select(); });
updateFocus(focused, 0);

// Explicit opt-in is the boundary: the ordinary demo imports neither Three nor XR.
let spatial: { dispose(): void; renderer: import('three').WebGLRenderer } | undefined;
let spatialLoading = false;
let xrLoaded = false;
element('spatial-button').addEventListener('click', async () => {
  if (spatialLoading) return;
  spatialLoading = true;
  spatialDialog.showModal();
  element('spatial-message').textContent = 'Loading the optional Three.js renderer…';
  try {
    const { createThreePrismDeck } = await import('@prismdeck/three');
    if (!spatialDialog.open) return;
    spatial = createThreePrismDeck(element('spatial-stage'), { controller: deck.controller, getImage: imageSource });
    element('render-status').textContent = '40 mounted panes maximum · Optional spatial renderer loaded';
    const xr = navigator.xr;
    const supported = xr ? await xr.isSessionSupported('immersive-vr').catch(() => false) : false;
    if (!spatialDialog.open) return;
    if (supported) {
      const { enterXR } = await import('@prismdeck/three/xr');
      xrLoaded = true;
      const enterButton = element<HTMLButtonElement>('enter-xr');
      enterButton.hidden = false;
      enterButton.onclick = async () => {
        if (!spatial) return;
        try { await enterXR(spatial.renderer); }
        catch (error) { element('spatial-message').textContent = error instanceof Error ? error.message : 'The immersive session could not start.'; }
      };
      element('spatial-message').textContent = 'Immersive XR is available. Enter when you are ready.';
      element('xr-status').textContent = 'Optional spatial and XR modules loaded after your opt-in.';
    } else {
      element('spatial-message').textContent = 'WebGL preview is ready. This browser has no supported immersive VR session.';
      element('xr-status').textContent = 'Optional Three.js loaded. XR remains unloaded.';
    }
  } catch (error) {
    element('spatial-message').textContent = error instanceof Error ? error.message : 'The optional renderer is unavailable.';
  } finally { spatialLoading = false; }
});
element('close-spatial').addEventListener('click', () => spatialDialog.close());
spatialDialog.addEventListener('close', () => {
  spatial?.dispose();
  spatial = undefined;
  element('enter-xr').hidden = true;
  element('render-status').textContent = `40 mounted panes maximum · ${xrLoaded ? 'Optional XR loaded by request' : 'Zero XR loaded'}`;
});

// Public handles are useful for browser tests and experimenting in DevTools.
Object.assign(window, { deck, setCollection });
window.addEventListener('pagehide', (event) => {
  // A back/forward-cache page is resumed rather than remounted.
  if (!event.persisted) { spatial?.dispose(); deck.dispose(); }
});
