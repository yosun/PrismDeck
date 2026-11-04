import { createPrismDeck, PRISMDECK_PRESETS as presets } from '@prismdeck/dom';
import type { PrismDeckVariant as Variant, PrismDeckSelectionMode as SelectionMode, PrismDeckLayout as Layout } from '@prismdeck/dom';
import '@prismdeck/dom/style.css';
import './style.css';

import { collection, imageSource } from '../shared/slides';
import type { Slide } from '../shared/slides';
import { applyDemoTheme, getDemoTheme, watchSystemTheme } from '../shared/theme';
import type { DemoTheme } from '../shared/theme';

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing example element: ${id}`);
  return result as T;
}

const spatialDialog = element<HTMLDialogElement>('spatial-dialog');
const sequence = element<HTMLInputElement>('sequence');
const collectionSize = element<HTMLSelectElement>('collection-size');
const prismLines = element<HTMLInputElement>('prism-lines');
const timelineRails = element<HTMLInputElement>('timeline-rails');
const selectionMode = element<HTMLSelectElement>('selection-mode');
const layout = element<HTMLSelectElement>('layout');
const requestedVariant = new URL(location.href).searchParams.get('variant');
let variant: Variant = requestedVariant === 'B' || requestedVariant === 'C' ? requestedVariant : 'A';
let theme = getDemoTheme();
applyDemoTheme(theme, false);
let slides = collection(1000);
// Center the first wallet window so the opening fan shows cards on both sides.
const initialFocus = variant === 'C' ? 4 : 0;
let focused = slides[initialFocus];

function updateFocus(slide: Slide, index: number) {
  focused = slide;
  element('focus-number').textContent = String(index + 1).padStart(3, '0');
  element('focus-title').textContent = slide.title;
  element('focus-kicker').textContent = slide.category;
  element('sequence-position').textContent = `${(index + 1).toLocaleString()} / ${slides.length.toLocaleString()}`;
  sequence.value = String(index);
}

function selectSlide(slide: Slide, index: number) {
  element('selection-status').textContent = `Selected ${index + 1}: ${slide.title}. Select it again to activate.`;
}

function describeSelection() {
  const wallet = layout.value === 'wallet';
  element('stage-name').textContent = wallet ? 'WALLET WILDCARD' : 'LIVE PRISM';
  element('wallet-note').hidden = !wallet;
  element('draw-card').hidden = !wallet;
  prismLines.disabled = wallet;
  timelineRails.disabled = wallet;
  prismLines.title = wallet ? 'Available in Prism layout' : '';
  timelineRails.title = wallet ? 'Available in Prism layout' : '';
  element('variant-description').textContent = wallet && selectionMode.value === 'slide-out'
    ? 'A pocket of possibilities. Draw a card, follow a thought, and return it to its place.'
    : wallet
      ? 'A pocket of possibilities. Browse the fan or draw an unexpected card.'
      : selectionMode.value === 'slide-out'
    ? 'Slide a pane out of the prism. Keep your place in the collection.'
    : selectionMode.value === 'modal'
      ? 'Open a pane in a modal. Return to the deck when you are ready.'
      : 'Select a pane while keeping the collection in view.';
}

function showVariant() {
  element('version-a').setAttribute('aria-pressed', String(variant === 'A'));
  element('version-b').setAttribute('aria-pressed', String(variant === 'B'));
  element('version-c').setAttribute('aria-pressed', String(variant === 'C'));
  layout.value = presets[variant].layout;
  prismLines.checked = presets[variant].prismLines;
  timelineRails.checked = presets[variant].timelineRails;
  selectionMode.value = presets[variant].selectionMode;
  describeSelection();
}

const deck = createPrismDeck(element('deck'), {
  items: slides,
  getKey: (slide) => slide.id,
  adapter: { getKey: (slide) => slide.id, getLabel: (slide) => `${slide.title}, pane ${slide.index + 1}` },
  axis: { label: 'Sequence' },
  renderPane: (slide) => {
    const image = new Image();
    image.src = imageSource(slide);
    image.alt = `${slide.title}, synthetic grayscale study ${slide.index + 1}`;
    image.draggable = false;
    image.decoding = 'async';
    return image;
  },
  onFocus: updateFocus,
  variant,
  initialFocus,
  theme,
  onSelect: selectSlide,
  onActivate: (slide) => { element('selection-status').textContent = `Activated “${slide.title}”.`; },
  onDismiss: () => { element('selection-status').textContent = 'Back in the deck. Select another pane to explore.'; },
  maxVisible: 40,
  label: 'Studies in perspective. Browse ordered slides.',
});

function showTheme() {
  element('theme-light').setAttribute('aria-pressed', String(theme === 'light'));
  element('theme-dark').setAttribute('aria-pressed', String(theme === 'dark'));
}
function setTheme(next: DemoTheme, remember = true) {
  theme = next;
  applyDemoTheme(theme, remember);
  deck.update({ theme });
  showTheme();
}
element('theme-light').addEventListener('click', () => setTheme('light'));
element('theme-dark').addEventListener('click', () => setTheme('dark'));
const stopWatchingTheme = watchSystemTheme((next) => setTheme(next, false));
showTheme();

function setCollection(count: number) {
  const safeCount = Math.max(0, Math.floor(Number.isFinite(count) ? count : 1000));
  slides = collection(safeCount);
  deck.update({ items: slides });
  sequence.max = String(Math.max(0, safeCount - 1));
  sequence.disabled = safeCount === 0;
  element('open-pane').toggleAttribute('disabled', safeCount === 0);
  element('draw-card').toggleAttribute('disabled', safeCount === 0);
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
element('open-pane').addEventListener('click', () => {
  deck.controller.select();
  deck.element.focus({ preventScroll: true });
});
element('draw-card').addEventListener('click', () => {
  const { focus, count } = deck.controller.getSnapshot();
  if (!count) return;
  // Explore a different card without shuffling the application's ordered items.
  const next = count < 2 ? 0 : (focus + 1 + Math.floor(Math.random() * (count - 1))) % count;
  deck.controller.dismiss();
  deck.controller.focus(next);
  deck.controller.select();
  deck.element.focus({ preventScroll: true });
  element('selection-status').textContent = `Your wildcard: ${slides[next].title}. A new perspective from pane ${next + 1}.`;
});
function setVariant(next: Variant) {
  variant = next;
  deck.controller.dismiss();
  // Clearing overrides makes each version a preset, not a separate widget.
  deck.update({ variant, layout: undefined, selectionMode: undefined, prismLines: undefined, timelineRails: undefined });
  showVariant();
  element('selection-status').textContent = 'Select a pane to bring it into view.';
  const url = new URL(location.href);
  url.searchParams.set('variant', variant);
  history.replaceState(history.state, '', url);
}
element('version-a').addEventListener('click', () => setVariant('A'));
element('version-b').addEventListener('click', () => setVariant('B'));
element('version-c').addEventListener('click', () => setVariant('C'));
layout.addEventListener('change', () => {
  deck.update({ layout: layout.value as Layout });
  describeSelection();
});
prismLines.addEventListener('change', () => deck.update({ prismLines: prismLines.checked }));
timelineRails.addEventListener('change', () => deck.update({ timelineRails: timelineRails.checked }));
selectionMode.addEventListener('change', () => {
  deck.update({ selectionMode: selectionMode.value as SelectionMode });
  describeSelection();
  element('selection-status').textContent = selectionMode.value === 'none'
    ? 'Selection is app-defined. This example reports the selected pane here.'
    : 'Select a pane to bring it into view.';
});
showVariant();
updateFocus(focused, initialFocus);

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
    element('render-status').textContent = '40 preview panes maximum · Optional spatial renderer loaded';
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
  element('render-status').textContent = `40 preview panes maximum · ${xrLoaded ? 'Optional XR loaded by request' : 'Zero XR loaded'}`;
});

// Public handles are useful for browser tests and experimenting in DevTools.
Object.assign(window, { deck, setCollection });
window.addEventListener('pagehide', (event) => {
  // A back/forward-cache page is resumed rather than remounted.
  if (!event.persisted) { stopWatchingTheme(); spatial?.dispose(); deck.dispose(); }
});
