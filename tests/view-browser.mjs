import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url);
const address = 'http://127.0.0.1:5217';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'examples/vanilla', '--host', '127.0.0.1', '--port', '5217', '--strictPort'], { cwd: root, stdio: 'pipe' });
let serverOutput = '';
server.stderr.on('data', data => { serverOutput += data; });
const domPath = new URL('../packages/dom/dist/index.js', import.meta.url).pathname;
const stylePath = new URL('../packages/dom/src/style.css', import.meta.url).pathname;
const reactFixturePath = new URL('../test-results/view-react-fixture.tsx', import.meta.url);
const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  html,body{margin:0;background:#eee;font:16px system-ui}main{max-width:1100px;margin:20px auto}.mount{height:620px;width:100%}#two{display:none}.pair main{display:flex;gap:16px}.pair .mount{display:block;width:calc(50% - 8px);height:540px}#outside{margin:8px}.preview{display:grid;place-items:center;background:#eee;color:#111;font:28px system-ui}@media(max-width:480px){main{margin:8px}.mount{height:680px}}
  </style></head><body><button id="outside">Application action</button><main><div id="one" class="mount"></div><div id="two" class="mount"></div></main><script type="module">
  import {createPrismDeck} from '/@fs${domPath}';
  import '/@fs${stylePath}';
  const items=Array.from({length:10000},(_,id)=>({id:'pane-'+id,label:'Pane '+id}));
  window.stats={};window.viewEvents=[];
  window.makeDeck=(name,overrides={})=>{
    const stats=window.stats[name]={created:0,disposed:0};
    window[name]=createPrismDeck(document.querySelector('#'+name),{
      items,getKey:item=>item.id,initialFocus:5000,initialZoom:.35,maxVisible:24,transitionDuration:0,
      renderPane:item=>{stats.created++;const element=document.createElement('div');element.className='preview';element.textContent=item.label;return {element,dispose:()=>stats.disposed++};},
      onViewChange:view=>window.viewEvents.push({name,...view}),...overrides,
    });return window[name];
  };
  window.makeDeck('one');
  </script></body></html>`;

let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`View test server exited early: ${serverOutput}`);
    try { ready = (await fetch(address)).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, `View test server starts: ${serverOutput}`);
  browser = await chromium.launch({ headless:true, channel:process.env.BROWSER_CHANNEL || undefined });
  const context = await browser.newContext({ viewport:{width:1280,height:960}, reducedMotion:'reduce' });
  await context.route('**/view-fixture.html', route => route.fulfill({contentType:'text/html',body:fixture}));
  const errors = [], requests = [];
  const observe = page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(request.url()));
  };
  const page = await context.newPage(); observe(page);
  await page.goto(`${address}/view-fixture.html`);
  await page.waitForFunction(() => window.one && document.querySelector('#one .prismdeck-pane'));
  const frames = () => page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  const state = (name='one') => page.evaluate(name => window[name].controller.getSnapshot(), name);
  const setView = (yaw,pitch,name='one') => page.evaluate(({name,yaw,pitch}) => window[name].controller.setView({yaw,pitch}), {name,yaw,pitch});
  const resources = (name='one') => page.evaluate(name => ({...window.stats[name]}),name);
  const openPanel = async (name='one') => {
    const toggle=page.locator(`#${name} .prismdeck-view-toggle`);
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    await page.locator(`#${name} .prismdeck-view-panel`).waitFor({state:'visible'});
  };
  const slider = (label,value,name='one') => page.locator(`#${name} input[aria-label="${label}"]`).evaluate((node,value) => {node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));},value);
  const invariant = snapshot => ({focus:snapshot.focus,zoom:snapshot.zoom,selectedKey:snapshot.selectedKey});
  const poses = () => page.evaluate(() => ({
    panes:[...window.one.element.querySelectorAll('.prismdeck-viewport .prismdeck-pane')].map(node=>{
      const rect=node.getBoundingClientRect();return [node.dataset.prismdeckKey,getComputedStyle(node).transform,[rect.x,rect.y,rect.width,rect.height]];
    }),
    pocket:(()=>{const node=window.one.element.querySelector('.prismdeck-wallet-pocket'),rect=node.getBoundingClientRect();return [getComputedStyle(node).transform,[rect.x,rect.y,rect.width,rect.height]];})(),
  }));
  const drag = async ({button='left',shift=false,dx=90,dy=40}={}) => {
    const box=await page.locator('#one .prismdeck-viewport').boundingBox();
    const x=box.x+box.width*.5,y=box.y+box.height*.4;
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.move(x,y); await page.mouse.down({button});
    await page.mouse.move(x+dx,y+dy,{steps:6}); await page.mouse.up({button});
    if (shift) await page.keyboard.up('Shift');
    await frames();
  };
  const settled = (selected=true) => page.waitForFunction(selected => {
    const deck=window.one,state=deck.controller.getSnapshot();
    return selected ? state.selectedKey!==null && Number(deck.element.dataset.prismdeckSelectionProgress)===1 : state.selectedKey===null && Number(deck.element.dataset.prismdeckSelectionProgress)===0;
  },selected);

  for (const variant of ['A','B','C']) {
    await page.evaluate(variant => {
      window.one.controller.dismiss();window.one.update({variant,view:{yaw:0,pitch:0}});
      window.one.controller.focus(5000);window.one.controller.setZoom(.35);
    },variant);
    await frames();
    await openPanel();
    assert.equal(await page.locator('#one .prismdeck-view-toggle').getAttribute('aria-controls')!==null,true,`${variant}: view disclosure names its panel`);
    const before=await state(),beforeResources=await resources(),baseline=await poses();
    await slider('Horizontal view angle',28); await slider('Vertical view angle',-17); await frames();
    assert.deepEqual((await state()).view,{yaw:28,pitch:-17},`${variant}: labeled sliders set horizontal and vertical angles`);
    assert.deepEqual(invariant(await state()),invariant(before),`${variant}: camera adjustment retains focus, zoom, and selection`);
    assert.deepEqual(await resources(),beforeResources,`${variant}: rotating creates and disposes no pane content`);
    assert.notDeepEqual((await poses()).panes,baseline.panes,`${variant}: camera changes actually rotate projected panes`);
    if (variant==='C') assert.notDeepEqual((await poses()).pocket,baseline.pocket,'Wallet pocket rotates with its cards');
    assert.deepEqual(await page.evaluate(()=>JSON.parse(window.one.element.dataset.prismdeckView)),{yaw:28,pitch:-17},`${variant}: rendered view diagnostic matches public state`);

    await page.locator('#one button[aria-label="Reset view"]').click(); await frames();
    assert.deepEqual((await state()).view,{yaw:0,pitch:0},`${variant}: Reset view restores the original angle`);
    assert.deepEqual(await poses(),baseline,`${variant}: reset restores exact default pane and pocket projection`);
    await drag({shift:true});
    assert.notDeepEqual((await state()).view,{yaw:0,pitch:0},`${variant}: Shift-drag rotates the camera`);
    assert.deepEqual(invariant(await state()),invariant(before),`${variant}: Shift-drag never browses or selects a pane`);
    await setView(0,0); await frames();
    await drag({button:'right'});
    assert.notDeepEqual((await state()).view,{yaw:0,pitch:0},`${variant}: right-drag rotates the camera`);
    assert.deepEqual(invariant(await state()),invariant(before),`${variant}: right-drag retains browsing state`);
    const contextMenu=await page.evaluate(()=>{
      const outside=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});document.querySelector('#outside').dispatchEvent(outside);
      const inside=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});window.one.element.querySelector('.prismdeck-viewport').dispatchEvent(inside);
      return {outside:outside.defaultPrevented,inside:inside.defaultPrevented};
    });
    assert.deepEqual(contextMenu,{outside:false,inside:true},`${variant}: orbit suppresses the widget context menu only`);

    await page.locator('#one .prismdeck').focus();
    await page.keyboard.press('0'); await page.keyboard.press('Alt+ArrowRight'); await page.keyboard.press('Alt+ArrowUp'); await frames();
    assert.ok((await state()).view.yaw!==0 && (await state()).view.pitch!==0,`${variant}: Alt-arrow keys adjust both axes`);
    assert.deepEqual(invariant(await state()),invariant(before),`${variant}: angle keys do not navigate content`);
    const editBefore=(await state()).view;
    await page.locator('#one input[aria-label="Horizontal view angle"]').focus(); await page.keyboard.press('0');
    assert.deepEqual((await state()).view,editBefore,`${variant}: reset shortcut leaves an editing control alone`);
    await page.locator('#one .prismdeck').focus(); await page.keyboard.press('0');
    assert.deepEqual((await state()).view,{yaw:0,pitch:0},`${variant}: 0 resets from the deck`);
    await drag({dx:90,dy:0});
    assert.notEqual((await state()).focus,before.focus,`${variant}: ordinary drag still browses panes`);
    assert.deepEqual((await state()).view,{yaw:0,pitch:0},`${variant}: browsing drag leaves camera angle alone`);

    await page.evaluate(()=>{window.one.controller.focus(5000);window.one.controller.setView({yaw:27,pitch:19});});
    await frames();
    await page.evaluate(()=>{
      window.selectedOriginal=window.one.element.querySelector('.prismdeck-pane.is-focused');
    });
    await page.waitForTimeout(275); // Let the ordinary drag's accidental-click guard expire.
    const hit=await page.locator('#one .prismdeck-pane.is-focused .prismdeck-pane-select').evaluate(node=>{
      const rect=node.getBoundingClientRect(),viewport=node.closest('.prismdeck-viewport').getBoundingClientRect();
      const left=Math.max(rect.left,viewport.left),top=Math.max(rect.top,viewport.top),right=Math.min(rect.right,viewport.right),bottom=Math.min(rect.bottom,viewport.bottom);
      for(let y=0;y<31;y++)for(let x=0;x<31;x++){
        const point={x:left+(right-left)*(x+.5)/31,y:top+(bottom-top)*(y+.5)/31};
        if(document.elementFromPoint(point.x,point.y)===node)return point;
      }
      return null;
    });
    // Dense prism views can legitimately occlude a focused plane. Its keyboard
    // selection remains available; an exposed card uses its actual hit surface.
    if(hit) await page.mouse.click(hit.x,hit.y);
    else {await page.locator('#one .prismdeck').focus();await page.keyboard.press('Enter');}
    await settled();
    const selectedBefore=await resources(),selectedState=await state();
    await setView(-38,-21); await frames();
    assert.deepEqual(invariant(await state()),invariant(selectedState),`${variant}: camera updates retain the selected stable key`);
    assert.deepEqual(await resources(),selectedBefore,`${variant}: camera updates never reload selected imagery`);
    const reading=await page.evaluate(()=>{
      const pane=window.selectedOriginal,matrix=new DOMMatrixReadOnly(getComputedStyle(pane).transform);
      return {connected:pane.isConnected,skew:[matrix.m12,matrix.m13,matrix.m21,matrix.m23],parent:pane.parentElement.className};
    });
    assert.equal(reading.connected,true,`${variant}: selected pane remains the original node`);
    assert.ok(reading.skew.every(value=>Math.abs(value)<.0001),`${variant}: reading surface faces the user after camera changes: ${JSON.stringify(reading)}`);
    await page.evaluate(()=>window.one.controller.dismiss()); await settled(false); await frames();
    assert.deepEqual((await state()).view,{yaw:-38,pitch:-21},`${variant}: returning preserves the viewing angle`);
    assert.equal(await page.evaluate(()=>window.selectedOriginal.parentElement===window.one.element.querySelector('.prismdeck-viewport .prismdeck-stage')),true,`${variant}: returning puts the same pane back in the collection`);
    assert.ok((await resources()).created-(await resources()).disposed<=24,`${variant}: camera and selection keep the content budget bounded`);
  }

  // Measure real CSS corner positions rather than axis-aligned bounding rectangles.
  const corners = () => page.evaluate(()=>{
    const deck=window.one.element;
    const viewport=deck.querySelector('.prismdeck-viewport').getBoundingClientRect();
    const lines=[...deck.querySelectorAll('[data-prismdeck-guide="prism"] [data-prismdeck-edge="axis"]')].map(line=>{
      const matrix=line.getScreenCTM();
      return ['1','2'].map(suffix=>new DOMPoint(Number(line.getAttribute('x'+suffix)),Number(line.getAttribute('y'+suffix))).matrixTransform(matrix));
    });
    let checked=0,maxError=0;const failures=[];
    for (const pane of deck.querySelectorAll('.prismdeck-viewport .prismdeck-pane')) {
      if (getComputedStyle(pane).visibility==='hidden') continue;
      const style=getComputedStyle(pane);
      for (const [horizontal,vertical] of [['left','top'],['right','top'],['left','bottom'],['right','bottom']]) {
        const marker=document.createElement('span');marker.style.cssText='position:absolute;width:0;height:0;border:0;padding:0;margin:0;pointer-events:none';
        marker.style[horizontal]=`${-parseFloat(style[horizontal==='left'?'borderLeftWidth':'borderRightWidth'])}px`;
        marker.style[vertical]=`${-parseFloat(style[vertical==='top'?'borderTopWidth':'borderBottomWidth'])}px`;
        pane.append(marker);const point=marker.getBoundingClientRect();marker.remove();
        // CSS perspective produces enormous extrapolated coordinates for panes
        // crossing the near plane; those clipped corners are never displayed.
        if(point.x<viewport.left-1||point.x>viewport.right+1||point.y<viewport.top-1||point.y>viewport.bottom+1)continue;
        const nearest=Math.min(...lines.map(([a,b])=>Math.abs((b.x-a.x)*(a.y-point.y)-(a.x-point.x)*(b.y-a.y))/Math.hypot(b.x-a.x,b.y-a.y)));
        maxError=Math.max(maxError,nearest);checked++;
        if (!Number.isFinite(nearest)||nearest>=1) failures.push({key:pane.dataset.prismdeckKey,horizontal,vertical,nearest,point:{x:point.x,y:point.y}});
      }
    }
    return {lines:lines.length,checked,maxError,failures:failures.slice(0,3)};
  });
  await page.evaluate(()=>window.one.update({variant:'A'}));
  let checkedCorners=0;
  for (const viewport of [{width:1280,height:960},{width:390,height:844}]) {
    await page.setViewportSize(viewport);await frames();
    for (const [yaw,pitch] of [[28,-17],[-55,38],[60,-45],[-60,45]]) for (const zoom of [0,.5,1]) for (const focus of [0,5000,9999]) {
      await page.evaluate(({yaw,pitch,zoom,focus})=>{window.one.controller.setView({yaw,pitch});window.one.controller.setZoom(zoom);window.one.controller.focus(focus);},{yaw,pitch,zoom,focus});
      await frames();const result=await corners();checkedCorners+=result.checked;
      const label=`${viewport.width}px view ${yaw}/${pitch} zoom ${zoom} focus ${focus}`;
      assert.equal(result.lines,4,`${label}: the four prism boundaries remain visible`);
      assert.ok(result.checked>=4,`${label}: visible actual corners are measured`);
      assert.deepEqual(result.failures,[],`${label}: rotated pane corners meet vanishing boundaries; max error ${result.maxError}px`);
    }
  }

  // Rotate mode is a discoverable one-finger orbit gesture on touch devices.
  const mobile=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:'reduce'});
  await mobile.route('**/view-fixture.html',route=>route.fulfill({contentType:'text/html',body:fixture}));
  const touch=await mobile.newPage();observe(touch);await touch.goto(`${address}/view-fixture.html`);
  await touch.waitForFunction(()=>window.one&&document.querySelector('#one .prismdeck-pane'));
  const cdp=await mobile.newCDPSession(touch);
  for (const variant of ['A','B','C']) {
    await touch.evaluate(variant=>{window.one.update({variant,view:{yaw:0,pitch:0}});window.one.controller.focus(5000);window.one.controller.setZoom(.35);},variant);
    const toggle=touch.locator('#one .prismdeck-view-toggle');if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.tap();
    await touch.locator('#one .prismdeck-orbit-toggle').tap();
    assert.equal(await touch.locator('#one .prismdeck-orbit-toggle').getAttribute('aria-pressed'),'true',`${variant}: touch Rotate mode announces its state`);
    const box=await touch.locator('#one .prismdeck-viewport').boundingBox(),x=box.x+box.width*.5,y=box.y+box.height*.4;
    const before=await touch.evaluate(()=>({state:window.one.controller.getSnapshot(),stats:{...window.stats.one}}));
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+55,y:y+35}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await touch.waitForFunction(()=>window.one.controller.getSnapshot().view.yaw!==0);
    const after=await touch.evaluate(()=>({state:window.one.controller.getSnapshot(),stats:{...window.stats.one}}));
    assert.deepEqual(invariant(after.state),invariant(before.state),`${variant}: native touch orbit retains content state`);
    assert.deepEqual(after.stats,before.stats,`${variant}: native touch orbit creates no image resources`);
    assert.ok(after.state.view.pitch!==0,`${variant}: native touch orbit tilts vertically`);
    await touch.locator('#one .prismdeck-orbit-toggle').tap();
    assert.equal(await touch.locator('#one .prismdeck-orbit-toggle').getAttribute('aria-pressed'),'false');
    for(const label of ['Horizontal view angle','Vertical view angle']) {
      const bounds=await touch.getByLabel(label,{exact:true}).boundingBox();
      assert.ok(bounds&&bounds.width>=80&&bounds.x>=0&&bounds.x+bounds.width<=390,`${variant}: ${label} fits the phone viewport`);
    }
    await touch.getByLabel('Reset view',{exact:true}).tap();
    assert.deepEqual(await touch.evaluate(()=>window.one.controller.getSnapshot().view),{yaw:0,pitch:0},`${variant}: phone reset returns the default camera`);
    assert.equal(await touch.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${variant}: expanded angle controls add no horizontal overflow`);
  }
  for (const yaw of [-60,0,60]) for (const pitch of [-45,0,45]) for (const zoom of [0,1]) for (const focus of [0,5000,9999]) {
    await touch.evaluate(async({yaw,pitch,zoom,focus})=>{
      window.one.controller.setView({yaw,pitch});window.one.controller.setZoom(zoom);window.one.controller.focus(focus);
      await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
    },{yaw,pitch,zoom,focus});
    const bounds=await touch.evaluate(()=>{
      const viewport=window.one.element.querySelector('.prismdeck-viewport').getBoundingClientRect();
      const surfaces=[...window.one.element.querySelectorAll('.prismdeck-viewport .prismdeck-pane,.prismdeck-wallet-pocket')].map(node=>{
        const rect=node.getBoundingClientRect();return {key:node.dataset.prismdeckKey??'pocket',left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height};
      });
      return {viewport:{left:viewport.left,top:viewport.top,right:viewport.right,bottom:viewport.bottom},surfaces};
    });
    assert.ok(bounds.surfaces.every(rect=>Number.isFinite(rect.width)&&rect.width>1&&rect.height>1&&rect.left>=bounds.viewport.left-2&&rect.top>=bounds.viewport.top-2&&rect.right<=bounds.viewport.right+2&&rect.bottom<=bounds.viewport.bottom+2),`Mobile wallet camera refits cards and pocket at ${yaw}/${pitch}, zoom ${zoom}, focus ${focus}: ${JSON.stringify(bounds)}`);
  }
  await touch.evaluate(()=>window.one.controller.resetView());
  await mkdir(new URL('../test-results/',import.meta.url),{recursive:true});
  await touch.screenshot({path:new URL('../test-results/view-mobile.png',import.meta.url).pathname});
  await mobile.close();

  await page.setViewportSize({width:1280,height:960});
  await page.evaluate(()=>{document.body.classList.add('pair');window.one.update({variant:'A',cameraControls:true,view:{yaw:0,pitch:0}});window.makeDeck('two',{variant:'C',initialView:{yaw:14,pitch:-9}});});
  await frames();
  assert.deepEqual((await state('two')).view,{yaw:14,pitch:-9},'initialView configures an independent starting camera');
  await page.locator('#one .prismdeck').focus();await page.keyboard.press('Alt+ArrowRight');
  assert.deepEqual((await state('two')).view,{yaw:14,pitch:-9},'Camera keys never affect a second widget');
  const outsideBefore=(await state()).view;await page.locator('#outside').focus();await page.keyboard.press('Alt+ArrowLeft');await page.keyboard.press('0');
  assert.deepEqual((await state()).view,outsideBefore,'Inactive decks leave application keys alone');
  await page.evaluate(()=>window.one.update({cameraControls:false}));await frames();
  assert.equal(await page.locator('#one .prismdeck-view-toggle:visible').count(),0,'cameraControls:false hides the camera disclosure');
  assert.equal(await page.locator('#one .prismdeck-orbit-toggle:visible').count(),0,'cameraControls:false hides Rotate mode');
  const disabledBefore=await state();await page.locator('#one .prismdeck').focus();await page.keyboard.press('Alt+ArrowRight');await page.keyboard.press('0');await drag({shift:true});
  assert.deepEqual((await state()).view,disabledBefore.view,'cameraControls:false disables camera gestures and keyboard shortcuts');
  await page.evaluate(()=>window.one.update({view:{yaw:31,pitch:12}}));await frames();
  assert.deepEqual((await state()).view,{yaw:31,pitch:12},'A host can still set view while built-in camera controls are disabled');
  await page.evaluate(()=>{window.callbackEvents=[];window.one.update({onViewChange:view=>window.callbackEvents.push(view)});window.one.controller.setView({yaw:18,pitch:-7});});
  assert.deepEqual(await page.evaluate(()=>window.callbackEvents),[{yaw:18,pitch:-7}],'update uses the latest onViewChange callback');
  await page.evaluate(()=>{window.one.update({onViewChange:undefined});window.one.controller.setView({yaw:19,pitch:-7});});
  assert.equal(await page.evaluate(()=>window.callbackEvents.length),1,'Removing the callback detaches its old handler');
  await page.evaluate(()=>{
    window.disposedDeck=window.one;window.one.dispose();window.one.dispose();
    window.dispatchEvent(new PointerEvent('pointermove',{pointerId:42,clientX:200,clientY:200}));
    window.dispatchEvent(new PointerEvent('pointerup',{pointerId:42}));
  });
  await frames();
  assert.equal(await page.locator('#one .prismdeck').count(),0,'Disposal removes camera UI and deck surfaces');
  assert.equal((await resources()).created,(await resources()).disposed,'Disposal releases each camera-tested pane exactly once');
  assert.equal(await page.locator('#two .prismdeck').count(),1,'Disposing one camera leaves its neighbor mounted');

  // Compile an isolated React fixture through Vite, using only public props.
  await writeFile(reactFixturePath,`import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {PrismDeck} from '@prismdeck/react';
    import '@prismdeck/dom/style.css';
    const items=Array.from({length:100},(_,id)=>({id}));const getKey=item=>item.id;
    window.reactEvents=[];
    function App(){const [props,setProps]=useState({initialView:{yaw:11,pitch:-8},onViewChange:view=>window.reactEvents.push({generation:1,...view})});window.setReactProps=next=>setProps(previous=>({...previous,...next}));return <PrismDeck items={items} getKey={getKey} renderPane={item=><span>Pane {item.id}</span>} {...props} onReady={deck=>window.reactDeck=deck} style={{height:560}}/>;}
    window.reactRoot=createRoot(document.querySelector('#root'));window.reactRoot.render(<App/>);`);
  await context.route('**/view-react-fixture.html',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@fs${reactFixturePath.pathname}"></script></body></html>`}));
  const react=await context.newPage();observe(react);await react.goto(`${address}/view-react-fixture.html`);
  await react.waitForFunction(()=>window.reactDeck&&document.querySelector('.prismdeck-pane span'));
  assert.deepEqual(await react.evaluate(()=>window.reactDeck.controller.getSnapshot().view),{yaw:11,pitch:-8},'React initialView reaches the controller');
  await react.evaluate(()=>{window.reactController=window.reactDeck.controller;window.reactPane=document.querySelector('.prismdeck-pane.is-focused');window.setReactProps({view:{yaw:24,pitch:15},onViewChange:view=>window.reactEvents.push({generation:2,...view})});});
  await react.waitForFunction(()=>window.reactDeck.controller.getSnapshot().view.yaw===24);
  assert.equal(await react.evaluate(()=>window.reactController===window.reactDeck.controller&&window.reactPane===document.querySelector('.prismdeck-pane.is-focused')),true,'React view updates retain the controller and content node');
  await react.locator('.prismdeck').focus();await react.keyboard.press('Alt+ArrowRight');
  assert.equal(await react.evaluate(()=>window.reactEvents.at(-1).generation),2,'React onViewChange reads the latest callback prop');
  await react.evaluate(()=>window.setReactProps({cameraControls:false}));
  await react.locator('.prismdeck-view-toggle').waitFor({state:'hidden'});
  await react.evaluate(()=>window.setReactProps({cameraControls:true,view:{yaw:-12,pitch:7}}));
  await react.waitForFunction(()=>window.reactDeck.controller.getSnapshot().view.yaw===-12);
  await react.locator('.prismdeck-view-toggle').waitFor({state:'visible'});
  assert.equal(await react.locator('.prismdeck-view-toggle').isVisible(),true,'React cameraControls can be restored without remounting');
  await react.evaluate(()=>window.reactRoot.unmount());
  assert.equal(await react.locator('.prismdeck').count(),0,'React unmount disposes camera listeners and UI');

  assert.equal(requests.some(url=>/packages\/three|node_modules.*three|three\.js|\/xr[.\/]/.test(url)),false,'All camera interactions remain free of Three and XR modules');
  assert.deepEqual(errors,[],'All view angle scenarios finish without browser errors');
  console.log(`View browser checks passed: A/B/C labeled sliders, exact reset, Shift/right/touch rotation, regular drag, keyboard isolation, selected reading planes, unchanged resources, ${checkedCorners} real corners on prism boundaries at rotated extreme angles, mobile controls, disabled controls, multi-instance disposal, React prop/callback updates, and no Three/XR.`);
} finally {
  await browser?.close();server.kill('SIGTERM');
  await unlink(reactFixturePath).catch(()=>{});
}
