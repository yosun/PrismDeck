import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createDeckController } from '../packages/core/dist/index.js';
import { Pane, PrismDeck, usePrismDeck } from '../packages/react/dist/index.js';

test('React PrismDeck server rendering needs no browser or pane resources', () => {
  assert.equal(typeof document, 'undefined');
  let mounted = 0;
  const markup = renderToString(createElement(PrismDeck, {
    items: Array.from({ length: 10000 }, (_, id) => ({ id })),
    getKey: (item) => item.id,
    renderPane() { mounted++; return createElement('img', { src: '/unrequested.png' }); },
    onReady() { assert.fail('No DOM widget should mount on the server'); },
    id: 'deck',
  }));
  assert.match(markup, /id="deck"/);
  assert.equal(mounted, 0);
  assert.doesNotMatch(markup, /img|canvas|unrequested/);
});

test('Pane preserves application DOM properties and custom content', () => {
  const markup = renderToString(createElement(Pane, {
    className: 'slide',
    style: { height: 200 },
    'aria-label': 'Slide one',
  }, 'Application content'));
  assert.match(markup, /class="slide"/);
  assert.match(markup, /aria-label="Slide one"/);
  assert.match(markup, /height:200px/);
  assert.match(markup, /Application content/);
});

test('usePrismDeck has a stable null server snapshot without subscriptions', () => {
  const controller = createDeckController({ items: ['first', 'second'] });
  let subscribed = 0;
  const source = { ...controller, subscribe() { subscribed++; assert.fail('Server rendering must not subscribe'); } };
  function Status() {
    const snapshot = usePrismDeck(source);
    return createElement('span', null, snapshot === null ? 'pending' : snapshot.count);
  }
  assert.equal(renderToString(createElement(Status)), '<span>pending</span>');
  assert.equal(renderToString(createElement(Status)), '<span>pending</span>');
  assert.equal(subscribed, 0);
  controller.dispose();
});
