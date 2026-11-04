import { createDeckController, getPrismGeometry, visibleIndices } from '@prismdeck/core';
import type { PrismAdapter, PrismKey } from '@prismdeck/core';

export type PaneContent = Node | string | { element: Node; dispose?: () => void };
export interface PrismDeckOptions<T> {
  items: readonly T[];
  getKey?: (item: T) => PrismKey;
  adapter?: PrismAdapter<T>;
  renderPane?: (item: T, index: number) => PaneContent;
  onFocus?: (item: T, index: number) => void;
  onSelect?: (item: T, index: number) => void;
  onDismiss?: () => void;
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
interface MountedPane { element: HTMLElement; dispose?: () => void; item: unknown; index: number }
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const isControl = (target: EventTarget | null) => target instanceof Element && !!target.closest('a,button,input,textarea,select,[contenteditable="true"],[data-prismdeck-interactive]');

/** A CSS 3D prism. Only the bounded visible window creates content or loads its images. */
export function createPrismDeck<T>(mount: HTMLElement, initial: PrismDeckOptions<T>): PrismDeckInstance<T> {
  let options = { ...initial };
  let disposed = false;
  const controller = createDeckController<T>(options);
  const element = document.createElement('section');
  element.className = `prismdeck ${options.className ?? ''}`;
  element.tabIndex = 0;
  element.setAttribute('role', 'region');
  element.setAttribute('aria-roledescription', '3D pane browser');
  element.setAttribute('aria-label', options.label ?? 'PrismDeck');
  const viewport = document.createElement('div');
  viewport.className = 'prismdeck-viewport';
  const stage = document.createElement('div');
  stage.className = 'prismdeck-stage';
  viewport.append(stage);
  const status = document.createElement('div');
  status.className = 'prismdeck-status';
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  const controls = document.createElement('div');
  controls.className = 'prismdeck-controls';
  const previous = button('Previous pane', '←', () => controller.move(-1));
  const next = button('Next pane', '→', () => controller.move(1));
  const zoomLabel = document.createElement('label');
  zoomLabel.className = 'prismdeck-zoom';
  zoomLabel.append('Overview');
  const zoom = document.createElement('input');
  zoom.type = 'range'; zoom.min = '0'; zoom.max = '1'; zoom.step = '0.01';
  zoom.setAttribute('aria-label', 'Prism overview');
  zoom.addEventListener('input', () => controller.setZoom(Number(zoom.value)));
  zoomLabel.append(zoom);
  const select = button('Select focused pane', 'Open pane', () => controller.select());
  controls.append(previous, zoomLabel, next, select);
  element.append(viewport, status, controls);
  mount.append(element);
  const mounted = new Map<PrismKey, MountedPane>();
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
    if (typeof content === 'string') pane.textContent = content;
    else if ('element' in content) { pane.append(content.element); cleanup = content.dispose; }
    else pane.append(content);
    // The accessible button is separate from arbitrary application content, so nested controls stay valid.
    const hit = button(`Select ${controller.getLabel(index)}`, '', () => {
      if (suppressClick) return;
      controller.select(index);
    });
    hit.className = 'prismdeck-pane-select';
    pane.append(hit);
    pane.addEventListener('click', (event) => {
      if (event.target === hit || isControl(event.target) || suppressClick) return;
      controller.select(index);
    });
    stage.append(pane);
    return {element: pane, dispose: cleanup, item, index};
  }
  function render(time: number) {
    frame = 0;
    if (disposed) return;
    const state = controller.getSnapshot();
    const delta = Math.min(64, lastTime ? time - lastTime : 16);
    lastTime = time;
    const factor = motion?.matches ? 1 : 1 - Math.exp(-delta / 65);
    if (Math.abs(state.focus - viewFocus) > Math.max(1, (options.maxVisible ?? 40) / 3)) viewFocus = state.focus;
    viewFocus += (state.focus - viewFocus) * factor;
    viewZoom += (state.zoom - viewZoom) * factor;
    if (Math.abs(viewFocus - state.focus) < 0.001) viewFocus = state.focus;
    if (Math.abs(viewZoom - state.zoom) < 0.0001) viewZoom = state.zoom;
    const geometry = getPrismGeometry({ count: state.count, focus: Math.max(0, viewFocus), zoom: viewZoom, width, height, positions: controller.getPositions() });
    const { camera } = geometry;
    viewport.style.perspective = `${camera.focalLength}px`;
    const indices = visibleIndices(state.count, Math.max(0, viewFocus), options.maxVisible ?? 40, state.zoom);
    const wanted = new Set(indices.map(index => controller.getKey(index)!));
    for (const [key, pane] of mounted) if (!wanted.has(key)) removePane(key, pane);
    for (const index of indices) {
      const key = controller.getKey(index)!;
      let pane = mounted.get(key);
      const item = controller.getItems()[index];
      if (pane && (pane.item !== item || pane.index !== index)) { removePane(key, pane); pane = undefined; }
      if (!pane) { pane = makePane(index); mounted.set(key, pane); }
      const at = geometry.positionAt(index);
      const relative = at.map((value, i) => value - camera.position[i]);
      const x = dot(relative, camera.right), y = -dot(relative, camera.up), depth = dot(relative, camera.direction);
      const focused = index === state.focus;
      pane.element.style.width = `${geometry.paneWidth}px`;
      pane.element.style.height = `${geometry.paneHeight}px`;
      // Local horizontal is world +Z; local vertical is world -Y. Each plane has the same rotation.
      const matrix = [camera.right[2], -camera.up[2], -camera.direction[2], 0,
        -camera.right[1], camera.up[1], camera.direction[1], 0,
        camera.right[0], -camera.up[0], -camera.direction[0], 0,
        x, y, camera.focalLength - depth, 1];
      pane.element.style.transform = `translate(-50%,-50%) matrix3d(${matrix.join(',')})`;
      pane.element.style.visibility = depth <= 1 ? 'hidden' : '';
      pane.element.style.setProperty('--prismdeck-distance', String(Math.min(1, Math.abs(index - viewFocus) / 20)));
      pane.element.classList.toggle('is-focused', focused);
      pane.element.classList.toggle('is-selected', key === state.selectedKey);
      const hit = pane.element.lastElementChild as HTMLButtonElement;
      hit.tabIndex = focused ? 0 : -1;
      hit.setAttribute('aria-pressed', String(key === state.selectedKey));
      pane.element.setAttribute('aria-label', `${controller.getLabel(index)}, ${index + 1} of ${state.count}`);
    }
    const text = state.count ? `${controller.getLabel(state.focus)} · ${state.focus + 1} / ${state.count}` : 'No panes';
    if (status.textContent !== text) status.textContent = text;
    zoom.value = String(state.zoom);
    zoom.setAttribute('aria-valuetext', `${Math.round(state.zoom * 100)}% overview`);
    previous.disabled = state.focus <= 0; next.disabled = state.focus >= state.count - 1;
    select.disabled = state.count === 0;
    controls.hidden = options.controls === false;
    element.dataset.prismdeckCount = String(state.count);
    element.dataset.prismdeckMounted = String(mounted.size);
    if (viewFocus !== state.focus || viewZoom !== state.zoom) schedule();
  }
  function schedule() { if (!disposed && !frame) frame = requestAnimationFrame(render); }
  const unsubscribe = controller.subscribe(schedule);
  const resize = () => { width = Math.max(1, viewport.clientWidth); height = Math.max(1, viewport.clientHeight); schedule(); };
  const observer = new ResizeObserver(resize);
  observer.observe(viewport);
  const onKey = (event: KeyboardEvent) => {
    if ((event.target as Element).closest('.prismdeck') !== element) return;
    if (event.ctrlKey || event.metaKey || event.altKey || (isControl(event.target) && !(event.target as Element).closest('.prismdeck-pane-select'))) return;
    if ((event.key === 'Enter' || event.key === ' ') && (event.target as Element).closest('.prismdeck-pane-select')) return;
    switch (event.key) {
      case 'ArrowRight': case 'ArrowDown': controller.move(1); break;
      case 'ArrowLeft': case 'ArrowUp': controller.move(-1); break;
      case 'Home': controller.focus(0); break;
      case 'End': controller.focus(controller.getSnapshot().count - 1); break;
      case 'PageDown': controller.move(10); break;
      case 'PageUp': controller.move(-10); break;
      case '+': case '=': controller.setZoom(controller.getSnapshot().zoom - 0.12); break;
      case '-': case '_': controller.setZoom(controller.getSnapshot().zoom + 0.12); break;
      case 'Enter': case ' ': controller.select(); break;
      case 'Escape': controller.dismiss(); options.onDismiss?.(); break;
      default: return;
    }
    event.preventDefault();
  };
  let wheelFocus = controller.getSnapshot().focus;
  let wheelTime = 0;
  const onWheel = (event: WheelEvent) => {
    if (isControl(event.target) && !(event.target as Element).closest('.prismdeck-pane-select')) return;
    event.preventDefault();
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
      // Configure validates before replacing state; rejected updates preserve the old widget.
      controller.configure(candidate);
      options = candidate;
      clearPanes();
      element.className = `prismdeck ${options.className ?? ''}`;
      element.setAttribute('aria-label', options.label ?? 'PrismDeck');
      schedule();
    },
    dispose() {
      if (disposed) return;
      disposed = true; cancelAnimationFrame(frame); clearTimeout(suppressTimer);
      observer.disconnect(); unsubscribe(); controller.dispose(); clearPanes();
      window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp);
      pointers.clear(); element.remove();
    },
  };
}
