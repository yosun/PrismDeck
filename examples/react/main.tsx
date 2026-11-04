import * as React from 'react';
import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PrismDeck } from '@prismdeck/react';
import '@prismdeck/dom/style.css';
import '../vanilla/style.css';

type Slide = { id: string; index: number; title: string; color: string; accent: string };
const subjects = [
  ['Contours of tomorrow', '#d7e8ae', '#325e54'],
  ['A quieter frequency', '#e9c6a0', '#795153'],
  ['Between the blue', '#bdd9f0', '#375676'],
  ['The shape of motion', '#e9d0e6', '#654b78'],
  ['An open horizon', '#efdfa5', '#5c6b4b'],
];

/** Local SVG thumbnails keep the example portable and independent of APIs. */
function thumbnail(slide: Slide): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1440 900"><rect width="1440" height="900" fill="${slide.color}"/><circle cx="1080" cy="310" r="185" fill="${slide.accent}" opacity=".15"/><path d="M0 660Q300 280 720 610T1440 470V900H0Z" fill="${slide.accent}" opacity=".65"/><path d="M0 800Q450 420 960 750T1440 660V900H0Z" fill="${slide.accent}"/><g fill="${slide.accent}" font-family="Arial,Helvetica,sans-serif"><text x="76" y="90" font-size="19" letter-spacing="5">STUDIES IN PERSPECTIVE</text><text x="76" y="215" font-size="68">${slide.title}</text><text x="78" y="270" font-size="20" letter-spacing="3">FORM / COLOR / POSSIBILITY</text></g><text x="76" y="836" fill="${slide.color}" font-family="Arial,Helvetica,sans-serif" font-size="21" letter-spacing="2">PRISMDECK / ${String(slide.index + 1).padStart(3, '0')}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function MyContent({ item }: { item: Slide }) {
  return <img src={thumbnail(item)} alt={`${item.title}, synthetic study ${item.index + 1}`} draggable={false} decoding="async" />;
}

function App() {
  const [count, setCount] = useState(1000);
  const items = useMemo<Slide[]>(() => Array.from({ length: count }, (_, index) => {
    const [title, color, accent] = subjects[index % subjects.length];
    return { id: `slide-${index}`, index, title, color, accent };
  }), [count]);
  const [focus, setFocus] = useState(0);
  const [selected, setSelected] = useState<Slide | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const focused = items[Math.min(focus, items.length - 1)];

  useEffect(() => {
    if (selected && dialog.current && !dialog.current.open) dialog.current.showModal();
    if (!selected && dialog.current?.open) dialog.current.close();
  }, [selected]);

  return (
    <div className="page-shell react-shell">
      <header className="site-header"><a className="brand" href="./"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>PrismDeck<span className="version">REACT</span></a><nav aria-label="Project links"><a href="https://github.com/yosun/PrismDeck#readme">Documentation ↗</a><a href="https://github.com/yosun/PrismDeck">GitHub ↗</a></nav></header>
      <main>
        <section className="intro" aria-labelledby="intro-title"><div><p className="eyebrow"><span /> YOUR CONTENT. YOUR COMPONENTS.</p><h1 id="intro-title">A new angle on<br /><em>your collection.</em></h1></div><div className="intro-aside"><p>A small React component for a much bigger picture.<br />Bring your content. Keep your application's interactions.</p><div className="feature-tags"><span>React content</span><span>Bounded DOM</span><span>Zero XR loaded</span></div></div></section>

        <section className="gallery" aria-labelledby="collection-title">
          <div className="gallery-topbar"><div><p className="eyebrow">REACT EXAMPLE</p><h2 id="collection-title">Studies in perspective <span>{count.toLocaleString()} panes</span></h2></div><label className="collection-picker">Collection size <select value={count} onChange={(event) => setCount(Number(event.target.value))}><option value="100">100 panes</option><option value="1000">1,000 panes</option><option value="10000">10,000 panes</option></select></label></div>
          <div className="deck-stage"><div className="stage-label"><span className="live-dot" /> LIVE PRISM <span className="stage-hint">Drag · Scroll · Pinch</span></div><div className="react-deck-host">
            <PrismDeck
              items={items}
              getKey={(item) => item.id}
              adapter={{ getKey: (item) => item.id, getLabel: (item) => `${item.title}, pane ${item.index + 1}` }}
              renderPane={(item) => <MyContent item={item} />}
              onFocus={(_item, index) => setFocus(index)}
              onSelect={(item) => setSelected(item)}
              maxVisible={40}
              label="Browse the studies in perspective slide collection"
            />
          </div><span className="stage-axis" aria-hidden="true">SEQUENCE →</span></div>
          <div className="selection-bar"><div className="focus-info"><span className="focus-number">{String(focused.index + 1).padStart(3, '0')}</span><div><p className="eyebrow">FORM / COLOR / POSSIBILITY</p><h3>{focused.title}</h3></div></div><button className="primary-button" onClick={() => setSelected(focused)}>Open pane <span aria-hidden="true">↗</span></button></div>
        </section>
        <section className="below-gallery" aria-label="Navigation help"><div className="input-help"><span className="keycap">←</span><span className="keycap">→</span><span>Navigate</span><span className="keycap">+ / −</span><span>Density</span><span className="keycap">↵</span><span>Open</span></div><p>{Math.min(focus + 1, count).toLocaleString()} / {count.toLocaleString()} · 40 mounted panes maximum</p></section>
        <section className="library-note"><div><p className="eyebrow">RENDER ANY REACT CONTENT</p><p>The prism handles navigation.<br />Your components handle what comes next.</p></div><a className="text-button" href="https://github.com/yosun/PrismDeck/tree/main/examples/react">Read the example source ↗</a></section>
      </main>
      <footer><span>PrismDeck <span className="footer-dot">·</span> MIT licensed</span><span>React binding · No Three.js or XR imports</span></footer>
      <dialog ref={dialog} className="pane-dialog" onClose={() => setSelected(null)}><div className="dialog-heading"><div><p className="eyebrow">APPLICATION SELECTION VIEW</p><h2>{selected?.title}</h2></div><button className="icon-button" aria-label="Close pane" onClick={() => setSelected(null)}>×</button></div>{selected && <MyContent item={selected} />}<p className="dialog-note">This is ordinary React UI opened by onSelect. Replace it with your slide editor, document viewer, or application action.</p></dialog>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
