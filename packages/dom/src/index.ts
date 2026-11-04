import { createDeckController, getPrismGeometry, getWalletLayout, visibleIndices } from '@prismdeck/core';
import type { PrismAdapter, PrismKey, PrismGeometry, PrismCamera, WalletPaneLayout } from '@prismdeck/core';

import { createPrismGuides, drawPrismGuides } from './guides.js';
import { resolvePresentationOptions, resolveTheme } from './options.js';
import type { PrismDeckPresentationOptions, PrismDeckTheme, PrismDeckLayout } from './options.js';
export { PRISMDECK_PRESETS, resolvePresentationOptions } from './options.js';
export type { PrismDeckVariant, PrismDeckSelectionMode, PrismDeckPresentationOptions, PrismDeckTheme, PrismDeckLayout } from './options.js';

export type PaneContent = Node | string | { element: Node; dispose?: () => void };
export interface PrismDeckOptions<T> extends PrismDeckPresentationOptions {
  items: readonly T[];
  /** Neutral day/night scheme; system follows the operating system live. */
  theme?: PrismDeckTheme;
  getKey?: (item: T) => PrismKey;
  adapter?: PrismAdapter<T>;
  renderPane?: (item: T, index: number) => PaneContent;
  onFocus?: (item: T, index: number) => void;
  onSelect?: (item: T, index: number) => void;
  onDismiss?: () => void;
  /** A second activation of the presented pane; application-defined. */
  onActivate?: (item: T, index: number) => void;
  /** Optional selected content; otherwise the existing pane moves without cloning. */
  renderSelection?: (item: T, index: number) => PaneContent;
  axis?: { label?: string; unit?: string };
  initialFocus?: number;
  initialZoom?: number;
  maxVisible?: number;
  label?: string;
  className?: string;
  controls?: boolean;
}
export interface PrismDeckInstance<T> {
  readonly element: HTMLElement;
  readonly controller: ReturnType<typeof createDeckController<T>>;
  update(options: Partial<PrismDeckOptions<T>>): void;
  dispose(): void;
}
interface MountedPane { element: HTMLElement; content: HTMLElement; dispose?: () => void; item: unknown; index: number }
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const isControl = (target: EventTarget | null) => target instanceof Element && !!target.closest('a,button,input,textarea,select,[contenteditable="true"],[data-prismdeck-interactive]');

/** A CSS 3D prism. Only the bounded visible window creates content or loads its images. */
export function createPrismDeck<T>(mount: HTMLElement, initial: PrismDeckOptions<T>): PrismDeckInstance<T> {
  let options = { ...initial };
  let disposed = false;
  let appearance = resolvePresentationOptions(options);
  const colorPreference = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  resolveTheme(options.theme, colorPreference?.matches);
  const controller = createDeckController<T>(options);
  const element = document.createElement('section');
  element.className = `prismdeck ${options.className ?? ''}`;
  const applyTheme = () => { element.dataset.prismdeckTheme = resolveTheme(options.theme, colorPreference?.matches); };
  applyTheme();
  colorPreference?.addEventListener('change', applyTheme);
  element.tabIndex = 0;
  element.setAttribute('role', 'region');
  element.setAttribute('aria-roledescription', '3D pane browser');
  element.setAttribute('aria-label', options.label ?? 'PrismDeck');
  const viewport = document.createElement('div');
  viewport.className = 'prismdeck-viewport';
  const stage = document.createElement('div');
  stage.className = 'prismdeck-stage';
  const guides = createPrismGuides();
  const pocket = document.createElement('div'); pocket.className = 'prismdeck-wallet-pocket';
  pocket.setAttribute('aria-hidden', 'true'); pocket.hidden = true;
  const pocketLabel = document.createElement('span'); pocketLabel.className = 'prismdeck-wallet-label'; pocket.append(pocketLabel);
  viewport.append(pocket, guides, stage);
  const status = document.createElement('div');
  status.className = 'prismdeck-status';
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  const controls = document.createElement('div');
  controls.className = 'prismdeck-controls';
  const previous = button('Previous pane', '←', () => browse(() => controller.move(-1)));
  const next = button('Next pane', '→', () => browse(() => controller.move(1)));
  const zoomLabel = document.createElement('label');
  zoomLabel.className = 'prismdeck-zoom';
  zoomLabel.append('Overview');
  const zoom = document.createElement('input');
  zoom.type = 'range'; zoom.min = '0'; zoom.max = '1'; zoom.step = '0.01';
  zoom.setAttribute('aria-label', 'Prism overview');
  zoom.addEventListener('input', () => browse(() => controller.setZoom(Number(zoom.value))));
  zoomLabel.append(zoom);
  const select = button('Select focused pane', 'Open pane', () => activate(controller.getSnapshot().focus));
  controls.append(previous, zoomLabel, next, select);
  element.append(viewport, status, controls);
  mount.append(element);
  const presentation = document.createElement('div');
  presentation.className = 'prismdeck-presentation'; presentation.hidden = true;
  const selectionViewport = document.createElement('div');
  selectionViewport.className = 'prismdeck-selection-viewport';
  const selectionStage = document.createElement('div'); selectionStage.className = 'prismdeck-stage';
  selectionViewport.append(selectionStage);
  const back = button('Back to deck', '← Back to deck', dismiss);
  back.className = 'prismdeck-selection-back';
  const selectionLabel = document.createElement('div'); selectionLabel.className = 'prismdeck-selection-label';
  presentation.append(selectionViewport, back, selectionLabel); element.append(presentation);
  presentation.addEventListener('click', event => {
    if (event.target === presentation || event.target === selectionViewport) dismiss();
  });
  viewport.addEventListener('click', event => {
    if (selected && selected.mode === 'slide-out') { event.preventDefault(); event.stopPropagation(); dismiss(); }
  }, true);
  const mounted = new Map<PrismKey, MountedPane>();
  let selected: { key: PrismKey; index: number; pane: MountedPane; mode: 'slide-out' | 'modal'; layout: PrismDeckLayout; indices: readonly number[];
    amount: number; focus: number; zoom: number; detail?: HTMLElement; disposeDetail?: () => void } | null = null;
  let dialog: HTMLDialogElement | null = null;
  const pointers = new Map<number, {x: number; y: number}>();
  let drag: { id: number; x: number; focus: number; moved: boolean } | null = null;
  let pinch: { distance: number; zoom: number } | null = null;
  let suppressClick = false;
  let suppressTimer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  let width = 1, height = 1;
  let viewFocus = controller.getSnapshot().focus;
  let viewZoom = controller.getSnapshot().zoom;
  let lastTime = 0;
  const motion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  function button(label: string, text: string, action: () => void) {
    const node = document.createElement('button');
    node.type = 'button'; node.textContent = text; node.setAttribute('aria-label', label);
    node.addEventListener('click', action); return node;
  }
  function removePane(key: PrismKey, pane: MountedPane) {
    if (pane.element.contains(document.activeElement)) element.focus({preventScroll: true});
    pane.dispose?.(); pane.element.remove(); mounted.delete(key);
  }
  function clearPanes() { for (const [key, pane] of mounted) removePane(key, pane); }
  function makePane(index: number): MountedPane {
    const item = controller.getItems()[index];
    const pane = document.createElement('div');
    pane.className = 'prismdeck-pane';
    pane.dataset.prismdeckKey = String(controller.getKey(index));
    pane.setAttribute('role', 'group');
    pane.setAttribute('aria-roledescription', 'pane');
    const content = options.renderPane?.(item, index) ?? String(item);
    let cleanup: (() => void) | undefined;
    const body = document.createElement('div'); body.className = 'prismdeck-pane-content';
    cleanup = appendContent(body, content); pane.append(body);
    // The accessible button is separate from arbitrary application content, so nested controls stay valid.
    const hit = button(`Select ${controller.getLabel(index)}`, '', () => {
      if (suppressClick) return;
      activate(index);
    });
    hit.className = 'prismdeck-pane-select';
    pane.append(hit);
    pane.addEventListener('click', (event) => {
      if (event.target === hit || isControl(event.target) || suppressClick) return;
      activate(index);
    });
    stage.append(pane);
    return {element: pane, content: body, dispose: cleanup, item, index};
  }
  function appendContent(parent: HTMLElement, content: PaneContent): (() => void) | undefined {
    if (typeof content === 'string') parent.textContent = content;
    else if ('element' in content) { parent.append(content.element); return content.dispose; }
    else parent.append(content);
  }
  function activate(index: number) {
    if (index < 0) return;
    if (selected && selected.key === controller.getKey(index) && selected.amount === 1) {
      options.onActivate?.(controller.getItems()[index], index);
    } else controller.select(index);
  }
  function dismiss() {
    if (selected?.mode === 'slide-out' && presentation.contains(document.activeElement)) element.focus({preventScroll: true});
    if (controller.getSnapshot().selectedKey !== null) { controller.dismiss(); options.onDismiss?.(); }
    schedule();
  }
  function browse(action: () => void) { if (selected) dismiss(); action(); }
  function resetPresentation() {
    const restoreFocus = presentation.contains(document.activeElement) || !!dialog?.contains(document.activeElement);
    if (selected) {
      selected.disposeDetail?.(); selected.detail?.remove(); selected.pane.content.hidden = false;
      stage.append(selected.pane.element);
      const restored = getPrismGeometry({count: controller.getSnapshot().count, focus: Math.max(0, selected.focus), zoom: selected.zoom, width, height, positions: controller.getPositions()});
      if (selected.layout === 'wallet') {
        const pose = walletLayout(selected.focus, selected.zoom, selected.indices).panes.find(pane => pane.index === selected!.index);
        if (pose) placeWalletPane(selected.pane, pose);
      } else placePane(selected.pane, restored, restored.camera, selected.index);
      selected.pane.element.classList.remove('is-presented');
      selected = null;
    }
    if (dialog) {
      dialog.dataset.prismdeckClosing = 'true'; dialog.close(); dialog.remove(); dialog = null;
    }
    presentation.hidden = true; viewport.style.transform = '';
    element.classList.remove('has-selection'); element.dataset.prismdeckSelectionProgress = '0';
    delete element.dataset.prismdeckSelectedKey;
    if (restoreFocus && !disposed) element.focus({preventScroll: true});
  }
  function startPresentation(key: PrismKey, index: number, pane: MountedPane, indices: readonly number[]) {
    const mode = appearance.selectionMode;
    if (mode === 'none') return;
    selected = {key, index, pane, mode, layout: appearance.layout, indices: [...indices], amount: mode === 'modal' ? 1 : 0, focus: viewFocus, zoom: viewZoom};
    if (options.renderSelection) {
      const detail = document.createElement('div'); detail.className = 'prismdeck-pane-detail';
      selected.disposeDetail = appendContent(detail, options.renderSelection(controller.getItems()[index], index));
      selected.detail = detail; pane.element.append(detail); pane.content.hidden = true;
    }
    const restorePaneFocus = pane.element.contains(document.activeElement);
    pane.element.classList.add('is-presented');
    if (mode === 'modal') {
      dialog = document.createElement('dialog'); dialog.className = 'prismdeck-dialog';
      dialog.setAttribute('aria-label', controller.getLabel(index));
      const header = document.createElement('div'); header.className = 'prismdeck-dialog-header';
      const label = document.createElement('span'); label.textContent = controller.getLabel(index);
      const close = button('Close selected pane', '×', dismiss); header.append(label, close);
      const surface = document.createElement('div'); surface.className = 'prismdeck-dialog-surface';
      surface.append(pane.element); dialog.append(header, surface); element.append(dialog);
      dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
      const activeDialog = dialog;
      dialog.addEventListener('close', () => { if (activeDialog.dataset.prismdeckClosing !== 'true') dismiss(); });
      dialog.addEventListener('click', event => { if (event.target === dialog) dismiss(); });
      dialog.showModal();
    } else {
      presentation.hidden = false; selectionStage.append(pane.element);
      if (restorePaneFocus) element.focus({preventScroll: true});
    }
  }
  function cameraAtExtraction(geometry: PrismGeometry, index: number, amount: number): PrismCamera {
    const source = geometry.camera;
    const azimuth = Math.atan2(-source.direction[2], source.direction[0]) * (1 - amount);
    const elevation = Math.asin(-source.direction[1]) * (1 - amount);
    const direction: [number, number, number] = [Math.cos(azimuth) * Math.cos(elevation), -Math.sin(elevation), -Math.sin(azimuth) * Math.cos(elevation)];
    const right: [number, number, number] = [Math.sin(azimuth), 0, Math.cos(azimuth)];
    const up: [number, number, number] = [Math.cos(azimuth) * Math.sin(elevation), Math.cos(elevation), -Math.sin(azimuth) * Math.sin(elevation)];
    const at = geometry.positionAt(index), small = width < 600;
    const visibleHeight = Math.max(1, Math.min(Math.max(1, height - 104), height * (small ? 0.48 : 0.62), width * (small ? 0.88 : 0.68) * geometry.paneHeight / geometry.paneWidth));
    const depth = source.focalLength * geometry.paneHeight / visibleHeight;
    const cx = small ? 0.5 : 0.59;
    const cy = Math.max(visibleHeight / 2 + 12, Math.min(height * 0.55, height - 64 - visibleHeight / 2)) / height;
    const end = [at[0] - depth, at[1] + (cy - 0.5) * height * depth / source.focalLength,
      at[2] + geometry.paneWidth * 1.05 + (0.5 - cx) * width * depth / source.focalLength];
    return {position: source.position.map((value, i) => value + (end[i] - value) * amount) as [number, number, number], direction, right, up, focalLength: source.focalLength};
  }
  function placePane(pane: MountedPane, geometry: PrismGeometry, camera: PrismCamera, index: number, extraction = 0) {
    pane.element.style.zIndex = ''; delete pane.element.dataset.prismdeckWallet; delete pane.element.dataset.prismdeckWalletPose;
    const at = geometry.positionAt(index); at[2] += geometry.paneWidth * 1.05 * extraction;
    const relative = at.map((value, i) => value - camera.position[i]);
    const x = dot(relative, camera.right), y = -dot(relative, camera.up), depth = dot(relative, camera.direction);
    pane.element.style.width = `${geometry.paneWidth}px`; pane.element.style.height = `${geometry.paneHeight}px`;
    const matrix = [camera.right[2], -camera.up[2], -camera.direction[2], 0,
      -camera.right[1], camera.up[1], camera.direction[1], 0,
      camera.right[0], -camera.up[0], -camera.direction[0], 0,
      x, y, camera.focalLength - depth, 1];
    pane.element.style.transform = `translate(-50%,-50%) matrix3d(${matrix.join(',')})`;
    pane.element.style.visibility = depth <= 1 ? 'hidden' : '';
    pane.element.dataset.prismdeckWorldPosition = JSON.stringify(at);
    pane.element.dataset.prismdeckWorldRotation = JSON.stringify([0, -Math.PI / 2, 0]);
    pane.element.dataset.prismdeckExtraction = String(extraction);
  }
  function walletIndices(focus: number, zoom: number) {
    return visibleIndices(controller.getSnapshot().count, Math.max(0, focus), Math.min(options.maxVisible ?? 40, 9 + Math.round(8 * zoom)), 0);
  }
  function walletLayout(focus: number, zoom: number, indices: readonly number[] = walletIndices(focus, zoom)) {
    return getWalletLayout({width, height, count: controller.getSnapshot().count, focus, zoom, indices});
  }
  function placeWalletPane(pane: MountedPane, pose: WalletPaneLayout, extraction = 0) {
    pane.element.style.width = `${pose.width}px`; pane.element.style.height = `${pose.height}px`;
    pane.element.style.zIndex = String(pose.zIndex); pane.element.style.visibility = '';
    pane.element.style.transform = `translate(-50%,-50%) translate3d(${pose.x - width / 2}px,${pose.y - height / 2}px,0) rotateZ(${pose.rotateZ}deg) scale(${pose.scale})`;
    pane.element.dataset.prismdeckWallet = 'true'; pane.element.dataset.prismdeckWalletPose = JSON.stringify(pose);
    pane.element.dataset.prismdeckExtraction = String(extraction);
    delete pane.element.dataset.prismdeckWorldPosition; delete pane.element.dataset.prismdeckWorldRotation;
  }
  function readWalletPane(pane: MountedPane, pose: WalletPaneLayout, amount: number) {
    const readingWidth = Math.max(1, Math.min(width * (width < 600 ? 0.9 : 0.66), Math.max(1, height - 118) * 16 / 9, 720));
    const readingY = Math.max(readingWidth * 9 / 32 + 16, Math.min(height * 0.41, height - 72 - readingWidth * 9 / 32));
    const mix = (from: number, to: number) => from + (to - from) * amount;
    placeWalletPane(pane, {...pose, x: mix(pose.x, width / 2), y: mix(pose.y, readingY),
      width: mix(pose.width, readingWidth), height: mix(pose.height, readingWidth * 9 / 16),
      rotateZ: pose.rotateZ * (1 - amount), scale: mix(pose.scale, 1), zIndex: 100}, amount);
  }
  function render(time: number) {
    frame = 0;
    if (disposed) return;
    const state = controller.getSnapshot();
    const desiredKey = appearance.selectionMode === 'none' ? null : state.selectedKey;
    if (selected && (controller.getKey(selected.index) !== selected.key || controller.getItems()[selected.index] !== selected.pane.item)) resetPresentation();
    if (selected && (selected.mode !== appearance.selectionMode || selected.key !== desiredKey) && selected.mode === 'modal') resetPresentation();
    const delta = Math.min(64, lastTime ? time - lastTime : 16);
    lastTime = time;
    const factor = motion?.matches ? 1 : 1 - Math.exp(-delta / 65);
    if (Math.abs(state.focus - viewFocus) > Math.max(1, (appearance.layout === 'wallet' ? 9 : options.maxVisible ?? 40) / 3)) viewFocus = state.focus;
    if (!selected) {
      viewFocus += (state.focus - viewFocus) * factor;
      viewZoom += (state.zoom - viewZoom) * factor;
    }
    if (Math.abs(viewFocus - state.focus) < 0.001) viewFocus = state.focus;
    if (Math.abs(viewZoom - state.zoom) < 0.0001) viewZoom = state.zoom;
    const geometry = getPrismGeometry({ count: state.count, focus: Math.max(0, selected?.focus ?? viewFocus), zoom: selected?.zoom ?? viewZoom, width, height, positions: controller.getPositions() });
    const { camera } = geometry;
    const isWallet = appearance.layout === 'wallet';
    viewport.style.perspective = isWallet ? 'none' : `${camera.focalLength}px`;
    const frozen = isWallet && selected ? selected.indices.filter(index => index >= 0 && index < state.count)
      .sort((a, b) => Math.abs(a - selected!.index) - Math.abs(b - selected!.index))
      .slice(0, walletIndices(selected.index, selected.zoom).length).sort((a, b) => a - b) : undefined;
    if (isWallet && selected && frozen) selected.indices = frozen;
    const indices = isWallet ? [...(frozen ?? walletIndices(viewFocus, viewZoom))] : visibleIndices(state.count, Math.max(0, selected?.index ?? viewFocus), options.maxVisible ?? 40, state.zoom);
    const wallet = isWallet ? walletLayout(selected?.focus ?? viewFocus, selected?.zoom ?? viewZoom, indices) : null;
    const walletPoses = new Map(wallet?.panes.map(pane => [pane.index, pane]));
    pocket.hidden = !isWallet || !state.count;
    if (wallet) {
      Object.assign(pocket.style, {left: `${wallet.pocket.x}px`, top: `${wallet.pocket.y}px`, width: `${wallet.pocket.width}px`, height: `${wallet.pocket.height}px`});
      pocketLabel.textContent = options.axis?.label ?? 'COLLECTION';
    }
    if (selected && !indices.includes(selected.index) && state.count) { indices.pop(); indices.push(selected.index); }
    const wanted = new Set(indices.map(index => controller.getKey(index)!));
    for (const [key, pane] of mounted) if (!wanted.has(key)) removePane(key, pane);
    for (const index of indices) {
      const key = controller.getKey(index)!;
      let pane = mounted.get(key);
      const item = controller.getItems()[index];
      if (pane && (pane.item !== item || pane.index !== index)) { removePane(key, pane); pane = undefined; }
      if (!pane) { pane = makePane(index); mounted.set(key, pane); }
      const focused = index === state.focus;
      if (selected?.key !== key) {
        const pose = walletPoses.get(index);
        if (pose) placeWalletPane(pane, pose); else placePane(pane, geometry, camera, index);
      }
      pane.element.style.setProperty('--prismdeck-distance', String(Math.min(1, Math.abs(index - viewFocus) / 20)));
      pane.element.classList.toggle('is-focused', focused);
      pane.element.classList.toggle('is-selected', key === state.selectedKey);
      const hit = pane.element.querySelector('.prismdeck-pane-select') as HTMLButtonElement;
      hit.tabIndex = focused ? 0 : -1;
      hit.setAttribute('aria-pressed', String(key === state.selectedKey));
      hit.setAttribute('aria-label', `${key === state.selectedKey && options.onActivate ? 'Activate' : 'Select'} ${controller.getLabel(index)}`);
      pane.element.setAttribute('aria-label', `${controller.getLabel(index)}, ${index + 1} of ${state.count}`);
    }
    if (!selected && desiredKey !== null) {
      const index = controller.getItems().findIndex((_, i) => controller.getKey(i) === desiredKey);
      const pane = mounted.get(desiredKey);
      if (index >= 0 && pane) startPresentation(desiredKey, index, pane, indices);
    }
    if (selected) {
      const target = selected.key === desiredKey && selected.mode === appearance.selectionMode ? 1 : 0;
      const transition = motion?.matches || appearance.transitionDuration === 0 ? 1 : 1 - Math.exp(-delta * 6 / appearance.transitionDuration);
      selected.amount += (target - selected.amount) * transition;
      if (Math.abs(selected.amount - target) < 0.001) selected.amount = target;
      const { pane, index, amount, mode } = selected;
      if (mode === 'slide-out') {
        presentation.style.height = `${height}px`;
        if (isWallet) {
          const pose = walletPoses.get(index);
          selectionViewport.style.perspective = 'none';
          viewport.style.transformOrigin = '50% 50%';
          viewport.style.transform = `translateY(${height * 0.24 * amount}px) scale(${1 - 0.45 * amount})`;
          if (pose) readWalletPane(pane, pose, amount);
        } else {
          const selectionCamera = cameraAtExtraction(geometry, index, amount);
          selectionViewport.style.perspective = `${selectionCamera.focalLength}px`;
          selectionViewport.dataset.prismdeckCamera = JSON.stringify(selectionCamera);
          viewport.style.transformOrigin = '0 0';
          viewport.style.transform = `translate(${16 * amount}px,${22 * amount}px) scale(${1 - 0.7 * amount})`;
          placePane(pane, geometry, selectionCamera, index, amount);
        }
        back.style.opacity = String(amount); back.disabled = amount < 0.95;
        selectionLabel.textContent = controller.getLabel(index); selectionLabel.style.opacity = String(amount);
      } else {
        pane.element.style.transform = 'none'; pane.element.style.visibility = '';
        pane.element.style.width = '100%'; pane.element.style.height = '100%'; pane.element.style.zIndex = '';
        pane.element.dataset.prismdeckWorldPosition = JSON.stringify(geometry.positionAt(index));
        pane.element.dataset.prismdeckWorldRotation = JSON.stringify([0, -Math.PI / 2, 0]);
        pane.element.dataset.prismdeckExtraction = '0';
      }
      element.dataset.prismdeckSelectionProgress = String(amount);
      element.dataset.prismdeckSelectedKey = String(selected.key);
      element.classList.add('has-selection');
      if (amount !== target) schedule();
      if (amount === 0 && target === 0) { resetPresentation(); schedule(); }
    }
    drawPrismGuides(guides, geometry, {width, height, prismLines: !isWallet && appearance.prismLines, timelineRails: !isWallet && appearance.timelineRails, indices, focus: state.focus});
    element.dataset.prismdeckVariant = appearance.variant;
    element.dataset.prismdeckLayout = appearance.layout;
    zoom.setAttribute('aria-label', isWallet ? 'Wallet spread' : 'Prism overview');
    zoomLabel.firstChild!.textContent = isWallet ? 'Fan' : 'Overview';
    element.dataset.prismdeckSelectionMode = appearance.selectionMode;
    element.dataset.prismdeckPrismLines = String(!isWallet && appearance.prismLines);
    element.dataset.prismdeckTimelineRails = String(!isWallet && appearance.timelineRails);
    const text = state.count ? `${controller.getLabel(state.focus)} · ${state.focus + 1} / ${state.count}` : 'No panes';
    if (status.textContent !== text) status.textContent = text;
    zoom.value = String(state.zoom);
    zoom.setAttribute('aria-valuetext', `${Math.round(state.zoom * 100)}% ${isWallet ? 'spread' : 'overview'}`);
    previous.disabled = state.focus <= 0; next.disabled = state.focus >= state.count - 1;
    select.disabled = state.count === 0;
    controls.hidden = options.controls === false;
    element.dataset.prismdeckCount = String(state.count);
    element.dataset.prismdeckMounted = String(mounted.size);
    if (!selected && (viewFocus !== state.focus || viewZoom !== state.zoom)) schedule();
  }
  function schedule() { if (!disposed && !frame) frame = requestAnimationFrame(render); }
  const unsubscribe = controller.subscribe(schedule);
  const resize = () => { width = Math.max(1, viewport.clientWidth); height = Math.max(1, viewport.clientHeight); schedule(); };
  const observer = new ResizeObserver(resize);
  observer.observe(viewport);
  const onKey = (event: KeyboardEvent) => {
    if ((event.target as Element).closest('.prismdeck') !== element) return;
    if (event.key === 'Escape' && controller.getSnapshot().selectedKey !== null) { event.preventDefault(); dismiss(); return; }
    if (event.ctrlKey || event.metaKey || event.altKey || (isControl(event.target) && !(event.target as Element).closest('.prismdeck-pane-select'))) return;
    if ((event.key === 'Enter' || event.key === ' ') && (event.target as Element).closest('.prismdeck-pane-select')) return;
    switch (event.key) {
      case 'ArrowRight': case 'ArrowDown': browse(() => controller.move(1)); break;
      case 'ArrowLeft': case 'ArrowUp': browse(() => controller.move(-1)); break;
      case 'Home': browse(() => controller.focus(0)); break;
      case 'End': browse(() => controller.focus(controller.getSnapshot().count - 1)); break;
      case 'PageDown': browse(() => controller.move(10)); break;
      case 'PageUp': browse(() => controller.move(-10)); break;
      case '+': case '=': browse(() => controller.setZoom(controller.getSnapshot().zoom - 0.12)); break;
      case '-': case '_': browse(() => controller.setZoom(controller.getSnapshot().zoom + 0.12)); break;
      case 'Enter': case ' ': activate(selected?.index ?? controller.getSnapshot().focus); break;
      case 'Escape': dismiss(); break;
      default: return;
    }
    event.preventDefault();
  };
  let wheelFocus = controller.getSnapshot().focus;
  let wheelTime = 0;
  const onWheel = (event: WheelEvent) => {
    if (isControl(event.target) && !(event.target as Element).closest('.prismdeck-pane-select')) return;
    event.preventDefault();
    if (selected) dismiss();
    const unit = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? height : 1;
    const state = controller.getSnapshot();
    if (event.ctrlKey || Math.abs(event.deltaY) >= Math.abs(event.deltaX)) {
      controller.setZoom(state.zoom + event.deltaY * unit / (event.ctrlKey ? 360 : 900));
    } else {
      if (performance.now() - wheelTime > 180) wheelFocus = state.focus;
      wheelTime = performance.now();
      wheelFocus = Math.max(0, Math.min(state.count - 1, wheelFocus + event.deltaX * unit / 110));
      controller.focus(wheelFocus);
    }
  };
  const distance = () => { const [a, b] = [...pointers.values()]; return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 1; };
  const quietClick = () => {
    suppressClick = true; clearTimeout(suppressTimer);
    suppressTimer = setTimeout(() => { suppressClick = false; }, 250);
  };
  const onDown = (event: PointerEvent) => {
    // Pane activation handles a click; touch/drag still works when it starts on the pane's selection surface.
    if (selected) return;
    if (event.button !== 0 || (isControl(event.target) && !(event.target as Element).closest('.prismdeck-pane-select'))) return;
    element.focus({preventScroll: true});
    pointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
    if (pointers.size === 2) {
      pinch = {distance: Math.max(1, distance()), zoom: controller.getSnapshot().zoom}; drag = null;
      for (const id of pointers.keys()) viewport.setPointerCapture(id);
      quietClick();
    } else if (!pinch) drag = {id: event.pointerId, x: event.clientX, focus: controller.getSnapshot().focus, moved: false};
  };
  const onMove = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
    if (pinch && pointers.size >= 2) {
      controller.setZoom(pinch.zoom - Math.log(Math.max(1, distance()) / pinch.distance) / 1.5); quietClick(); return;
    }
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    if (Math.abs(dx) > 6) { drag.moved = true; viewport.setPointerCapture(event.pointerId); }
    if (drag.moved) { controller.focus(drag.focus - dx / 64); quietClick(); }
  };
  const onUp = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    if (pinch || drag?.moved) quietClick();
    if (!pointers.size) { drag = null; pinch = null; }
  };
  element.addEventListener('keydown', onKey);
  viewport.addEventListener('wheel', onWheel, {passive: false});
  viewport.addEventListener('pointerdown', onDown);
  viewport.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  viewport.addEventListener('lostpointercapture', onUp);
  let safariZoom = 0;
  const onGestureStart = (event: Event) => { event.preventDefault(); safariZoom = controller.getSnapshot().zoom; quietClick(); };
  const onGestureChange = (event: Event) => { event.preventDefault(); controller.setZoom(safariZoom - Math.log(Math.max(0.01, (event as Event & {scale:number}).scale)) / 1.5); quietClick(); };
  viewport.addEventListener('gesturestart', onGestureStart, {passive: false});
  viewport.addEventListener('gesturechange', onGestureChange, {passive: false});
  resize();
  return { element, controller,
    update(next) {
      if (disposed) return;
      const candidate = { ...options, ...next };
      const nextAppearance = resolvePresentationOptions(candidate);
      resolveTheme(candidate.theme, colorPreference?.matches);
      // Configure validates before replacing state; rejected updates preserve the old widget.
      controller.configure(next);
      const contentChanged = candidate.renderPane !== options.renderPane;
      if (contentChanged || candidate.renderSelection !== options.renderSelection || nextAppearance.selectionMode !== appearance.selectionMode || nextAppearance.layout !== appearance.layout) resetPresentation();
      options = { ...candidate, items: controller.getItems() }; appearance = nextAppearance;
      applyTheme();
      if (contentChanged) clearPanes();
      element.className = `prismdeck ${options.className ?? ''}`;
      element.setAttribute('aria-label', options.label ?? 'PrismDeck');
      schedule();
    },
    dispose() {
      if (disposed) return;
      disposed = true; cancelAnimationFrame(frame); clearTimeout(suppressTimer);
      observer.disconnect(); colorPreference?.removeEventListener('change', applyTheme); unsubscribe(); controller.dispose(); resetPresentation(); clearPanes();
      window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp);
      pointers.clear(); element.remove();
    },
  };
}
