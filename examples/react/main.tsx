import * as React from 'react';
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PrismDeck, PRISMDECK_PRESETS as presets } from '@prismdeck/react';
import type { PrismDeckInstance, PrismDeckVariant as Variant, PrismDeckSelectionMode as SelectionMode } from '@prismdeck/react';
import '@prismdeck/dom/style.css';
import '../vanilla/style.css';

import { collection, imageSource } from '../shared/slides';
import type { Slide } from '../shared/slides';
import { applyDemoTheme, getDemoTheme, watchSystemTheme } from '../shared/theme';
import type { DemoTheme } from '../shared/theme';

function MyContent({ item }: { item: Slide }) {
  return <img src={imageSource(item)} alt={`${item.title}, synthetic study ${item.index + 1}`} draggable={false} decoding="async" />;
}

const getKey = (item: Slide) => item.id;
const adapter = { getKey, getLabel: (item: Slide) => `${item.title}, pane ${item.index + 1}` };
const renderPane = (item: Slide) => <MyContent item={item} />;

function App() {
  const [count, setCount] = useState(1000);
  const items = useMemo(() => collection(count), [count]);
  const [theme, setTheme] = useState<DemoTheme>(getDemoTheme);
  useEffect(() => {
    applyDemoTheme(theme, false);
  }, [theme]);
  useEffect(() => watchSystemTheme(setTheme), []);
  function chooseTheme(next: DemoTheme) {
    applyDemoTheme(next);
    setTheme(next);
  }
  const [focus, setFocus] = useState(0);
  const [variant, setVariant] = useState<Variant>(() => new URL(location.href).searchParams.get('variant') === 'B' ? 'B' : 'A');
  const [prismLines, setPrismLines] = useState<boolean | undefined>();
  const [timelineRails, setTimelineRails] = useState<boolean | undefined>();
  const [selectionMode, setSelectionMode] = useState<SelectionMode | undefined>();
  const [status, setStatus] = useState('Select a pane to bring it into view.');
  const deck = useRef<PrismDeckInstance<Slide> | null>(null);
  const focused = items[Math.min(focus, items.length - 1)];
  const handleReady = useCallback((instance: PrismDeckInstance<Slide>) => { deck.current = instance; }, []);
  const handleFocus = useCallback((_item: Slide, index: number) => setFocus(index), []);
  const handleSelect = useCallback((item: Slide, index: number) => {
    setStatus(`Selected ${index + 1}: ${item.title}. Select it again to activate.`);
  }, []);
  const handleActivate = useCallback((item: Slide) => {
    setStatus(`Activated “${item.title}”.`);
  }, []);
  const handleDismiss = useCallback(() => setStatus('Back in the deck. Select another pane to explore.'), []);

  function chooseVariant(next: Variant) {
    deck.current?.controller.dismiss();
    setVariant(next);
    setPrismLines(undefined);
    setTimelineRails(undefined);
    setSelectionMode(undefined);
    setStatus('Select a pane to bring it into view.');
    const url = new URL(location.href);
    url.searchParams.set('variant', next);
    history.replaceState(history.state, '', url);
  }

  return (
    <div className="page-shell react-shell">
      <header className="site-header"><a className="brand" href="./"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>PrismDeck<span className="version">REACT</span></a><div className="header-actions"><div className="theme-switch" role="group" aria-label="Color theme"><button id="theme-light" type="button" aria-pressed={theme === 'light'} onClick={() => chooseTheme('light')}>Day</button><button id="theme-dark" type="button" aria-pressed={theme === 'dark'} onClick={() => chooseTheme('dark')}>Night</button></div><nav aria-label="Project links"><a href="https://github.com/yosun/PrismDeck#readme">Documentation ↗</a><a href="https://github.com/yosun/PrismDeck">GitHub ↗</a></nav></div></header>
      <main>
        <section className="intro" aria-labelledby="intro-title"><div><p className="eyebrow"><span /> YOUR CONTENT. YOUR COMPONENTS.</p><h1 id="intro-title">A new angle on<br /><em>your collection.</em></h1></div><div className="intro-aside"><p>A small React component for a much bigger picture.<br />Bring your content. Choose how it comes into view.</p><div className="feature-tags"><span>React content</span><span>Bounded rendering</span><span>Zero XR loaded</span></div></div></section>

        <section className="gallery" aria-labelledby="collection-title">
          <div className="gallery-topbar"><div><p className="eyebrow">REACT EXAMPLE</p><h2 id="collection-title">Studies in perspective <span>{count.toLocaleString()} panes</span></h2></div><label className="collection-picker">Collection size <select value={count} onChange={(event) => setCount(Number(event.target.value))}><option value="100">100 panes</option><option value="1000">1,000 panes</option><option value="10000">10,000 panes</option></select></label></div>
          <div className="experience-controls">
            <div className="variant-switch" role="group" aria-label="Selection experience">
              <button type="button" aria-pressed={variant === 'A'} onClick={() => chooseVariant('A')}><strong>Version A</strong><span>Seamless slide-out</span></button>
              <button type="button" aria-pressed={variant === 'B'} onClick={() => chooseVariant('B')}><strong>Version B</strong><span>Modal</span></button>
            </div>
            <p className="variant-description">{(selectionMode ?? presets[variant].selectionMode) === 'slide-out' ? 'Slide a pane out of the prism. Keep your place in the collection.' : selectionMode === 'none' ? 'Select a pane while keeping the collection in view.' : 'Open a pane in a modal. Return to the deck when you are ready.'}</p>
            <div className="feature-controls" role="group" aria-label="Independent display options">
              <label><input type="checkbox" checked={prismLines ?? presets[variant].prismLines} onChange={(event) => setPrismLines(event.target.checked)} /> Prism lines</label>
              <label><input type="checkbox" checked={timelineRails ?? presets[variant].timelineRails} onChange={(event) => setTimelineRails(event.target.checked)} /> Timeline rails</label>
              <label className="selection-mode-label">Selection <select value={selectionMode ?? presets[variant].selectionMode} onChange={(event) => setSelectionMode(event.target.value as SelectionMode)}><option value="slide-out">Slide-out</option><option value="modal">Modal</option><option value="none">App-defined</option></select></label>
            </div>
          </div>
          <div className="deck-stage"><div className="stage-label"><span className="live-dot" /> LIVE PRISM <span className="stage-hint">Drag · Scroll · Pinch</span></div><div className="react-deck-host">
            <PrismDeck
              items={items}
              getKey={getKey}
              adapter={adapter}
              renderPane={renderPane}
              variant={variant}
              theme={theme}
              selectionMode={selectionMode}
              prismLines={prismLines}
              timelineRails={timelineRails}
              onReady={handleReady}
              onFocus={handleFocus}
              onSelect={handleSelect}
              onActivate={handleActivate}
              onDismiss={handleDismiss}
              maxVisible={40}
              label="Browse the studies in perspective slide collection"
            />
          </div><span className="stage-axis" aria-hidden="true">SEQUENCE →</span></div>
          <div className="selection-bar"><div className="focus-info"><span className="focus-number">{String(focused.index + 1).padStart(3, '0')}</span><div><p className="eyebrow">FORM / TONE / POSSIBILITY</p><h3>{focused.title}</h3></div></div><button className="primary-button" onClick={() => deck.current?.controller.select()}>View pane <span aria-hidden="true">↗</span></button></div>
          <p className="selection-status" role="status">{status}</p>
        </section>
        <section className="below-gallery" aria-label="Navigation help"><div className="input-help"><span className="keycap">←</span><span className="keycap">→</span><span>Navigate</span><span className="keycap">+ / −</span><span>Density</span><span className="keycap">↵</span><span>Select</span></div><p>{Math.min(focus + 1, count).toLocaleString()} / {count.toLocaleString()} · 40 preview panes maximum</p></section>
        <section className="library-note"><div><p className="eyebrow">RENDER ANY REACT CONTENT</p><p>One widget. Two ways into the details.<br />Mix the options to make it your own.</p></div><a className="text-button" href="https://github.com/yosun/PrismDeck/tree/main/examples/react">Read the example source ↗</a></section>
      </main>
      <footer><span>PrismDeck <span className="footer-dot">·</span> MIT licensed</span><span>React binding · No Three.js or XR imports</span></footer>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
