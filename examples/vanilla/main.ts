import { createPrismDeck, PRISMDECK_PRESETS as presets } from '@prismdeck/dom';
import type { PrismDeckVariant as Variant, PrismDeckSelectionMode as SelectionMode } from '@prismdeck/dom';
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
const cameraControls = element<HTMLInputElement>('camera-controls');
const selectionMode = element<HTMLSelectElement>('selection-mode');
const planeGrid = element<HTMLInputElement>('plane-grid');
const paneDrag = element<HTMLSelectElement>('pane-drag');
const snapToGrid = element<HTMLInputElement>('snap-to-grid');
const gridSize = element<HTMLSelectElement>('grid-size');
type PaneDrag = 'free' | 'horizontal' | 'vertical' | 'none';
const requestedVariant = new URL(location.href).searchParams.get('variant');
let variant: Variant = requestedVariant === 'B' || requestedVariant === 'C' ? requestedVariant : 'A';
let theme = getDemoTheme();
applyDemoTheme(theme, false);
let slides = collection(1000);
const initialFocus = 0;
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
  const drag = paneDrag.value;
  const workspace = selectionMode.value === 'slide-out' && (planeGrid.checked || drag !== 'none');
  const dragHelp = drag === 'none' ? 'Pane dragging is disabled.' : `${drag === 'free' ? 'Drag in any direction' : `Drag ${drag === 'horizontal' ? 'left or right' : 'up or down'}`}${snapToGrid.checked ? ' and release to snap.' : ' for free placement.'}`;
  element('stage-name').textContent = workspace ? 'EXTENDED DECK PLANE' : 'LIVE PRISM';
  element('variant-description').textContent = workspace
    ? `${planeGrid.checked ? 'Extend the selected pane into a grid' : 'Move the selected pane across its plane'} while keeping the prism in view. ${dragHelp}`
    : selectionMode.value === 'slide-out'
      ? 'Slide a pane out of the prism. Keep your place in the collection.'
      : selectionMode.value === 'modal'
        ? 'Open a pane in a modal. Return to the deck when you are ready.'
        : 'Select a pane while keeping the collection in view.';
  element('camera-hint').textContent = workspace && drag !== 'none'
    ? `${drag === 'free' ? 'Drag pane in any direction' : `Drag pane ${drag === 'horizontal' ? 'left or right' : 'up or down'}`} · ${snapToGrid.checked ? 'Release to snap' : 'Free placement'}${cameraControls.checked ? ' · Shift-drag to rotate' : ''}`
    : cameraControls.checked ? 'Shift-drag to rotate · Drag to browse' : 'Drag to browse · Scroll or pinch to zoom';
  const movePane = workspace && drag !== 'none';
  element('navigation-help-action').textContent = movePane ? 'Move pane' : 'Navigate';
  element('pane-reset-key').hidden = !movePane;
  element('pane-reset-action').hidden = !movePane;
  element('camera-help-button').hidden = !cameraControls.checked;
  element('camera-help-action').hidden = !cameraControls.checked;
}

function showVariant() {
  element('version-a').setAttribute('aria-pressed', String(variant === 'A'));
  element('version-b').setAttribute('aria-pressed', String(variant === 'B'));
  element('version-c').setAttribute('aria-pressed', String(variant === 'C'));
  prismLines.checked = presets[variant].prismLines;
  timelineRails.checked = presets[variant].timelineRails;
  selectionMode.value = presets[variant].selectionMode;
  planeGrid.checked = presets[variant].planeGrid;
  paneDrag.value = presets[variant].paneDrag;
  snapToGrid.checked = presets[variant].snapToGrid;
  gridSize.value = String(presets[variant].gridSize);
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
sequence.addEventListener('input', () => {
  const workspaceOpen = deck.controller.getSnapshot().selectedKey !== null
    && selectionMode.value === 'slide-out' && (planeGrid.checked || paneDrag.value !== 'none');
  deck.controller.focus(Number(sequence.value));
  if (workspaceOpen) deck.controller.select();
});
element('open-pane').addEventListener('click', () => {
  deck.controller.select();
  deck.element.focus({ preventScroll: true });
});

function setVariant(next: Variant) {
  variant = next;
  deck.controller.dismiss();
  // Clearing overrides makes each version a preset, not a separate widget.
  deck.update({ variant, layout: undefined, selectionMode: undefined, prismLines: undefined, timelineRails: undefined, planeGrid: undefined, paneDrag: undefined, snapToGrid: undefined, gridSize: undefined });
  showVariant();
  element('selection-status').textContent = 'Select a pane to bring it into view.';
  if (variant === 'C') deck.controller.select();
  const url = new URL(location.href);
  url.searchParams.set('variant', variant);
  history.replaceState(history.state, '', url);
}
element('version-a').addEventListener('click', () => setVariant('A'));
element('version-b').addEventListener('click', () => setVariant('B'));
element('version-c').addEventListener('click', () => setVariant('C'));
planeGrid.addEventListener('change', () => {
  deck.update({ planeGrid: planeGrid.checked });
  describeSelection();
  if (planeGrid.checked && selectionMode.value === 'slide-out') deck.controller.select();
});
paneDrag.addEventListener('change', () => {
  deck.update({ paneDrag: paneDrag.value as PaneDrag });
  describeSelection();
  if (paneDrag.value !== 'none' && selectionMode.value === 'slide-out') deck.controller.select();
});
snapToGrid.addEventListener('change', () => {
  deck.update({ snapToGrid: snapToGrid.checked });
  describeSelection();
});
gridSize.addEventListener('change', () => deck.update({ gridSize: Number(gridSize.value) }));
prismLines.addEventListener('change', () => deck.update({ prismLines: prismLines.checked }));
timelineRails.addEventListener('change', () => deck.update({ timelineRails: timelineRails.checked }));
cameraControls.addEventListener('change', () => {
  deck.update({ cameraControls: cameraControls.checked });
  describeSelection();
});
selectionMode.addEventListener('change', () => {
  deck.update({ selectionMode: selectionMode.value as SelectionMode });
  describeSelection();
  if ((planeGrid.checked || paneDrag.value !== 'none') && selectionMode.value === 'slide-out') deck.controller.select();
  element('selection-status').textContent = selectionMode.value === 'none'
    ? 'Selection is app-defined. This example reports the selected pane here.'
    : 'Select a pane to bring it into view.';
});
showVariant();
updateFocus(focused, initialFocus);
// The example opens the workspace; the library itself never auto-selects.
if (variant === 'C') deck.controller.select();

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
