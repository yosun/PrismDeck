import {
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Texture, WebGLRendererParameters } from 'three';
import { getPrismGeometry, visibleIndices } from '@prismdeck/core';
import type { DeckController, PrismKey, ViewAngle } from '@prismdeck/core';

export interface PrismImage {
  url: string;
  width?: number;
  height?: number;
}

export interface ThreePrismDeckOptions<T> {
  controller: DeckController<T>;
  /** Called only for the bounded visible window. Supply thumbnail URLs here. */
  getImage(item: T, index: number): string | PrismImage;
  getPosition?: (item: T, index: number) => number;
  maxVisible?: number;
  paneWidth?: number;
  paneHeight?: number;
  /** Physical pane width in meters when using this renderer in XR. */
  physicalWidth?: number;
  pixelRatio?: number;
  label?: string;
  /** Enable on-screen viewing-angle gestures and keyboard shortcuts (default true). */
  cameraControls?: boolean;
  crossOrigin?: string;
  rendererOptions?: Omit<WebGLRendererParameters, 'canvas'>;
  onError?: (error: unknown) => void;
}

export interface ThreePrismDeckInstance {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  resize(): void;
  /** Releases GPU resources and ends this renderer's immersive session, if any. */
  dispose(): void;
}

interface ImagePane<T> {
  key: PrismKey;
  item: T;
  index: number;
  url: string;
  image: PrismImage;
  mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  texture?: Texture;
  disposed: boolean;
}

/**
 * Optional WebGL renderer. Import this package only when WebGL is wanted.
 * The XR session helper lives in the separate `@prismdeck/three/xr` entry point.
 * Desktop rendering is demand-driven; continuous frames run only during XR.
 */
export function createThreePrismDeck<T>(
  mount: HTMLElement,
  options: ThreePrismDeckOptions<T>,
): ThreePrismDeckInstance {
  const { controller } = options;
  const view = mount.ownerDocument.defaultView;
  if (!view) throw new Error('PrismDeck Three requires a browser document.');

  const renderer = new WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: 'low-power',
    ...options.rendererOptions,
  });
  renderer.setPixelRatio(Math.max(0.5, Math.min(2, options.pixelRatio ?? view.devicePixelRatio ?? 1)));
  const canvas = renderer.domElement;
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'application');
  canvas.setAttribute('aria-label', options.label ?? `PrismDeck. Arrow keys browse; Enter selects; plus and minus change density.${options.cameraControls === false ? '' : ' Shift-drag or right-drag changes viewing angle; Alt-arrow keys rotate; 0 resets the view.'}`);
  mount.append(canvas);

  const scene = new Scene();
  const volume = new Group();
  scene.add(volume);
  const camera = new PerspectiveCamera(42, 1, 0.001, 10000);
  const sharedGeometry = new PlaneGeometry(1, 1);
  const loader = new TextureLoader();
  loader.setCrossOrigin(options.crossOrigin ?? 'anonymous');
  const panes = new Map<PrismKey, ImagePane<T>>();
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const vector = new Vector3();
  const direction = new Vector3();
  let width = 1;
  let height = 1;
  let disposed = false;
  let frame = 0;
  let positionedItems: readonly T[] | undefined;
  let suppliedPositions: readonly number[] | undefined;
  let drag: { id: number; x: number; y: number; focus: number; moved: boolean; orbit: boolean; view: ViewAngle } | null = null;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { distance: number; zoom: number } | null = null;
  let xrCleanup: (() => void) | undefined;

  function render(): void {
    frame = 0;
    if (!disposed && !renderer.xr.isPresenting) renderer.render(scene, camera);
  }

  function invalidate(): void {
    if (!disposed && !renderer.xr.isPresenting && !frame) frame = view!.requestAnimationFrame(render);
  }

  function release(pane: ImagePane<T>): void {
    pane.disposed = true;
    volume.remove(pane.mesh);
    pane.texture?.dispose();
    pane.mesh.material.dispose();
  }

  function fitImage(pane: ImagePane<T>, paneWidth: number, paneHeight: number): void {
    const image = pane.texture?.image as { width?: number; height?: number } | undefined;
    const imageWidth = pane.image.width ?? image?.width ?? paneWidth;
    const imageHeight = pane.image.height ?? image?.height ?? paneHeight;
    const ratio = imageWidth > 0 && imageHeight > 0 ? imageWidth / imageHeight : paneWidth / paneHeight;
    pane.mesh.scale.set(Math.min(paneWidth, paneHeight * ratio), Math.min(paneHeight, paneWidth / ratio), 1);
  }

  function synchronize(): void {
    if (disposed) return;
    const snapshot = controller.getSnapshot();
    const items = controller.getItems();
    if (options.getPosition && positionedItems !== items) {
      positionedItems = items;
      suppliedPositions = Object.freeze(items.map(options.getPosition));
    }
    const geometry = getPrismGeometry({
      count: snapshot.count,
      focus: snapshot.focus,
      zoom: snapshot.zoom,
      width,
      height,
      paneWidth: options.paneWidth,
      paneHeight: options.paneHeight,
      positions: options.getPosition ? suppliedPositions : controller.getPositions(),
      // Headset pose remains native; user orbit applies only to the screen view.
      view: renderer.xr.isPresenting ? undefined : snapshot.view,
    });
    const indices = visibleIndices(snapshot.count, snapshot.focus, options.maxVisible ?? 40, snapshot.zoom);
    const keep = new Set(indices.map((index) => controller.getKey(index)!));
    for (const [key, pane] of panes) {
      if (!keep.has(key)) {
        release(pane);
        panes.delete(key);
      }
    }

    for (const index of indices) {
      const key = controller.getKey(index)!;
      const item = items[index];
      let image: PrismImage;
      try {
        const supplied = options.getImage(item, index);
        image = typeof supplied === 'string' ? { url: supplied } : supplied;
      } catch (error) {
        options.onError?.(error);
        continue;
      }
      let pane = panes.get(key);
      if (pane && pane.url !== image.url) {
        release(pane);
        panes.delete(key);
        pane = undefined;
      }
      if (!pane) {
        const material = new MeshBasicMaterial({ color: 0x8493a7, side: DoubleSide, toneMapped: false });
        const mesh = new Mesh(sharedGeometry, material);
        mesh.rotation.y = -Math.PI / 2;
        pane = { key, item, index, image, url: image.url, mesh, disposed: false };
        panes.set(key, pane);
        volume.add(mesh);
        const loadingPane = pane;
        if (image.url) {
          pane.texture = loader.load(image.url, (texture) => {
            if (disposed || loadingPane.disposed) { texture.dispose(); return; }
            texture.colorSpace = SRGBColorSpace;
            loadingPane.mesh.material.map = texture;
            loadingPane.mesh.material.needsUpdate = true;
            fitImage(loadingPane, geometry.paneWidth, geometry.paneHeight);
            invalidate();
          }, undefined, (error) => {
            if (!disposed && !loadingPane.disposed) options.onError?.(error);
          });
        }
      }
      pane.item = item;
      pane.index = index;
      pane.image = image;
      pane.mesh.userData.prismIndex = index;
      pane.mesh.position.fromArray(geometry.positionAt(index));
      pane.mesh.material.color.setHex(index === snapshot.focus ? 0xffffff : 0xc5cbd4);
      fitImage(pane, geometry.paneWidth, geometry.paneHeight);
    }

    // The same unitless geometry is scaled to comfortable physical dimensions.
    const physicalWidth = Number.isFinite(options.physicalWidth) && options.physicalWidth! > 0 ? options.physicalWidth! : 0.8;
    const scale = physicalWidth / geometry.paneWidth;
    volume.scale.setScalar(scale);
    if (renderer.xr.isPresenting) {
      volume.rotation.y = Math.PI / 2;
      vector.fromArray(geometry.positionAt(snapshot.focus)).multiplyScalar(scale).applyEuler(volume.rotation);
      volume.position.set(-vector.x, -vector.y, -1.5 - vector.z);
    } else {
      volume.rotation.set(0, 0, 0);
      volume.position.set(0, 0, 0);
      camera.aspect = width / height;
      camera.fov = 2 * Math.atan(height / (2 * geometry.camera.focalLength)) * 180 / Math.PI;
      camera.position.fromArray(geometry.camera.position).multiplyScalar(scale);
      camera.up.fromArray(geometry.camera.up);
      vector.fromArray(geometry.camera.direction).add(camera.position);
      camera.lookAt(vector);
      camera.far = Math.max(100, (geometry.length + Math.hypot(...geometry.camera.position)) * scale * 3);
      camera.updateProjectionMatrix();
    }
    scene.updateMatrixWorld(true);
    invalidate();
  }

  function resize(): void {
    if (disposed) return;
    const bounds = mount.getBoundingClientRect();
    width = Math.max(1, bounds.width);
    height = Math.max(1, bounds.height);
    if (!renderer.xr.isPresenting) renderer.setSize(width, height, false);
    synchronize();
  }

  function pointedIndex(event: PointerEvent): number | undefined {
    const bounds = canvas.getBoundingClientRect();
    pointer.set((event.clientX - bounds.left) / Math.max(1, bounds.width) * 2 - 1,
      -(event.clientY - bounds.top) / Math.max(1, bounds.height) * 2 + 1);
    camera.updateMatrixWorld();
    raycaster.setFromCamera(pointer, camera);
    return hitIndex();
  }

  function hitIndex(): number | undefined {
    const hit = raycaster.intersectObjects(Array.from(panes.values(), (pane) => pane.mesh), false)[0];
    return hit?.object.userData.prismIndex as number | undefined;
  }

  function pointerDown(event: PointerEvent): void {
    const orbit = options.cameraControls !== false && !renderer.xr.isPresenting
      && (event.button === 2 || (event.button === 0 && event.shiftKey));
    if (event.button !== 0 && !orbit) return;
    if (orbit) event.preventDefault();
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      pinch = { distance: pointerDistance(), zoom: controller.getSnapshot().zoom };
      drag = null;
    } else if (!pinch) {
      const state = controller.getSnapshot();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, focus: state.focus, moved: false, orbit, view: state.view };
    }
  }

  function pointerDistance(): number {
    const [a, b] = pointers.values();
    return a && b ? Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)) : 1;
  }

  function pointerMove(event: PointerEvent): void {
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && pointers.size >= 2) {
      controller.setZoom(pinch.zoom - Math.log(pointerDistance() / pinch.distance) / 1.5);
      return;
    }
    if (drag?.id === event.pointerId) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 5) drag.moved = true;
      if (drag.moved) {
        if (drag.orbit && !renderer.xr.isPresenting) {
          controller.setView({ yaw: drag.view.yaw + (event.clientX - drag.x) * 0.2,
            pitch: drag.view.pitch - (event.clientY - drag.y) * 0.2 });
        } else if (!drag.orbit) controller.focus(drag.focus + Math.round((drag.x - event.clientX) / 28));
      }
    } else if (event.pointerType !== 'touch') {
      const index = pointedIndex(event);
      canvas.style.cursor = index === undefined ? 'grab' : 'pointer';
    }
  }

  function pointerUp(event: PointerEvent): void {
    const select = drag?.id === event.pointerId && !drag.moved && !drag.orbit && !pinch;
    pointers.delete(event.pointerId);
    if (drag?.id === event.pointerId) drag = null;
    if (!pointers.size) pinch = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (select) {
      const index = pointedIndex(event);
      if (index !== undefined) controller.select(index);
    }
  }

  function pointerCancel(event: PointerEvent): void {
    pointers.delete(event.pointerId);
    drag = null;
    if (!pointers.size) pinch = null;
  }

  let wheelFocus = controller.getSnapshot().focus;
  let wheelTime = 0;
  function wheel(event: WheelEvent): void {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? height : 1;
    const state = controller.getSnapshot();
    if (event.ctrlKey || Math.abs(event.deltaY) >= Math.abs(event.deltaX)) {
      controller.setZoom(state.zoom + event.deltaY * unit / (event.ctrlKey ? 360 : 900));
    } else {
      const now = view!.performance.now();
      if (now - wheelTime > 180) wheelFocus = state.focus;
      wheelTime = now;
      wheelFocus = Math.max(0, Math.min(state.count - 1, wheelFocus + event.deltaX * unit / 110));
      controller.focus(wheelFocus);
    }
  }

  function keyDown(event: KeyboardEvent): void {
    const state = controller.getSnapshot();
    if (event.altKey) {
      if (options.cameraControls === false || renderer.xr.isPresenting) return;
      switch (event.key) {
        case 'ArrowRight': controller.setView({ yaw: state.view.yaw + 5 }); break;
        case 'ArrowLeft': controller.setView({ yaw: state.view.yaw - 5 }); break;
        case 'ArrowUp': controller.setView({ pitch: state.view.pitch + 5 }); break;
        case 'ArrowDown': controller.setView({ pitch: state.view.pitch - 5 }); break;
        default: return;
      }
      event.preventDefault();
      return;
    }
    switch (event.key) {
      case 'ArrowRight': case 'ArrowDown': controller.move(1); break;
      case 'ArrowLeft': case 'ArrowUp': controller.move(-1); break;
      case 'PageDown': controller.move(10); break;
      case 'PageUp': controller.move(-10); break;
      case 'Home': controller.focus(0); break;
      case 'End': controller.focus(state.count - 1); break;
      case 'Enter': case ' ': controller.select(); break;
      case 'Escape': controller.dismiss(); break;
      case '+': case '=': controller.setZoom(state.zoom - 0.12); break;
      case '-': case '_': controller.setZoom(state.zoom + 0.12); break;
      case '0':
        if (options.cameraControls === false || renderer.xr.isPresenting) return;
        controller.resetView(); break;
      default: return;
    }
    event.preventDefault();
  }

  function contextMenu(event: MouseEvent): void {
    if (options.cameraControls !== false && !renderer.xr.isPresenting) event.preventDefault();
  }

  function sessionStart(): void {
    if (disposed) return;
    if (frame) { view!.cancelAnimationFrame(frame); frame = 0; }
    camera.position.set(0, 0, 0);
    camera.quaternion.identity();
    const cleanups: Array<() => void> = [];
    for (let index = 0; index < 2; index++) {
      const input = renderer.xr.getController(index);
      const select = () => {
        input.updateWorldMatrix(true, false);
        raycaster.ray.origin.setFromMatrixPosition(input.matrixWorld);
        direction.set(0, 0, -1).transformDirection(input.matrixWorld);
        raycaster.ray.direction.copy(direction);
        const hit = hitIndex();
        if (hit !== undefined) controller.select(hit);
      };
      input.addEventListener('select', select);
      scene.add(input);
      cleanups.push(() => { input.removeEventListener('select', select); scene.remove(input); });
    }
    xrCleanup = () => cleanups.forEach((cleanup) => cleanup());
    synchronize();
    renderer.setAnimationLoop(() => { if (!disposed) renderer.render(scene, camera); });
  }

  function sessionEnd(): void {
    renderer.setAnimationLoop(null);
    xrCleanup?.();
    xrCleanup = undefined;
    if (!disposed) synchronize();
  }

  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerCancel);
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('keydown', keyDown);
  canvas.addEventListener('contextmenu', contextMenu);
  renderer.xr.addEventListener('sessionstart', sessionStart);
  renderer.xr.addEventListener('sessionend', sessionEnd);
  const unsubscribe = controller.subscribe(synchronize);
  const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(resize);
  resizeObserver?.observe(mount);
  if (!resizeObserver) view.addEventListener('resize', resize);
  resize();

  return {
    renderer,
    scene,
    camera,
    resize,
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      resizeObserver?.disconnect();
      view.removeEventListener('resize', resize);
      if (frame) view.cancelAnimationFrame(frame);
      renderer.setAnimationLoop(null);
      xrCleanup?.();
      renderer.xr.removeEventListener('sessionstart', sessionStart);
      renderer.xr.removeEventListener('sessionend', sessionEnd);
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerUp);
      canvas.removeEventListener('pointercancel', pointerCancel);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('keydown', keyDown);
      canvas.removeEventListener('contextmenu', contextMenu);
      for (const pane of panes.values()) release(pane);
      panes.clear();
      pointers.clear();
      sharedGeometry.dispose();
      canvas.remove();
      const session = renderer.xr.getSession();
      if (session) void session.end().catch((error) => options.onError?.(error)).finally(() => renderer.dispose());
      else renderer.dispose();
    },
  };
}
