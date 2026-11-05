import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url);
const port = 5231;
const servers = [];
const domPath = new URL('../packages/dom/dist/index.js', import.meta.url).pathname;
const stylePath = new URL('../packages/dom/src/style.css', import.meta.url).pathname;
const reactFixturePath = new URL('../test-results/plane-react-fixture.tsx', import.meta.url);
async function serve(example, offset = 0) {
  const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', `examples/${example}`, '--host', '127.0.0.1', '--port', String(port + offset), '--strictPort'], { cwd: root, stdio: 'pipe' });
  servers.push(child);
  let output = '';
  child.stderr.on('data', data => { output += data; });
  const address = `http://127.0.0.1:${port + offset}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Snap-plane test server exited early: ${output}`);
    try { if ((await fetch(address)).ok) return address; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Snap-plane test server did not start: ${output}`);
}
const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  html,body{margin:0;background:#fff;color:#181818;font:16px system-ui}main{max-width:1100px;margin:20px auto}.mount{height:680px;width:100%}#outside{margin:8px}.preview{display:grid;place-items:center;background:#eee;color:#111;font:24px system-ui}.preview img{width:100%;height:100%;object-fit:contain}@media(max-width:480px){main{margin:8px}.mount{height:720px}}
  </style></head><body><button id="outside">Application action</button><main><div id="one" class="mount"></div></main><script type="module">
  import {createPrismDeck} from '/@fs${domPath}';
  import '/@fs${stylePath}';
  window.items=Array.from({length:10000},(_,index)=>({id:'pane-'+index,label:'Pane '+index}));
  window.stats={created:0,disposed:0,images:0};window.moves=[];window.selections=[];window.activations=[];
  window.one=createPrismDeck(document.querySelector('#one'),{
    items:window.items,getKey:item=>item.id,adapter:{getKey:item=>item.id,getLabel:item=>item.label},
    variant:'C',initialFocus:5000,initialZoom:.2,maxVisible:24,transitionDuration:0,
    renderPane:item=>{window.stats.created++;const element=document.createElement('div');element.className='preview';const image=new Image();window.stats.images++;image.alt=item.label;image.draggable=false;image.src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="#eee"/><text x="100" y="280" fill="#111" font-size="90">'+item.label+'</text></svg>');element.append(image);return {element,dispose:()=>window.stats.disposed++};},
    onPaneMove:(item,index,offset)=>window.moves.push({key:item.id,index,offset}),
    onSelect:(item,index)=>window.selections.push({key:item.id,index}),onActivate:item=>window.activations.push(item.id),
  });
  </script></body></html>`;

let browser;
try {
  const address = await serve('vanilla');
  browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || undefined });
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 }, reducedMotion: 'reduce' });
  await context.route('**/plane-fixture.html', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  const errors = [], requests = [];
  const observe = page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(request.url()));
  };
  const page = await context.newPage(); observe(page);
  await page.goto(`${address}/plane-fixture.html`);
  await page.waitForFunction(() => window.one && document.querySelector('#one .prismdeck-pane'));
  const frames = target => (target ?? page).evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  const snapshot = target => (target ?? page).evaluate(() => window.one.controller.getSnapshot());
  const invariant = state => ({focus:state.focus,zoom:state.zoom,selectedKey:state.selectedKey,view:state.view});
  const resources = target => (target ?? page).evaluate(() => ({...window.stats}));
  const offset = target => (target ?? page).evaluate(() => window.one.getPaneOffset('pane-5000'));
  const selected = target => (target ?? page).locator('#one .prismdeck-selection-viewport .prismdeck-pane');
  const settled = async (target=page, open=true) => {
    await target.waitForFunction(open=>{const state=window.one.controller.getSnapshot(),amount=Number(window.one.element.dataset.prismdeckSelectionProgress);return open?state.selectedKey!==null&&amount===1:state.selectedKey===null&&amount===0;},open);
    await frames(target);
  };
  const resetOffset = async (target=page) => {
    await target.evaluate(()=>window.one.setPaneOffset('pane-5000',{x:0,y:0}));
    await frames(target);
  };
  const hitPoint = async (target=page) => selected(target).evaluate(node=>{
    const rect=node.getBoundingClientRect(),view=node.closest('.prismdeck-selection-viewport').getBoundingClientRect();
    const left=Math.max(rect.left,view.left),right=Math.min(rect.right,view.right),top=Math.max(rect.top,view.top),bottom=Math.min(rect.bottom,view.bottom);
    const coordinates=[.5,.4,.6,.3,.7,.2,.8,.1,.9];
    for(const row of coordinates)for(const column of coordinates){
      const point={x:left+(right-left)*column,y:top+(bottom-top)*row};
      if(document.elementFromPoint(point.x,point.y)?.closest('.prismdeck-pane')===node)return point;
    }
    return null;
  });
  const drag = async (dx,dy,target=page,cdp) => {
    const point=await hitPoint(target);assert.ok(point,'The selected pane exposes an actual draggable hit surface');
    if(cdp){
      assert.equal(await target.evaluate(({x,y})=>document.elementFromPoint(x,y)?.classList.contains('prismdeck-pane-select'),point),true,'Native drag starts on the pane selection button');
      await target.evaluate(()=>window.pointerTransferTrace=[]);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
      for(let step=1;step<=12;step++){
        await target.evaluate(()=>new Promise(requestAnimationFrame));const amount=1-(1-step/12)**3;
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x+dx*amount,y:point.y+dy*amount}]});
      }
      await target.evaluate(()=>new Promise(requestAnimationFrame));
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x+dx,y:point.y+dy}]});
      await target.evaluate(()=>new Promise(requestAnimationFrame));
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    }else{
      await target.mouse.move(point.x,point.y);await target.mouse.down();await target.mouse.move(point.x+dx,point.y+dy,{steps:10});await target.mouse.up();
    }
    await frames(target);
  };
  const coplanar = async (target=page) => {
    const result=await target.evaluate(()=>{
      const pane=window.one.element.querySelector('.prismdeck-selection-viewport .prismdeck-pane'),grid=window.one.element.querySelector('.prismdeck-plane-grid');
      const a=new DOMMatrixReadOnly(getComputedStyle(pane).transform),b=new DOMMatrixReadOnly(getComputedStyle(grid).transform);
      const basis=['m11','m12','m13','m21','m22','m23','m31','m32','m33'];
      const paneAt=JSON.parse(pane.dataset.prismdeckWorldPosition),gridAt=JSON.parse(grid.dataset.prismdeckWorldPosition),offset=JSON.parse(pane.dataset.prismdeckPlaneOffset);
      return {basisError:Math.max(...basis.map(key=>Math.abs(a[key]-b[key]))),normalError:Math.abs(paneAt[0]-gridAt[0]),xError:Math.abs(paneAt[2]-gridAt[2]-offset.x),yError:Math.abs(paneAt[1]-gridAt[1]-offset.y)};
    });
    assert.ok(Object.values(result).every(error=>Number.isFinite(error)&&error<1e-6),`The grid and displaced pane share one physical world plane and CSS orientation: ${JSON.stringify(result)}`);
  };
  const snapped = (position,size,label) => {
    assert.ok(Number.isFinite(position.x)&&Number.isFinite(position.y),`${label}: world-plane coordinates stay finite`);
    assert.ok(Math.abs(position.x/size-Math.round(position.x/size))<1e-7&&Math.abs(position.y/size-Math.round(position.y/size))<1e-7,`${label}: world-plane position snaps to ${size}-unit intersections: ${JSON.stringify(position)}`);
  };

  assert.equal(await page.locator('#one .prismdeck').getAttribute('data-prismdeck-layout'),'prism','Version C preserves the prism geometry');
  assert.equal(await page.locator('#one .prismdeck-wallet-pocket:visible').count(),0,'Version C contains no wallet treatment');
  assert.ok(await page.locator('#one .prismdeck-pane').count()<=24,'Ten thousand items create only the bounded visible pane window');
  await page.evaluate(()=>{window.original=document.querySelector('#one .prismdeck-pane.is-focused');window.beforeOpen={...window.stats};window.one.controller.select();});
  await settled();
  assert.equal(await page.evaluate(()=>document.querySelector('#one .prismdeck-selection-viewport .prismdeck-pane')===window.original),true,'The original prism pane extends into the workspace');
  assert.deepEqual(await resources(),await page.evaluate(()=>window.beforeOpen),'Opening the plane creates no replacement content or image');
  assert.equal(await page.locator('#one .prismdeck-plane-grid:visible').count(),1,'C exposes one extended snap grid');
  assert.equal(await page.locator('#one .prismdeck-plane-grid').getAttribute('aria-hidden'),'true','The decorative grid adds no assistive-technology noise');
  assert.equal(await page.locator('dialog[open]').count(),0,'The plane remains a seamless part of the deck');
  const setterCheck=await page.evaluate(()=>{
    const calls=window.moves.length;window.one.setPaneOffset('pane-5000',{x:13.25,y:-7.5});
    const exact=window.one.getPaneOffset('pane-5000');const copy=window.one.getPaneOffset('pane-5000');copy.x=900;
    window.one.setPaneOffset('pane-5000',{x:NaN,y:4});window.one.setPaneOffset('missing',{x:2,y:3});
    return {exact,unchanged:window.one.getPaneOffset('pane-5000'),missing:window.one.getPaneOffset('missing'),calls:window.moves.length-calls};
  });
  assert.deepEqual(setterCheck,{exact:{x:13.25,y:-7.5},unchanged:{x:13.25,y:-7.5},missing:{x:0,y:0},calls:0},'The host setter stores exact finite coordinates, returns defensive copies, ignores invalid/unknown keys, and emits no interactive callback');
  await resetOffset();
  const baseline=invariant(await snapshot()),baselineResources=await resources();
  let directionalChecks=0;
  for(const view of [{yaw:0,pitch:0},{yaw:35,pitch:-20},{yaw:-40,pitch:30}]){
    await page.evaluate(view=>{window.one.controller.setView(view);window.one.update({gridSize:40,paneDrag:'free',snapToGrid:true});},view);
    for(const [label,dx,dy] of [['right',112,0],['left',-112,0],['down',0,96],['up',0,-96],['diagonal',96,-80]]){
      await resetOffset();const before=await selected().boundingBox();const movesBefore=await page.evaluate(()=>window.moves.length);
      await drag(dx,dy);const position=await offset(),after=await selected().boundingBox();
      snapped(position,40,`${label} ${view.yaw}/${view.pitch}`);await coplanar();
      assert.ok(Math.hypot(position.x,position.y)>0,`${label}: drag changes the pane position`);
      const actualX=after.x-before.x,actualY=after.y-before.y;
      assert.ok(actualX*dx+actualY*dy>0,`${label}: the pane follows the pointer direction: ${JSON.stringify({actualX,actualY,dx,dy,position})}`);
      assert.equal(await page.evaluate(()=>window.moves.length),movesBefore+1,`${label}: release commits exactly one application callback`);
      assert.deepEqual(invariant(await snapshot()),{...baseline,view},`${label}: moving preserves navigation, camera, and selected key`);
      assert.deepEqual(await resources(),baselineResources,`${label}: moving reuses mounted content and images`);
      assert.equal(await page.evaluate(()=>window.activations.length),0,`${label}: drag does not activate the pane`);
      assert.equal(await page.evaluate(()=>document.querySelector('#one .prismdeck-selection-viewport .prismdeck-pane')===window.original),true,`${label}: drag retains the original pane node`);
      directionalChecks++;
    }
  }

  // Losing the gesture surface's own capture cancels placement, while the
  // child's implicit capture transfer above must keep it live.
  await resetOffset();const cancelPoint=await hitPoint();const cancelCalls=await page.evaluate(()=>window.moves.length);
  await page.evaluate(()=>window.one.element.addEventListener('pointerdown',event=>window.lastCaptureId=event.pointerId,{once:true}));
  await page.mouse.move(cancelPoint.x,cancelPoint.y);await page.mouse.down();await page.mouse.move(cancelPoint.x+64,cancelPoint.y+38,{steps:6});await frames();
  assert.ok(Math.hypot((await offset()).x,(await offset()).y)>0,'A captured gesture previews live movement before cancellation');
  assert.equal(await page.evaluate(()=>window.one.element.querySelector('.prismdeck-selection-viewport').hasPointerCapture(window.lastCaptureId)),true,'The selected plane gesture owns actual pointer capture');
  await page.evaluate(()=>window.one.element.querySelector('.prismdeck-selection-viewport').releasePointerCapture(window.lastCaptureId));
  await page.mouse.move(cancelPoint.x+70,cancelPoint.y+40);await page.mouse.up();await frames();
  assert.deepEqual(await offset(),{x:0,y:0},'Losing the gesture surface capture restores the original placement');
  assert.equal(await page.evaluate(()=>window.moves.length),cancelCalls,'Cancelled capture loss emits no committed move callback');

  await resetOffset();await page.locator('#one .prismdeck').focus();
  const keyboardCalls=await page.evaluate(()=>window.moves.length);
  await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowUp');await frames();
  assert.deepEqual(await offset(),{x:40,y:40},'Arrow keys move one cell along both pane axes');
  await page.keyboard.press('Shift+ArrowLeft');await frames();
  assert.deepEqual(await offset(),{x:-120,y:40},'Shift-arrow accelerates keyboard placement by four cells');
  assert.equal(await page.evaluate(()=>window.moves.length),keyboardCalls+3,'Each keyboard placement commits one callback');
  await page.keyboard.press('Home');await frames();assert.deepEqual(await offset(),{x:0,y:0},'Home centers the selected plane without navigating the collection');
  await page.keyboard.press('ArrowLeft');await frames();
  const resetCalls=await page.evaluate(()=>window.moves.length);await page.getByLabel('Reset pane position',{exact:true}).click();await frames();
  assert.deepEqual(await offset(),{x:0,y:0},'The discoverable Center pane button resets placement');
  assert.equal(await page.evaluate(()=>window.moves.length),resetCalls+1,'The Center pane button commits one callback');
  assert.deepEqual(invariant(await snapshot()),{...baseline,view:{yaw:-40,pitch:30}},'Keyboard and reset placement leave navigation and camera unchanged');
  await drag(96,-80);

  // The saved placement belongs to the stable item key, not a mounted preview.
  const retained=await offset();
  await page.evaluate(()=>window.one.controller.dismiss());await settled(page,false);
  await page.evaluate(()=>window.one.controller.select());await settled();
  assert.deepEqual(await offset(),retained,'Dismissing and selecting again restores the item placement');
  assert.equal(await page.evaluate(()=>document.querySelector('#one .prismdeck-selection-viewport .prismdeck-pane')===window.original),true,'Returning to the workspace reuses the same node');
  await page.evaluate(()=>{window.one.controller.dismiss();window.one.controller.focus(0);});await settled(page,false);
  await page.evaluate(()=>{window.one.controller.focus(5000);window.one.controller.select();});await settled();
  assert.deepEqual(await offset(),retained,'Placement survives leaving and remounting its bounded preview window');

  // Controller mutations are public entry points too: prune removed keys
  // synchronously, even if an application removes and re-adds in one JS turn.
  const pruned=await page.evaluate(()=>{
    const calls=window.moves.length;window.one.setPaneOffset('pane-5000',{x:83,y:-44});
    window.one.controller.setItems(window.items.filter(item=>item.id!=='pane-5000'));
    const removed=window.one.getPaneOffset('pane-5000');
    window.one.controller.setItems(window.items);const readded=window.one.getPaneOffset('pane-5000');
    window.one.controller.focus(5000);window.one.controller.select();
    return {removed,readded,calls:window.moves.length-calls};
  });
  assert.deepEqual(pruned,{removed:{x:0,y:0},readded:{x:0,y:0},calls:0},'Direct controller removal/re-addition discards stale offsets synchronously and emits no interactive move');
  await settled();
  await page.evaluate(()=>window.one.setPaneOffset('pane-5000',{x:13,y:27}));await frames();
  const removedDragPoint=await hitPoint(),removedDragCalls=await page.evaluate(()=>window.moves.length);
  await page.mouse.move(removedDragPoint.x,removedDragPoint.y);await page.mouse.down();await page.mouse.move(removedDragPoint.x+66,removedDragPoint.y+32,{steps:6});await frames();
  assert.equal(await page.locator('#one .prismdeck').evaluate(node=>node.classList.contains('is-plane-dragging')),true,'Removal regression begins with an actual active plane drag');
  const removedDrag=await page.evaluate(()=>{
    window.one.controller.setItems(window.items.filter(item=>item.id!=='pane-5000'));
    return {offset:window.one.getPaneOffset('pane-5000'),dragging:window.one.element.classList.contains('is-plane-dragging')};
  });
  assert.deepEqual(removedDrag,{offset:{x:0,y:0},dragging:false},'Removing the dragged key cancels the gesture and prunes its placement immediately');
  await page.mouse.move(removedDragPoint.x+82,removedDragPoint.y+40);await page.mouse.up();await frames();
  await page.evaluate(()=>{window.one.controller.setItems(window.items);window.one.controller.focus(5000);window.one.controller.select();});await settled();
  assert.deepEqual(await offset(),{x:0,y:0},'A late pointer release does not restore a removed key placement after re-addition');
  assert.equal(await page.evaluate(()=>window.moves.length),removedDragCalls,'Removing a dragged key emits no committed move');

  // Axis restrictions preserve exact host-provided coordinates on the other
  // axis and do not emit a no-op commit for a blocked arrow.
  for(const [mode,blocked,active,expected] of [['horizontal','ArrowUp','ArrowRight',{x:40,y:27}],['vertical','ArrowRight','ArrowUp',{x:13,y:80}]]){
    await page.evaluate(mode=>{window.one.update({paneDrag:mode,snapToGrid:true,gridSize:40});window.one.setPaneOffset('pane-5000',{x:13,y:27});},mode);await frames();await page.locator('#one .prismdeck').focus();
    const beforeCalls=await page.evaluate(()=>window.moves.length);await page.keyboard.press(blocked);await frames();
    assert.deepEqual(await offset(),{x:13,y:27},`${mode}: a blocked arrow preserves both off-grid coordinates`);
    assert.equal(await page.evaluate(()=>window.moves.length),beforeCalls,`${mode}: a blocked arrow emits no move callback`);
    await page.keyboard.press(active);await frames();
    assert.deepEqual(await offset(),expected,`${mode}: the active arrow snaps only its coordinate and preserves the exact other axis`);
    assert.equal(await page.evaluate(()=>window.moves.length),beforeCalls+1,`${mode}: the active arrow commits exactly once`);
  }
  await page.evaluate(()=>window.one.update({variant:'C',paneDrag:'free',planeGrid:true,snapToGrid:true}));await resetOffset();
  const wheelPoint=await hitPoint(),wheelCalls=await page.evaluate(()=>window.moves.length);
  await page.mouse.move(wheelPoint.x,wheelPoint.y);await page.mouse.wheel(220,0);
  await page.waitForFunction(()=>window.one.controller.getSnapshot().focus===5002&&window.one.controller.getSnapshot().selectedKey==='pane-5002'&&window.one.element.querySelector('.prismdeck-selection-viewport .prismdeck-pane')?.dataset.prismdeckKey==='pane-5002'&&Number(window.one.element.dataset.prismdeckSelectionProgress)===1);
  assert.equal(await page.locator('#one .prismdeck-plane-grid:visible').count(),1,'Horizontal wheel browsing keeps the newly focused pane selected in the C grid workspace');
  assert.equal(await page.evaluate(()=>window.moves.length),wheelCalls,'Horizontal browsing does not commit a pane placement');
  await page.evaluate(()=>{window.one.controller.focus(5000);window.one.controller.select();});await settled();

  await page.evaluate(()=>window.one.update({planeGrid:false,paneDrag:'free',snapToGrid:false}));await resetOffset();
  assert.equal(await page.locator('#one .prismdeck-plane-grid:visible').count(),0,'Grid visibility can be disabled independently of movement');
  await drag(107,-63);const unsnapped=await offset();
  assert.ok(Math.hypot(unsnapped.x,unsnapped.y)>0,'Free placement works without drawing the grid');
  assert.ok(Math.abs(unsnapped.x/40-Math.round(unsnapped.x/40))>1e-4||Math.abs(unsnapped.y/40-Math.round(unsnapped.y/40))>1e-4,'snapToGrid:false retains a continuous position');
  for(const [mode,dx,dy] of [['horizontal',107,74],['vertical',107,74]]){
    await page.evaluate(mode=>window.one.update({paneDrag:mode}),mode);await resetOffset();await drag(dx,dy);const value=await offset();
    assert.ok(Math.abs(value[mode==='horizontal'?'y':'x'])<1e-7,`${mode}: orthogonal world coordinate stays fixed`);
    assert.ok(Math.abs(value[mode==='horizontal'?'x':'y'])>0,`${mode}: permitted world coordinate moves`);
  }
  await page.evaluate(()=>window.one.update({paneDrag:'none',planeGrid:true,snapToGrid:true}));await resetOffset();
  const disabledCallbacks=await page.evaluate(()=>window.moves.length);await drag(96,-70);
  assert.deepEqual(await offset(),{x:0,y:0},'paneDrag:none leaves the saved position unchanged');
  assert.equal(await page.evaluate(()=>window.moves.length),disabledCallbacks,'A disabled drag emits no move callback');
  await page.evaluate(()=>window.one.update({paneDrag:'free',gridSize:24}));await drag(109,71);
  snapped(await offset(),24,'Custom grid spacing');

  // Every preset can opt into the same workspace instead of a separate widget.
  for(const variant of ['A','B']){
    await page.evaluate(variant=>{window.one.controller.dismiss();window.one.update({variant,selectionMode:'slide-out',planeGrid:true,paneDrag:'free',snapToGrid:true});window.one.controller.select();},variant);
    await settled();await resetOffset();await drag(-102,-74);
    snapped(await offset(),24,`${variant} opt-in`);
    assert.ok(Math.hypot((await offset()).x,(await offset()).y)>0,`${variant}: modular plane dragging is available`);
    assert.equal(await page.locator('#one .prismdeck-plane-grid:visible').count(),1,`${variant}: modular grid is visible`);
  }
  await page.evaluate(()=>{window.nextMoves=[];window.one.update({onPaneMove:(item,index,offset)=>window.nextMoves.push({key:item.id,index,offset})});});
  await resetOffset();await drag(88,51);
  assert.equal(await page.evaluate(()=>window.nextMoves.length),1,'Updating the callback routes commits to the latest application handler');
  await page.evaluate(()=>window.one.update({onPaneMove:undefined}));await resetOffset();await drag(-88,-51);
  assert.equal(await page.evaluate(()=>window.nextMoves.length),1,'Removing the callback detaches the old handler');

  // A real one-finger touch sequence must move the pane in every direction.
  const mobile=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:'reduce'});
  await mobile.route('**/plane-fixture.html',route=>route.fulfill({contentType:'text/html',body:fixture}));
  const touch=await mobile.newPage();observe(touch);await touch.goto(`${address}/plane-fixture.html`);
  await touch.waitForFunction(()=>window.one&&document.querySelector('#one .prismdeck-pane'));
  await touch.evaluate(()=>{
    window.pointerTransferTrace=[];
    for(const type of ['pointerdown','pointermove','lostpointercapture','pointerup'])document.addEventListener(type,event=>window.pointerTransferTrace.push({type,target:event.target.getAttribute?.('class')??event.target.tagName}),true);
  });
  await touch.evaluate(()=>{window.one.update({gridSize:40});window.one.controller.select();});await settled(touch);
  const cdp=await mobile.newCDPSession(touch),touchState=invariant(await snapshot(touch)),touchResources=await resources(touch);
  for(const [label,dx,dy] of [['right',62,0],['left',-62,0],['down',0,57],['up',0,-57],['diagonal',55,-48]]){
    await resetOffset(touch);await drag(dx,dy,touch,cdp);const value=await offset(touch);
    snapped(value,40,`Native touch ${label}`);await coplanar(touch);assert.ok(Math.hypot(value.x,value.y)>0,`Native touch ${label} moves the selected plane`);
    assert.deepEqual(invariant(await snapshot(touch)),touchState,`Native touch ${label} leaves navigation unchanged`);
    assert.deepEqual(await resources(touch),touchResources,`Native touch ${label} loads no new resources`);
    assert.equal(await touch.evaluate(()=>window.activations.length),0,`Native touch ${label} does not activate`);
    const transfer=await touch.evaluate(()=>window.pointerTransferTrace);
    assert.ok(transfer.some(event=>event.type==='lostpointercapture'&&event.target.includes('prismdeck-pane-select')),`Native touch ${label}: implicit button capture actually transfers to the selection surface`);
    assert.ok(transfer.filter(event=>event.type==='pointermove').length>=12,`Native touch ${label}: child capture loss preserves the full multi-move gesture`);
    directionalChecks++;
  }
  // A second finger switches the active placement drag into zoom. The live
  // movement rolls back and must never become a committed pane placement.
  await resetOffset(touch);await touch.evaluate(()=>window.one.setPaneOffset('pane-5000',{x:13,y:27}));await frames(touch);
  const pinchPoint=await hitPoint(touch),pinchCalls=await touch.evaluate(()=>window.moves.length),pinchState=await snapshot(touch);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:11,...pinchPoint}]});
  for(let step=1;step<=4;step++){
    await touch.evaluate(()=>new Promise(requestAnimationFrame));
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:11,x:pinchPoint.x+step*10,y:pinchPoint.y+step*5}]});
  }
  await frames(touch);
  assert.equal(await touch.locator('#one .prismdeck').evaluate(node=>node.classList.contains('is-plane-dragging')),true,'Pinch regression begins with a real one-finger plane drag');
  assert.notDeepEqual(await offset(touch),{x:13,y:27},'The first finger previews a displaced position before the pinch');
  const fingerOne={id:11,x:pinchPoint.x+40,y:pinchPoint.y+20},fingerTwo={id:12,x:pinchPoint.x+110,y:pinchPoint.y+20};
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[fingerOne,fingerTwo]});await frames(touch);
  assert.deepEqual(await offset(touch),{x:13,y:27},'Adding the second finger restores the exact pre-drag position');
  assert.equal(await touch.locator('#one .prismdeck').evaluate(node=>node.classList.contains('is-plane-dragging')),false,'Entering pinch clears the plane-dragging cursor state');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...fingerOne,x:fingerOne.x-10},{...fingerTwo,x:fingerTwo.x+10}]});await frames(touch);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await frames(touch);
  assert.notEqual((await snapshot(touch)).zoom,pinchState.zoom,'The second finger performs actual pinch zoom after switching modes');
  assert.equal((await snapshot(touch)).selectedKey,pinchState.selectedKey,'Pinch mode retains the selected stable item');
  assert.deepEqual(await offset(touch),{x:13,y:27},'Finishing the pinch retains the pre-drag placement');
  assert.equal(await touch.evaluate(()=>window.moves.length),pinchCalls,'Switching from placement to pinch commits no pane move');
  assert.equal(await touch.locator('#one .prismdeck').evaluate(node=>node.classList.contains('is-plane-dragging')),false,'Ending pinch leaves no stale drag cursor');

  assert.equal(await touch.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Phone workspace creates no horizontal page overflow');
  await mkdir(new URL('../test-results/',import.meta.url),{recursive:true});
  await resetOffset(touch);await touch.screenshot({path:new URL('../test-results/plane-mobile.png',import.meta.url).pathname});
  // About's embedded deck starts each native swipe on a pane button. Its
  // implicit capture must transfer to the viewport without ending the swipe.
  await touch.evaluate(()=>{
    window.one.controller.dismiss();
    window.one.update({variant:'A',layout:'prism',selectionMode:'none',planeGrid:undefined,paneDrag:undefined,maxVisible:7});
    window.one.controller.resetView();window.one.controller.setZoom(0);window.one.controller.focus(5000);
  });await settled(touch,false);
  const swipePoint=await touch.evaluate(()=>{
    const viewport=window.one.element.querySelector('.prismdeck-viewport').getBoundingClientRect();
    const candidates=[...window.one.element.querySelectorAll('.prismdeck-viewport .prismdeck-pane-select')].sort((a,b)=>Number(b.closest('.prismdeck-pane').classList.contains('is-focused'))-Number(a.closest('.prismdeck-pane').classList.contains('is-focused')));
    for(const node of candidates){const rect=node.getBoundingClientRect();
      const left=Math.max(rect.left,viewport.left+3,140),right=Math.min(rect.right,viewport.right-3),top=Math.max(rect.top,viewport.top+3),bottom=Math.min(rect.bottom,viewport.bottom-3);
      if(left>=right||top>=bottom)continue;
      for(let row=0;row<15;row++)for(let column=0;column<15;column++){
        const point={x:left+(right-left)*(column+.5)/15,y:top+(bottom-top)*(row+.5)/15};
        if(document.elementFromPoint(point.x,point.y)===node)return point;
      }
    }return null;
  });
  assert.ok(swipePoint,'The embedded seven-pane deck exposes an actual pane-select button for native swipe');
  await touch.evaluate(()=>window.pointerTransferTrace=[]);
  const swipeBefore=await snapshot(touch);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[swipePoint]});
  for(let step=1;step<=8;step++){
    await touch.evaluate(()=>new Promise(requestAnimationFrame));
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:swipePoint.x-step*16,y:swipePoint.y}]});
  }
  await touch.evaluate(()=>new Promise(requestAnimationFrame));
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:swipePoint.x-128,y:swipePoint.y}]});
  await touch.evaluate(()=>new Promise(requestAnimationFrame));
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await frames(touch);
  const swipeAfter=await snapshot(touch),swipeTrace=await touch.evaluate(()=>window.pointerTransferTrace);
  assert.equal(swipeAfter.focus,swipeBefore.focus+2,'A native 8 × 16px swipe processes the complete gesture after child capture transfer');
  assert.equal(swipeAfter.selectedKey,null,'Embedded swipe never selects or activates a pane');
  assert.equal(swipeTrace[0].target,'prismdeck-pane-select','The embedded native swipe starts on the pane button');
  assert.ok(swipeTrace.some(event=>event.type==='lostpointercapture'&&event.target==='prismdeck-pane-select'),'The embedded gesture exercises actual implicit child capture transfer');
  assert.ok(swipeTrace.filter(event=>event.type==='pointermove').length>=8,'The embedded viewport receives subsequent movement after capture transfer');
  await touch.evaluate(()=>window.one.dispose());
  assert.equal((await resources(touch)).created,(await resources(touch)).disposed,'Disposing the mobile workspace releases all content exactly once');
  await mobile.close();

  // The React wrapper forwards options and fresh callbacks without remounting.
  await writeFile(reactFixturePath,`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {PrismDeck} from '@prismdeck/react';import '@prismdeck/dom/style.css';
    const items=Array.from({length:100},(_,id)=>({id:'pane-'+id}));const getKey=item=>item.id;const renderPane=item=><span>{item.id}</span>;window.reactMoves=[];
    function App(){const [props,setProps]=useState({variant:'C',gridSize:40,onPaneMove:(item,index,offset)=>window.reactMoves.push({generation:1,key:item.id,index,offset})});window.setReactProps=next=>setProps(previous=>({...previous,...next}));return <PrismDeck items={items} getKey={getKey} renderPane={renderPane} {...props} onReady={deck=>window.reactDeck=deck} style={{height:620}}/>;}window.reactRoot=createRoot(document.querySelector('#root'));window.reactRoot.render(<App/>);`);
  await context.route('**/plane-react-fixture.html',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><body><div id="root"></div><script type="module" src="/@fs${reactFixturePath.pathname}"></script></body></html>`}));
  const react=await context.newPage();observe(react);await react.goto(`${address}/plane-react-fixture.html`);
  await react.waitForFunction(()=>window.reactDeck&&document.querySelector('.prismdeck-pane span'));
  await react.evaluate(()=>{window.one=window.reactDeck;window.one.controller.select();window.reactController=window.one.controller;window.reactPane=document.querySelector('.prismdeck-pane.is-focused');});await settled(react);
  const reactPane=react.locator('.prismdeck-selection-viewport .prismdeck-pane');let box=await reactPane.boundingBox();
  await react.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await react.mouse.down();await react.mouse.move(box.x+box.width*.5+99,box.y+box.height*.5-61,{steps:10});await react.mouse.up();await frames(react);
  assert.equal(await react.evaluate(()=>window.reactMoves.length),1,'React forwards the initial committed move callback');
  await react.evaluate(()=>{window.setReactProps({planeGrid:false,paneDrag:'vertical',snapToGrid:false,gridSize:24,onPaneMove:(item,index,offset)=>window.reactMoves.push({generation:2,key:item.id,index,offset})});window.one.setPaneOffset('pane-0',{x:0,y:0});});
  await react.locator('.prismdeck-plane-grid').waitFor({state:'hidden'});
  assert.equal(await react.evaluate(()=>window.one.controller===window.reactController&&document.querySelector('.prismdeck-selection-viewport .prismdeck-pane')===window.reactPane),true,'React option changes preserve controller and original selected pane');
  box=await reactPane.boundingBox();await react.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await react.mouse.down();await react.mouse.move(box.x+box.width*.5+91,box.y+box.height*.5+67,{steps:10});await react.mouse.up();await frames(react);
  const reactValue=await react.evaluate(()=>window.one.getPaneOffset('pane-0'));
  assert.ok(Math.abs(reactValue.x)<1e-7&&Math.abs(reactValue.y)>0,'React updates drag-axis options without remounting');
  assert.equal(await react.evaluate(()=>window.reactMoves.at(-1).generation),2,'React reads the latest callback prop');
  await react.evaluate(()=>window.reactRoot.unmount());assert.equal(await react.locator('.prismdeck').count(),0,'React unmount removes the grid and pointer listeners');

  // Shipped examples expose C as the same prism workspace and reusable options.
  const demo=await context.newPage();observe(demo);await demo.goto(`${address}/?variant=C&theme=light`);
  await demo.waitForSelector('.prismdeck[data-prismdeck-variant="C"][data-prismdeck-layout="prism"] .prismdeck-selection-viewport .prismdeck-pane');
  await demo.waitForFunction(()=>Number(document.querySelector('.prismdeck')?.dataset.prismdeckSelectionProgress)===1);
  assert.equal(await demo.locator('#plane-grid').isChecked(),true,'Vanilla C exposes its enabled grid option');
  assert.equal(await demo.locator('#pane-drag').inputValue(),'free','Vanilla C exposes any-direction movement');
  assert.equal(await demo.locator('#snap-to-grid').isChecked(),true,'Vanilla C exposes snapping separately');
  assert.equal(await demo.locator('#prism-lines').isDisabled(),false,'C keeps prism guide controls available');
  await demo.locator('#sequence').evaluate(node=>{node.value='10';node.dispatchEvent(new Event('input',{bubbles:true}));});
  await demo.waitForFunction(()=>window.deck.controller.getSnapshot().focus===10&&window.deck.controller.getSnapshot().selectedKey==='study-10'&&window.deck.element.querySelector('.prismdeck-selection-viewport .prismdeck-pane')?.dataset.prismdeckKey==='study-10'&&Number(window.deck.element.dataset.prismdeckSelectionProgress)===1);
  assert.equal(await demo.locator('.prismdeck-selection-viewport .prismdeck-pane').getAttribute('data-prismdeck-key'),'study-10','The shipped C sequence slider opens the focused pane in the existing workspace');
  await demo.getByLabel('Next pane',{exact:true}).click();
  await demo.waitForFunction(()=>window.deck.controller.getSnapshot().focus===11&&window.deck.controller.getSnapshot().selectedKey==='study-11'&&window.deck.element.querySelector('.prismdeck-selection-viewport .prismdeck-pane')?.dataset.prismdeckKey==='study-11'&&Number(window.deck.element.dataset.prismdeckSelectionProgress)===1);
  await demo.getByLabel('Previous pane',{exact:true}).click();
  await demo.waitForFunction(()=>window.deck.controller.getSnapshot().focus===10&&window.deck.controller.getSnapshot().selectedKey==='study-10'&&window.deck.element.querySelector('.prismdeck-selection-viewport .prismdeck-pane')?.dataset.prismdeckKey==='study-10'&&Number(window.deck.element.dataset.prismdeckSelectionProgress)===1);
  assert.equal(await demo.locator('.prismdeck-plane-grid:visible').count(),1,'Built-in next/previous navigation retains the selected C workspace grid');
  await demo.locator('#version-a').click();await demo.locator('#version-c').click();
  assert.equal(new URL(demo.url()).searchParams.get('variant'),'C','Switching back to C keeps a shareable URL');
  assert.equal(await demo.locator('.prismdeck-wallet-pocket:visible').count(),0,'The C demo contains no wallet fan');
  await demo.screenshot({path:new URL('../test-results/plane-desktop.png',import.meta.url).pathname,fullPage:true});
  const reactAddress=await serve('react',1),example=await context.newPage();observe(example);await example.goto(`${reactAddress}/?variant=C&theme=dark`);
  await example.waitForSelector('.prismdeck[data-prismdeck-variant="C"][data-prismdeck-layout="prism"] .prismdeck-selection-viewport img');
  await example.waitForFunction(()=>Number(document.querySelector('.prismdeck')?.dataset.prismdeckSelectionProgress)===1);
  assert.equal(await example.getByLabel('Plane grid',{exact:true}).isChecked(),true,'React C exposes its enabled grid option');
  assert.equal(await example.getByRole('combobox',{name:/^Pane drag/}).inputValue(),'free','React C exposes any-direction movement');
  assert.equal(await example.locator('.prismdeck-wallet-pocket:visible').count(),0,'React C contains no wallet fan');
  assert.ok(await example.locator('.prismdeck-pane').count()<=40,'React C keeps the rendered collection bounded');

  await page.evaluate(()=>window.one.dispose());
  const disposed=await resources();assert.equal(disposed.created,disposed.disposed,'Disposing the workspace releases every created content resource exactly once');
  assert.equal(await page.locator('.prismdeck').count(),0,'Disposal removes the grid and extended plane');
  assert.equal(requests.some(url=>/packages\/three|node_modules.*three|three\.js|\/xr[.\/]/.test(url)),false,'Default plane interactions and examples load no Three or XR module');
  assert.deepEqual(errors,[],'All snap-plane browser scenarios finish without errors');
  console.log(`Snap-plane browser checks passed: C prism and extended grid, ${directionalChecks} actual mouse/native-touch directional drags at multiple angles, world snapping, removal/cancellation/pinch/axis/wheel regressions, original-node/resource/state preservation, stable-key placement, independent options, embedded native capture transfer, A/B opt-in, latest callbacks, React updates, bounded 10,000 items, shipped examples, disposal, no Three/XR.`);
} finally {
  await browser?.close();
  for(const server of servers)server.kill('SIGTERM');
  await unlink(reactFixturePath).catch(()=>{});
}
