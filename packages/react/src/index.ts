import {
  createElement,
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { CSSProperties, HTMLAttributes, ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createPrismDeck } from '@prismdeck/dom';
import type { PrismDeckInstance, PrismDeckOptions } from '@prismdeck/dom';

export type PrismDeckProps<T> = Omit<PrismDeckOptions<T>, 'renderPane'> & {
  /** React content is portaled into the visible panes; offscreen panes unmount. */
  renderPane: (item: T, index: number) => ReactNode;
  style?: CSSProperties;
  id?: string;
  /** Receives the live widget, including its framework-independent controller. */
  onReady?: (deck: PrismDeckInstance<T>) => void;
};

interface PortalPane<T> {
  id: string;
  item: T;
  index: number;
  element: HTMLElement;
}

// Keep server rendering free of DOM access and layout-effect warnings.
const useClientLayoutEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect;

/** A virtualized CSS 3D prism. This entry point never imports Three.js or XR. */
export function PrismDeck<T>(props: PrismDeckProps<T>): ReactElement {
  const mount = useRef<HTMLDivElement>(null);
  const instance = useRef<PrismDeckInstance<T> | null>(null);
  const latest = useRef(props);
  const generation = useRef(0);
  const nextId = useRef(0);
  const [panes, setPanes] = useState<Map<string, PortalPane<T>>>(() => new Map());
  latest.current = props;

  useClientLayoutEffect(() => {
    if (!mount.current) return;
    const currentGeneration = ++generation.current;
    const deck = createPrismDeck(mount.current, {
      ...latest.current,
      className: undefined,
      renderPane(item, index) {
        const element = mount.current!.ownerDocument.createElement('div');
        element.style.cssText = 'width:100%;height:100%;overflow:hidden;';
        const id = String(++nextId.current);
        setPanes((previous) => {
          const next = new Map(previous);
          next.set(id, { id, item, index, element });
          return next;
        });
        return {
          element,
          dispose() {
            if (generation.current !== currentGeneration) return;
            setPanes((previous) => {
              if (!previous.has(id)) return previous;
              const next = new Map(previous);
              next.delete(id);
              return next;
            });
          },
        };
      },
      onFocus: (item, index) => latest.current.onFocus?.(item, index),
      onSelect: (item, index) => latest.current.onSelect?.(item, index),
      onDismiss: () => latest.current.onDismiss?.(),
    });
    instance.current = deck;
    latest.current.onReady?.(deck);
    return () => {
      // Disposers from an earlier StrictMode mount must not affect a new mount.
      ++generation.current;
      instance.current = null;
      deck.dispose();
      setPanes(new Map());
    };
  }, []);

  useClientLayoutEffect(() => {
    // Stable bridges above read the latest callbacks. Updating content settings
    // reconciles the bounded visible window without recreating the controller.
    instance.current?.update({
      items: props.items,
      getKey: props.getKey,
      adapter: props.adapter,
      axis: props.axis,
      maxVisible: props.maxVisible,
      label: props.label,
      controls: props.controls,
    });
  }, [props.items, props.getKey, props.adapter, props.axis, props.maxVisible, props.label, props.controls]);

  return createElement(
    Fragment,
    null,
    createElement('div', {
      ref: mount,
      id: props.id,
      className: props.className,
      style: { width: '100%', height: '100%', minHeight: 280, ...props.style },
    }),
    ...Array.from(panes.values(), (pane) =>
      createPortal(props.renderPane(pane.item, pane.index), pane.element, pane.id),
    ),
  );
}

/** A semantic wrapper for custom pane content, with ordinary React DOM props. */
export function Pane(props: HTMLAttributes<HTMLDivElement>): ReactElement {
  return createElement('div', {
    ...props,
    'data-prism-pane': '',
    style: { width: '100%', height: '100%', ...props.style },
  });
}

const noSubscription = () => () => {};
const noSnapshot = () => null;

/** Subscribe to a controller shared by DOM, React, Three.js, or application UI. */
export function usePrismDeck<T>(controller: PrismDeckInstance<T>['controller'] | null | undefined) {
  return useSyncExternalStore(
    controller?.subscribe ?? noSubscription,
    controller?.getSnapshot ?? noSnapshot,
    noSnapshot,
  );
}

export type { PrismDeckInstance, PrismDeckOptions } from '@prismdeck/dom';
