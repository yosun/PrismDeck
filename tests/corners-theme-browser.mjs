import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url);
const address = 'http://127.0.0.1:5211';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'examples/vanilla', '--host', '127.0.0.1', '--port', '5211', '--strictPort'], { cwd: root, stdio: 'pipe' });
let serverOutput = '';
server.stderr.on('data', (data) => { serverOutput += data; });
const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  html,body{margin:0;background:#ddd;font:16px system-ui}main{max-width:1100px;margin:20px auto}.mount{height:620px;width:100%}@media(max-width:480px){main{margin:8px}.mount{height:640px}}
  </style></head><body><main><div id="deck" class="mount"></div></main><script type="module">
  import {createPrismDeck} from '/@fs${new URL('../packages/dom/dist/index.js', import.meta.url).pathname}';
  import '/@fs${new URL('../packages/dom/src/style.css', import.meta.url).pathname}';
  const items=Array.from({length:1000},(_,id)=>({id:'pane-'+id}));
  window.stats={created:0,disposed:0};
  const imageSource='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="white"/><path d="M0 0L1600 900M0 900L1600 0" stroke="black" stroke-width="12"/></svg>');
  window.deck=createPrismDeck(document.querySelector('#deck'),{
    items,getKey:item=>item.id,variant:'A',transitionDuration:0,
    renderPane:item=>{window.stats.created++;const image=new Image();image.src=imageSource;image.alt=item.id;return {element:image,dispose:()=>window.stats.disposed++};},
  });
  </script></body></html>`;

let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Corner/theme test server exited early: ${serverOutput}`);
    try { ready = (await fetch(address)).ok; } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, `Corner/theme test server starts: ${serverOutput}`);
  browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || undefined });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme:'light', reducedMotion:'reduce' });
  await context.route('**/corners-theme-fixture.html', (route) => route.fulfill({ contentType:'text/html', body:fixture }));
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  await page.goto(`${address}/corners-theme-fixture.html`);
  await page.waitForFunction(() => window.deck && document.querySelector('.prismdeck-pane img')?.complete);
  const frames = () => page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  const resolvedTheme = (theme) => page.waitForFunction((theme) => window.deck.element.dataset.prismdeckTheme === theme, theme);
  const neutral = (value, label) => {
    const rgb = value.match(/^rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/);
    assert.ok(rgb, `${label} has an RGB color: ${value}`);
    const channels = rgb.slice(1).map(Number);
    assert.ok(Math.max(...channels) - Math.min(...channels) === 0, `${label} is neutral: ${value}`);
    return channels[0];
  };
  const inspectTheme = () => page.evaluate(() => {
    const deck = window.deck.element;
    const read = (selector, property) => { const node=deck.querySelector(selector); return node ? getComputedStyle(node)[property] : null; };
    return { theme:deck.dataset.prismdeckTheme, background:getComputedStyle(deck).backgroundColor, color:getComputedStyle(deck).color,
      accent:read('.prismdeck-pane.is-focused','outlineColor'), button:read('.prismdeck-controls button','backgroundColor'),
      guide:read('.prismdeck-guide-line','stroke'), rail:read('.prismdeck-guide-rail','stroke'),
      dialog:deck.querySelector('dialog') ? getComputedStyle(deck.querySelector('dialog')).backgroundColor : null };
  });
  const assertTheme = async (theme, {dialog = false} = {}) => {
    await resolvedTheme(theme);
    const values = await inspectTheme();
    assert.equal(neutral(values.background, `${theme} widget background`), theme === 'light' ? 255 : 17);
    neutral(values.color, `${theme} widget text`);
    neutral(values.button, `${theme} control background`);
    if (values.guide) neutral(values.guide, `${theme} prism guides`);
    if (values.rail) neutral(values.rail, `${theme} rails`);
    neutral(values.accent, `${theme} focus accent`);
    if (dialog) assert.equal(neutral(values.dialog, `${theme} modal background`), theme === 'light' ? 255 : 17);
  };

  // Measure the actual CSS-projected pane corners. Bounding rectangles are unsuitable:
  // they lose corner positions once a 3D face is rotated or perspective projected.
  const measureCorners = () => page.evaluate(() => {
    const deck = window.deck.element;
    const lines = [...deck.querySelectorAll('[data-prismdeck-guide="prism"] [data-prismdeck-edge="axis"]')].map((line) => {
      const matrix = line.getScreenCTM();
      const a = new DOMPoint(Number(line.getAttribute('x1')), Number(line.getAttribute('y1'))).matrixTransform(matrix);
      const b = new DOMPoint(Number(line.getAttribute('x2')), Number(line.getAttribute('y2'))).matrixTransform(matrix);
      return {a:{x:a.x,y:a.y},b:{x:b.x,y:b.y}};
    });
    const ends = [...deck.querySelectorAll('[data-prismdeck-guide="prism"] [data-prismdeck-edge="end"]')].flatMap((line) => {
      const matrix = line.getScreenCTM();
      return ['1','2'].map((suffix) => new DOMPoint(Number(line.getAttribute('x'+suffix)), Number(line.getAttribute('y'+suffix))).matrixTransform(matrix));
    });
    const distance = (point, line) => Math.abs((line.b.x-line.a.x)*(line.a.y-point.y)-(line.a.x-point.x)*(line.b.y-line.a.y)) / Math.hypot(line.b.x-line.a.x,line.b.y-line.a.y);
    const failures = [];
    let panes=0,corners=0,endCorners=0,maxDistance=0;
    for (const pane of deck.querySelectorAll('.prismdeck-viewport .prismdeck-pane')) {
      if (getComputedStyle(pane).visibility === 'hidden' || Number(pane.dataset.prismdeckExtraction) > 0) continue;
      const style = getComputedStyle(pane);
      panes++;
      for (const [horizontal,vertical] of [['left','top'],['right','top'],['left','bottom'],['right','bottom']]) {
        const marker = document.createElement('span');
        // Absolute coordinates start inside a CSS border; offset back to the real outer face.
        marker.style.cssText = 'position:absolute;width:0;height:0;padding:0;margin:0;border:0;pointer-events:none;';
        marker.style[horizontal] = `${-parseFloat(style[horizontal === 'left' ? 'borderLeftWidth' : 'borderRightWidth'])}px`;
        marker.style[vertical] = `${-parseFloat(style[vertical === 'top' ? 'borderTopWidth' : 'borderBottomWidth'])}px`;
        pane.append(marker);
        const rect = marker.getBoundingClientRect();
        const distances = lines.map((line) => distance({x:rect.x,y:rect.y},line));
        const closest = Math.min(...distances); maxDistance = Math.max(maxDistance,closest); corners++;
        if (['pane-0','pane-999'].includes(pane.dataset.prismdeckKey)) {
          const endDistance = Math.min(...ends.map((point) => Math.hypot(point.x-rect.x,point.y-rect.y)));
          if (endDistance >= 1) failures.push({key:pane.dataset.prismdeckKey,horizontal,vertical,endDistance});
          endCorners++;
        }
        if (closest >= 1) failures.push({key:pane.dataset.prismdeckKey,horizontal,vertical,distance:closest,point:{x:rect.x,y:rect.y}});
        marker.remove();
      }
    }
    return {lines:lines.length,panes,corners,endCorners,maxDistance,failures:failures.slice(0,4)};
  });

  await assertTheme('light');
  let checkedCorners = 0;
  let checkedEndCorners = 0;
  for (const viewport of [{width:1280,height:900},{width:390,height:844}]) {
    await page.setViewportSize(viewport);
    await frames();
    for (const zoom of [0,0.5,1]) for (const focus of [0,500,999]) {
      await page.evaluate(({zoom,focus}) => { window.deck.controller.focus(focus); window.deck.controller.setZoom(zoom); }, {zoom,focus});
      await frames();
      const result = await measureCorners();
      const label = `${viewport.width}px / zoom ${zoom} / focus ${focus}`;
      assert.equal(result.lines,4,`${label}: all four receding boundaries exist`);
      assert.ok(result.panes > 0 && result.corners >= 4, `${label}: actual pane corners were measured`);
      assert.deepEqual(result.failures,[],`${label}: every projected corner touches a prism boundary; max error ${result.maxDistance}px`);
      assert.ok(result.panes <= 40,`${label}: pane mounting remains bounded`);
      checkedCorners += result.corners;
      checkedEndCorners += result.endCorners;
    }
  }

  assert.ok(checkedEndCorners >= 16,'Visible first/last pane corners meet finite prism end faces as well as the receding edges');
  await page.setViewportSize({width:1280,height:900});
  await page.evaluate(() => { window.deck.controller.focus(500); window.deck.controller.setZoom(0.5); });
  await frames();
  await page.evaluate(() => {
    window.originalPane = document.querySelector('.prismdeck-pane.is-focused');
    window.deck.controller.select();
  });
  await page.waitForFunction(() => Number(window.deck.element.dataset.prismdeckSelectionProgress) === 1);
  const beforeTheme = await page.evaluate(() => ({...window.stats,selectedKey:window.deck.controller.getSnapshot().selectedKey}));
  for (const theme of ['dark','light','dark']) {
    await page.evaluate((theme) => window.deck.update({theme}), theme);
    await assertTheme(theme);
    assert.deepEqual(await page.evaluate(() => ({...window.stats,selectedKey:window.deck.controller.getSnapshot().selectedKey})),beforeTheme,'A theme change retains selection and every image resource');
    assert.equal(await page.evaluate(() => document.querySelector('.prismdeck-selection-viewport .prismdeck-pane') === window.originalPane),true,'A theme change retains the original selected pane node');
  }
  await page.evaluate(() => window.deck.controller.dismiss());
  await page.waitForFunction(() => Number(window.deck.element.dataset.prismdeckSelectionProgress) === 0);
  await frames();
  assert.deepEqual((await measureCorners()).failures,[],'A returned slide touches the prism boundaries again');

  // The default system preference updates live, while an explicit theme remains stable.
  await page.evaluate(() => window.deck.update({theme:'system'}));
  await page.emulateMedia({colorScheme:'dark'});
  await assertTheme('dark');
  await page.emulateMedia({colorScheme:'light'});
  await assertTheme('light');
  await page.evaluate(() => window.deck.update({theme:'dark'}));
  await assertTheme('dark');
  await page.emulateMedia({colorScheme:'light'});
  await assertTheme('dark');
  await page.evaluate(() => window.deck.update({theme:undefined}));
  await assertTheme('light');

  // The native top layer inherits the same theme as its owning widget.
  await page.evaluate(() => { window.deck.update({variant:'B'}); window.deck.controller.select(); });
  await page.waitForFunction(() => document.querySelector('.prismdeck-dialog')?.open);
  for (const theme of ['light','dark']) {
    await page.evaluate((theme) => window.deck.update({theme}), theme);
    await assertTheme(theme,{dialog:true});
    assert.equal(await page.locator('.prismdeck-dialog[open]').count(),1,'Theme updates preserve the native modal');
  }
  await page.evaluate(() => window.deck.dispose());
  assert.equal(await page.evaluate(() => window.stats.created === window.stats.disposed),true,'Disposal releases every image resource');

  // The shipped example uses the same neutral Day/Night controls and real 16:9 artwork.
  await page.goto(`${address}/?theme=light`);
  await page.waitForFunction(() => window.deck && document.querySelector('.prismdeck-pane img')?.naturalWidth > 0);
  await resolvedTheme('light');
  assert.equal(await page.locator('#theme-light').getAttribute('aria-pressed'),'true');
  const images = await page.locator('.prismdeck-pane img').evaluateAll((images) => images.map((image) => ({width:image.naturalWidth,height:image.naturalHeight,pane:image.closest('.prismdeck-pane').getBoundingClientRect().width})));
  assert.ok(images.length > 0 && images.every((image) => image.width / image.height === 16/9),'Example artwork has the same 16:9 aspect as the pane surface');
  await page.locator('#theme-dark').click();
  await resolvedTheme('dark');
  assert.equal(await page.locator('#theme-dark').getAttribute('aria-pressed'),'true');
  assert.equal(await page.evaluate(() => localStorage.getItem('prismdeck-theme')),'dark');
  assert.equal(new URL(page.url()).searchParams.get('theme'),'dark');
  await page.goto(address);
  await page.waitForFunction(() => window.deck?.element.dataset.prismdeckTheme === 'dark');
  await page.goto(`${address}/?theme=light`);
  await page.waitForFunction(() => window.deck?.element.dataset.prismdeckTheme === 'light');
  assert.equal(await page.locator('html').getAttribute('data-theme'),'light','A shareable theme URL overrides a saved preference');
  await mkdir(new URL('../test-results/', import.meta.url), {recursive:true});
  await page.screenshot({path:new URL('../test-results/corners-day-desktop.png', import.meta.url).pathname});
  await page.locator('#deck').screenshot({path:new URL('../test-results/corners-day-widget.png', import.meta.url).pathname});
  await page.locator('#theme-dark').click();
  await page.screenshot({path:new URL('../test-results/corners-night-desktop.png', import.meta.url).pathname});
  await page.locator('#deck').screenshot({path:new URL('../test-results/corners-night-widget.png', import.meta.url).pathname});
  await page.setViewportSize({width:375,height:812});
  await page.evaluate(() => window.scrollTo(0,0));
  await frames();
  for (const id of ['theme-light','theme-dark']) {
    const button=await page.locator('#'+id).boundingBox();
    assert.ok(button && button.x >= 0 && button.x+button.width <= 375 && button.y >= 0 && button.y+button.height <= 812,`${id} remains visible in the phone header`);
  }
  await page.screenshot({path:new URL('../test-results/corners-night-mobile.png', import.meta.url).pathname});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true,'Day/Night controls fit on a phone viewport');
  await page.evaluate(() => localStorage.removeItem('prismdeck-theme'));
  await page.goto(address);
  await page.waitForFunction(() => window.deck?.element.dataset.prismdeckTheme === 'light');
  await page.emulateMedia({colorScheme:'dark'});
  await resolvedTheme('dark');
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark','An unconfigured example follows system Night mode live');
  await page.emulateMedia({colorScheme:'light'});
  await resolvedTheme('light');
  assert.equal(await page.locator('html').getAttribute('data-theme'),'light','An unconfigured example follows system Day mode live');

  // Load the shipped React example through the same server to exercise the public theme prop.
  const reactFixture=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@fs${new URL('../examples/react/main.tsx',import.meta.url).pathname}"></script></body></html>`;
  await context.route('**/react-theme-fixture.html*',(route)=>route.fulfill({contentType:'text/html',body:reactFixture}));
  await page.goto(`${address}/react-theme-fixture.html?theme=light`);
  await page.waitForFunction(() => document.querySelector('.prismdeck')?.dataset.prismdeckTheme === 'light');
  await page.locator('.prismdeck').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => Number(document.querySelector('.prismdeck').dataset.prismdeckSelectionProgress) === 1);
  await page.evaluate(() => {window.reactSelectedPane=document.querySelector('.prismdeck-selection-viewport .prismdeck-pane');window.reactImages=[...document.querySelectorAll('.prismdeck-pane img')];});
  await page.locator('#theme-dark').click();
  await page.waitForFunction(() => document.querySelector('.prismdeck')?.dataset.prismdeckTheme === 'dark');
  assert.equal(await page.evaluate(() => document.querySelector('.prismdeck-selection-viewport .prismdeck-pane') === window.reactSelectedPane),true,'React theme prop updates preserve the selected pane');
  assert.equal(await page.evaluate(() => window.reactImages.every((image) => image.isConnected)),true,'React theme updates retain image content');
  await page.locator('#theme-light').click();
  await page.waitForFunction(() => document.querySelector('.prismdeck')?.dataset.prismdeckTheme === 'light');
  assert.equal(await page.locator('#theme-light').getAttribute('aria-pressed'),'true');
  assert.equal(requests.some((url) => /packages\/three|node_modules.*three|three\.js|\/xr[.\/]/.test(url)),false,'Theme and boundary features load no Three/XR code');
  assert.deepEqual(errors,[],'Corner and theme scenarios produce no browser errors');
  console.log(`Corner/theme browser checks passed: ${checkedCorners} actual CSS-projected corners touch four receding prism edges across close/middle/overview, first/middle/end focus, desktop/mobile; white Day and neutral Night, live system preference, unchanged selection/resources, themed modal, persistent/shareable Day/Night demos and React prop, 16:9 artwork, and zero Three/XR.`);
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
