import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url);
const port = 5213;
const servers = [];
async function serve(example, offset = 0) {
  const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', `examples/${example}`, '--host', '127.0.0.1', '--port', String(port + offset), '--strictPort'], { cwd: root, stdio: 'pipe' });
  servers.push(child);
  let output = '';
  child.stderr.on('data', (data) => { output += data; });
  const address = `http://127.0.0.1:${port + offset}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Wallet test server exited early: ${output}`);
    try { if ((await fetch(address)).ok) return address; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Wallet test server did not start: ${output}`);
}
const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  html,body{margin:0;background:#fff;color:#181818;font:16px system-ui}main{max-width:1100px;margin:20px auto}.mount{height:650px;width:100%}#outside{margin:12px}.preview,.detail{display:flex;align-items:center;justify-content:center;background:#f4f4f4;color:#181818;font:24px system-ui}.preview img{display:block;width:100%;height:100%;object-fit:contain}@media(max-width:480px){main{margin:8px}.mount{height:640px}}
  </style></head><body><button id="outside">Application action</button><main><div id="one" class="mount"></div></main><script type="module">
  import {createPrismDeck} from '/@fs${new URL('../packages/dom/dist/index.js', import.meta.url).pathname}';
  import '/@fs${new URL('../packages/dom/src/style.css', import.meta.url).pathname}';
  window.initialItems=Array.from({length:10000},(_,index)=>({id:'item-'+index,label:'Idea '+index}));
  window.stats={created:0,disposed:0,images:0,detailCreated:0,detailDisposed:0};window.selections=[];window.activations=[];
  window.renderPane=item=>{
    window.stats.created++;const element=document.createElement('div');element.className='preview';
    const image=new Image();window.stats.images++;image.alt=item.label;
    image.src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="#f4f4f4"/><text x="50" y="270" fill="#181818" font-size="64">'+item.label+'</text></svg>');
    element.append(image);return {element,dispose:()=>window.stats.disposed++};
  };
  window.renderDetail=item=>{window.stats.detailCreated++;const element=document.createElement('div');element.className='detail';element.textContent='Inspect '+item.label;return {element,dispose:()=>window.stats.detailDisposed++};};
  window.one=createPrismDeck(document.querySelector('#one'),{
    items:window.initialItems,getKey:item=>item.id,adapter:{getKey:item=>item.id,getLabel:item=>item.label},
    variant:'C',layout:'wallet',prismLines:false,timelineRails:false,planeGrid:false,paneDrag:'none',initialFocus:32,maxVisible:25,renderPane:window.renderPane,
    onSelect:(item,index)=>window.selections.push({key:item.id,index}),onActivate:item=>window.activations.push(item.id),
  });
  </script></body></html>`;

let browser;
try {
  const address = await serve('vanilla');
  browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || undefined, args: ['--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('**/wallet-fixture.html', (route) => route.fulfill({ contentType: 'text/html', body: fixture }));
  const page = await context.newPage();
  const errors = [];
  page.on('crash',()=>console.error('Wallet browser crashed'));
  const requests = [];
  const observe = (target) => {
    target.on('pageerror', (error) => {errors.push(error.message);console.error('Browser error:',error.message);});
    target.on('request', (request) => requests.push(request.url()));
  };
  observe(page);
  await page.goto(`${address}/wallet-fixture.html`);
  await page.waitForFunction(() => window.one && document.querySelector('#one .prismdeck-pane'));
  const snapshot = () => page.evaluate(() => window.one.controller.getSnapshot());
  const frame = () => page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  const settled = async (selected = true) => {
    try { await page.waitForFunction((selected) => {
      const state = window.one.controller.getSnapshot();
      const progress = Number(window.one.element.dataset.prismdeckSelectionProgress);
      return selected ? state.selectedKey !== null && progress === 1 : state.selectedKey === null && progress === 0;
    }, selected); } catch (error) {
      const state=await page.evaluate(()=>({state:window.one.controller.getSnapshot(),progress:window.one.element.dataset.prismdeckSelectionProgress,active:document.activeElement?.outerHTML.slice(0,300),hasSelection:window.one.element.className}));
      throw new Error(`Wallet did not settle ${selected ? 'open' : 'closed'}: ${JSON.stringify(state)}`,{cause:error});
    }
  };
  const budget = async (limit = 25) => {
    assert.ok(await page.locator('#one .prismdeck-pane').count() <= limit, 'Mounted wallet panes stay within their preview budget');
    const stats = await page.evaluate(() => window.stats);
    assert.ok(stats.created - stats.disposed <= limit, 'Live wallet content stays within its preview budget');
  };
  const neutral = (value, label) => {
    const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    assert.ok(channels?.length === 3 && Math.max(...channels) - Math.min(...channels) <= 2, `${label} uses neutral gray: ${value}`);
  };
  const bounds = async () => page.evaluate(() => {
    const root = window.one.element.getBoundingClientRect();
    const viewport = window.one.element.querySelector('.prismdeck-viewport').getBoundingClientRect();
    const panes = [...window.one.element.querySelectorAll('.prismdeck-pane')].map((pane) => {
      const r = pane.getBoundingClientRect();
      return {key:pane.dataset.prismdeckKey,x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};
    });
    return {root:{x:root.x,y:root.y,right:root.right,bottom:root.bottom},viewport:{x:viewport.x,y:viewport.y,right:viewport.right,bottom:viewport.bottom},panes,scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth};
  });

  assert.equal(await page.locator('#one .prismdeck').getAttribute('data-prismdeck-variant'), 'C');
  assert.equal(await page.locator('#one .prismdeck').getAttribute('data-prismdeck-layout'), 'wallet');
  assert.equal(await page.locator('#one .prismdeck').getAttribute('data-prismdeck-selection-mode'), 'slide-out');
  assert.equal(await page.locator('#one .prismdeck').getAttribute('data-prismdeck-prism-lines'), 'false');
  assert.equal(await page.locator('#one .prismdeck').getAttribute('data-prismdeck-timeline-rails'), 'false');
  const fan = await page.evaluate(() => [...document.querySelectorAll('#one .prismdeck-stage .prismdeck-pane')].map((pane) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(pane).transform);
    return {index:Number(pane.dataset.prismdeckKey.split('-')[1]),wallet:pane.dataset.prismdeckWallet,angle:Math.atan2(matrix.m12,matrix.m11),radius:parseFloat(getComputedStyle(pane).borderTopLeftRadius)};
  }));
  assert.ok(fan.length >= 3 && fan.length <= 9, 'The close wallet is a small physical fan');
  assert.deepEqual(fan.map((pane) => pane.index), fan.map((pane) => pane.index).sort((a,b) => a-b), 'Fan retains source order');
  assert.ok(fan.every((pane) => pane.wallet === 'true'), 'Each card is marked with the wallet layout');
  assert.ok(fan.some((pane) => Math.abs(pane.angle) > 0.02), 'The wallet fans cards at visible angles');
  assert.ok(fan.every((pane) => pane.radius > 0), 'Wallet cards have rounded corners');
  const pocket = page.locator('#one .prismdeck-wallet-pocket');
  assert.equal(await pocket.count(), 1, 'The fan has one wallet pocket');
  assert.equal(await pocket.evaluate((node) => getComputedStyle(node).pointerEvents), 'none', 'The wallet decoration cannot intercept pane input');
  assert.equal(await pocket.getAttribute('aria-hidden'), 'true', 'The decoration adds no assistive-technology noise');
  neutral(await page.locator('#one .prismdeck').evaluate((node) => getComputedStyle(node).backgroundColor), 'Default wallet surface');
  await budget(9);

  await page.evaluate(() => {
    window.original=document.querySelector('#one .prismdeck-pane.is-focused');
    window.beforeSelect={...window.stats};
  });
  await page.locator('#one .prismdeck-pane.is-focused .prismdeck-pane-select').click();
  await settled();
  assert.equal((await snapshot()).selectedKey, 'item-32', 'Clicking the focused wallet card selects its item');
  assert.equal(await page.locator('dialog[open]').count(), 0, 'C draws a card into view without a modal');
  assert.equal(await page.evaluate(() => document.querySelector('#one .prismdeck-selection-viewport .prismdeck-pane') === window.original), true, 'C raises the original card node into the reading view');
  assert.equal(await page.evaluate(() => window.stats.created === window.beforeSelect.created && window.stats.images === window.beforeSelect.images), true, 'Drawing a card reuses image/content resources');
  const selected = await page.locator('#one .prismdeck-selection-viewport .prismdeck-pane').boundingBox();
  assert.ok(selected && selected.width > 400 && selected.height > 200, 'The drawn card becomes a readable large surface');
  assert.ok(await page.locator('#one .prismdeck-stage .prismdeck-pane').count() >= 2, 'The miniature wallet retains surrounding context');
  assert.equal(await pocket.isVisible(), true, 'The wallet pocket remains visible while reading');
  await page.locator('#one .prismdeck-selection-back:visible').click();
  await settled(false);
  assert.equal(await page.evaluate(() => document.querySelector('#one .prismdeck-stage [data-prismdeck-key="item-32"]') === window.original), true, 'Returning puts the same card back in the wallet');
  assert.equal(await page.evaluate(() => window.stats.created === window.beforeSelect.created && window.stats.images === window.beforeSelect.images), true, 'Returning does not reload the card image');
  assert.equal(await page.evaluate(() => document.activeElement === window.one.element), true, 'Returning restores keyboard focus');

  // Sample actual exposed pixels rather than forcing a click through overlapping cards.
  const adjacentHit = await page.evaluate(() => {
    const viewport = window.one.element.querySelector('.prismdeck-viewport').getBoundingClientRect();
    const candidates = [...window.one.element.querySelectorAll('.prismdeck-stage .prismdeck-pane:not(.is-focused)')];
    candidates.sort((a,b) => Math.abs(Number(a.dataset.prismdeckKey.split('-')[1])-32)-Math.abs(Number(b.dataset.prismdeckKey.split('-')[1])-32));
    for (const pane of candidates) {
      const r = pane.getBoundingClientRect();
      for (let y=Math.max(r.y+3,viewport.y+3);y<Math.min(r.bottom-3,viewport.bottom-3);y+=5) {
        for (let x=Math.max(r.x+3,viewport.x+3);x<Math.min(r.right-3,viewport.right-3);x+=5) {
          const hit=document.elementFromPoint(x,y);
          if (hit?.closest('.prismdeck-pane')===pane && hit.classList.contains('prismdeck-pane-select')) return {x,y,key:pane.dataset.prismdeckKey};
        }
      }
    }
    return null;
  });
  assert.ok(adjacentHit, 'At least one adjacent wallet card exposes a real clickable portion');
  await page.mouse.click(adjacentHit.x, adjacentHit.y);
  await settled();
  assert.equal((await snapshot()).selectedKey, adjacentHit.key, 'An exposed adjacent card selects its own key');
  await page.keyboard.press('Escape');
  await settled(false);

  await page.locator('#one .prismdeck').focus();
  await page.keyboard.press('End');
  assert.equal((await snapshot()).focus, 9999, 'End navigates a large wallet to its last item');
  await page.keyboard.press('ArrowLeft');
  assert.equal((await snapshot()).focus, 9998);
  await page.keyboard.press('Home');
  assert.equal((await snapshot()).focus, 0);
  await page.keyboard.press('ArrowRight');
  assert.equal((await snapshot()).focus, 1);
  await page.keyboard.press('-');
  assert.ok((await snapshot()).zoom > 0, 'Keyboard density control works in wallet layout');
  await page.evaluate(() => window.one.controller.setZoom(1));
  await frame();
  assert.ok(await page.locator('#one .prismdeck-pane').count() > fan.length, 'Overview reveals more cards in the compact wallet');
  await budget(17);
  await page.evaluate(() => window.one.update({maxVisible:5}));
  await frame();
  await budget(5);
  await page.evaluate(() => {window.one.update({maxVisible:25});window.one.controller.setZoom(0);window.one.controller.focus(32);});
  await frame();

  const viewport = await page.locator('#one .prismdeck-viewport').boundingBox();
  assert.ok(viewport);
  await page.mouse.move(viewport.x+viewport.width/2,viewport.y+viewport.height/2);
  await page.mouse.wheel(0,350);
  await page.waitForFunction(() => window.one.controller.getSnapshot().zoom > 0);
  const beforePinch = (await snapshot()).zoom;
  const cdp = await context.newCDPSession(page);
  const x=viewport.x+viewport.width/2,y=viewport.y+viewport.height/2;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x-60,y},{x:x+60,y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-30,y},{x:x+30,y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.ok((await snapshot()).zoom > beforePinch, 'Native pinch increases wallet density');

  // Layout is modular, and opting into C must not change either existing preset.
  for (const [variant, mode] of [['A','slide-out'],['B','modal']]) {
    await page.evaluate((variant) => window.one.update({variant,layout:undefined}), variant);
    await frame();
    assert.equal(await page.locator('#one .prismdeck').getAttribute('data-prismdeck-layout'), 'prism', `${variant} keeps the prism layout`);
    assert.equal(await page.locator('#one .prismdeck').getAttribute('data-prismdeck-selection-mode'), mode);
    assert.equal(await page.locator('#one .prismdeck-stage .prismdeck-pane[data-prismdeck-wallet="true"]').count(), 0, 'Wallet card treatment does not leak into the prism');
  }
  await page.evaluate(() => window.one.update({variant:'A',layout:'wallet'}));
  await frame();
  assert.equal(await page.locator('#one .prismdeck').getAttribute('data-prismdeck-layout'), 'wallet', 'An explicit wallet layout overrides A');
  await page.evaluate(() => window.one.update({variant:'C',layout:'prism'}));
  await frame();
  assert.equal(await page.locator('#one .prismdeck').getAttribute('data-prismdeck-layout'), 'prism', 'An explicit prism layout overrides C');
  await page.evaluate(() => {window.one.update({layout:'wallet',selectionMode:'modal',renderSelection:window.renderDetail});window.one.controller.select(32);});
  await page.waitForFunction(() => document.querySelector('#one .prismdeck-dialog')?.open);
  assert.equal(await page.locator('#one .prismdeck-pane-detail').textContent(), 'Inspect Idea 32', 'Wallet layout accepts an independent modal detail renderer');
  assert.equal(await page.evaluate(() => window.stats.detailCreated), 1);
  await page.keyboard.press('Escape');
  await settled(false);
  assert.equal(await page.evaluate(() => window.stats.detailCreated === window.stats.detailDisposed), true, 'Closing the wallet modal releases detail resources');
  await page.evaluate(() => {window.one.update({selectionMode:'none',renderSelection:undefined});window.one.controller.select(32);});
  await frame();
  assert.equal((await snapshot()).selectedKey, 'item-32');
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.equal(await page.locator('#one .prismdeck-presentation:visible').count(), 0, 'Wallet event-only selection does not present content');
  await page.evaluate(() => {window.one.controller.dismiss();window.one.update({selectionMode:undefined});window.one.controller.select(32);});
  await settled();
  await page.evaluate(() => {
    window.replacementItems=window.one.controller.getItems().map(item=>({...item,label:'Refreshed '+item.label}));
    window.one.controller.setItems(window.replacementItems);
  });
  await page.waitForFunction(() => document.querySelector('#one .prismdeck-selection-viewport img')?.alt === 'Refreshed Idea 32');
  await settled();
  await page.evaluate(() => {window.refreshed=document.querySelector('#one .prismdeck-selection-viewport .prismdeck-pane');window.beforeTheme={...window.stats};window.one.update({theme:'dark'});});
  await frame();
  assert.equal(await page.evaluate(() => document.querySelector('#one .prismdeck-selection-viewport .prismdeck-pane') === window.refreshed), true, 'Changing theme preserves the selected content node');
  assert.equal(await page.evaluate(() => window.stats.created === window.beforeTheme.created && window.stats.images === window.beforeTheme.images), true, 'Changing theme reloads no images');
  assert.equal((await snapshot()).selectedKey, 'item-32', 'Refreshing a selected item preserves its stable key');
  neutral(await page.locator('#one .prismdeck').evaluate((node) => getComputedStyle(node).backgroundColor), 'Night wallet surface');
  await page.evaluate(() => window.one.update({theme:'light'}));
  await frame();
  neutral(await page.locator('#one .prismdeck').evaluate((node) => getComputedStyle(node).backgroundColor), 'Day wallet surface');
  await page.evaluate(() => window.one.controller.dismiss());
  await settled(false);

  // A host can shrink data or the preview budget while a card is out of the wallet.
  await page.evaluate(() => {
    window.savedItems=window.one.controller.getItems();
    window.one.controller.select(0);
  });
  await settled();
  await page.evaluate(() => {
    window.shrinkOriginal=document.querySelector('#one .prismdeck-selection-viewport .prismdeck-pane');
    window.one.update({maxVisible:1});
  });
  await frame();
  await budget(1);
  assert.equal(await page.evaluate(()=>document.querySelector('#one .prismdeck-selection-viewport .prismdeck-pane')===window.shrinkOriginal),true,'Lowering maxVisible during selection retains the drawn card');
  await page.evaluate(() => {
    window.beforeShrink={...window.stats};
    window.one.controller.setItems([window.savedItems[0]]);
  });
  await settled();
  await frame();
  assert.equal((await snapshot()).count,1,'A selected wallet accepts a collection shrinking to one stable item');
  assert.equal((await snapshot()).selectedKey,'item-0');
  assert.equal(await page.evaluate(()=>document.querySelector('#one .prismdeck-selection-viewport .prismdeck-pane')===window.shrinkOriginal),true,'Shrinking to the same item reference retains the drawn card');
  assert.equal(await page.evaluate(()=>window.stats.created===window.beforeShrink.created&&window.stats.images===window.beforeShrink.images),true,'Shrinking to the retained item creates no undefined or replacement content');
  await budget(1);
  await page.evaluate(() => {
    window.one.controller.dismiss();
    window.one.controller.setItems(window.savedItems);
    window.one.update({maxVisible:25});
  });
  await settled(false);

  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({reducedMotion:'reduce'});
  await frame();
  for (const focus of [0,5000,9999]) {
    for (const zoom of [0,1]) {
      await page.evaluate(({focus,zoom}) => {window.one.controller.focus(focus);window.one.controller.setZoom(zoom);}, {focus,zoom});
      await frame();
      const measure=await bounds();
      assert.ok(measure.panes.every(pane=>pane.width>10 && pane.height>10), 'Mobile wallet cards retain visible dimensions');
      assert.ok(measure.panes.every(pane=>pane.x>=measure.viewport.x-2 && pane.right<=measure.viewport.right+2 && pane.y>=measure.viewport.y-2 && pane.bottom<=measure.viewport.bottom+2), `Mobile fan fits its viewport at focus ${focus}, zoom ${zoom}: ${JSON.stringify(measure)}`);
      assert.equal(measure.scrollWidth, measure.clientWidth, 'The wallet adds no horizontal page overflow');
      await budget(zoom ? 17 : 9);
      await page.evaluate(() => window.one.controller.select());
      await settled();
      const reading=await bounds();
      assert.ok(reading.panes.every(pane=>pane.x>=reading.root.x-2 && pane.right<=reading.root.right+2 && pane.y>=reading.root.y-2 && pane.bottom<=reading.root.bottom+2), `Mobile drawn card and wallet remain inside the deck at ${focus}/${zoom}`);
      await page.evaluate(() => window.one.controller.dismiss());
      await settled(false);
    }
  }
  const reducedProgress=await page.evaluate(async()=>{window.one.controller.select();await new Promise(requestAnimationFrame);return Number(window.one.element.dataset.prismdeckSelectionProgress);});
  assert.equal(reducedProgress,1,'Reduced motion draws a wallet card without an animation');
  await mkdir(new URL('../test-results/', import.meta.url), {recursive:true});
  await page.screenshot({path:new URL('../test-results/variant-c-mobile.png', import.meta.url).pathname});
  await page.locator('#outside').focus();
  const outsideBefore=await snapshot();
  await page.keyboard.press('ArrowRight');
  assert.equal((await snapshot()).focus,outsideBefore.focus,'An inactive wallet leaves application keys alone');
  await page.evaluate(() => {window.one.dispose();window.one.dispose();});
  assert.equal(await page.locator('.prismdeck').count(),0,'Disposal removes the wallet and open reading view');
  const disposed=await page.evaluate(()=>window.stats);
  assert.equal(disposed.created,disposed.disposed,'Every wallet content resource is disposed exactly once');
  assert.equal(disposed.detailCreated,disposed.detailDisposed,'Every optional detail resource is disposed exactly once');

  // The wallet remains available only as an explicit legacy layout. Version C
  // is covered by plane-browser.mjs, including both shipped examples.
  assert.equal(requests.some(url=>/packages\/three|node_modules.*three|three\.js|\/xr[.\/]/.test(url)),false,'The explicit wallet layout loads no Three or XR');
  assert.deepEqual(errors,[],'The explicit wallet layout produces no browser errors');
  console.log('Wallet browser checks passed: bounded ordered fan, real focused/adjacent hits, same-node draw and return, no image reloads, keyboard/wheel/native pinch, independent presets/layout/modal/none, selected updates, neutral themes, mobile endpoints and density, reduced motion, resource cleanup, explicit legacy layout, zero Three/XR.');
} finally {
  await browser?.close();
  for (const server of servers) server.kill('SIGTERM');
}
