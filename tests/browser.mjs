import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url);
const port = 5197;
const servers = [];
async function serve(example, offset = 0) {
  const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', `examples/${example}`, '--host', '127.0.0.1', '--port', String(port + offset), '--strictPort'], {cwd: root, stdio: 'pipe'});
  servers.push(child);
  let output = '';
  child.stderr.on('data', data => output += data);
  const url = `http://127.0.0.1:${port + offset}`;
  for (let i=0;i<100;i++) {
    if(child.exitCode !== null) throw new Error(`Vite failed: ${output}`);
    try { if((await fetch(url)).ok) return url; } catch {}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error(`Vite startup timed out: ${output}`);
}
let browser;
try {
  const url = await serve('vanilla');
  browser = await chromium.launch({channel:process.env.BROWSER_CHANNEL || undefined, headless:true,args:['--enable-unsafe-swiftshader']});
  const context = await browser.newContext({viewport:{width:1440,height:1000}});
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>requests.push(request.url()));
  await page.goto(url);
  await page.waitForFunction(()=>window.deck && document.querySelectorAll('.prismdeck-pane').length>0);
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('.prismdeck-pane img')).every(image=>image.complete && image.naturalWidth>0));
  const snapshot = ()=>page.evaluate(()=>window.deck.controller.getSnapshot());
  assert.equal((await snapshot()).count,1000);
  assert.ok(await page.locator('.prismdeck-pane').count()<=40);
  assert.equal(requests.some(url=>/packages\/three|node_modules.*three|three\.js|\/xr[.\/]/.test(url)),false,'default path loads no Three or XR modules');
  const front = page.locator('.prismdeck-pane.is-focused');
  await page.waitForTimeout(200);
  const box = await front.boundingBox();
  assert.ok(box && box.width>30 && box.height>30,'focused pane has a visible projected surface');
  const hit = await front.locator('.prismdeck-pane-select').evaluate(node=>{
    const r=node.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;
    return node===document.elementFromPoint(x,y);
  });
  assert.equal(hit,true,'focused pane center receives a real click');
  await page.locator('.prismdeck').focus();
  await page.keyboard.press('End');
  await page.waitForFunction(()=>window.deck.controller.getSnapshot().focus===999);
  await page.keyboard.press('ArrowLeft');
  assert.equal((await snapshot()).focus,998);
  await page.keyboard.press('Home');
  await page.keyboard.press('-');
  assert.ok((await snapshot()).zoom>0);
  await page.keyboard.press('Enter');
  assert.equal((await snapshot()).selectedKey,'study-0');
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!document.querySelector('#pane-dialog').open);
  await page.evaluate(()=>{window.deck.controller.setZoom(1);});
  await page.waitForTimeout(500);
  assert.ok(await page.locator('.prismdeck-pane').count()<=40,'overview stays bounded');
  assert.ok(await page.locator('[data-prismdeck-key="study-999"]').count()>0,'overview samples collection endpoints');
  await page.evaluate(()=>window.setCollection(10000));
  assert.equal((await snapshot()).count,10000);
  await page.waitForTimeout(100);
  assert.ok(await page.locator('.prismdeck-pane').count()<=40,'ten thousand items stay bounded');
  await page.evaluate(()=>window.setCollection(0));
  await page.waitForFunction(()=>document.querySelectorAll('.prismdeck-pane').length===0);
  assert.equal((await snapshot()).focus,-1);
  await page.evaluate(()=>window.setCollection(12));
  await page.waitForFunction(()=>document.querySelectorAll('.prismdeck-pane').length===12);

  // Two independent instances, interactive content, callbacks refreshed by update, and disposal.
  // Use the package import through Vite's source resolver for an isolated fixture.
  await page.context().route('**/fixture.html',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><style>.mount{width:500px;height:400px;display:inline-block}</style><div id="one" class="mount"></div><div id="two" class="mount"></div><script type="module">
    import {createPrismDeck} from '/@fs${new URL('../packages/dom/dist/index.js',import.meta.url).pathname}';
    import '/@fs${new URL('../packages/dom/src/style.css',import.meta.url).pathname}';
    let a=0,b=0;const items=Array.from({length:100},(_,id)=>({id,label:'Pane '+id}));
    const options={items,getKey:x=>x.id,renderPane:x=>{const div=document.createElement('div');div.textContent=x.label;return div;}};
    window.one=createPrismDeck(document.querySelector('#one'),{...options,onSelect:()=>a++});
    window.two=createPrismDeck(document.querySelector('#two'),{...options,onSelect:()=>b++});
    window.check=()=>({a,b,one:one.controller.getSnapshot(),two:two.controller.getSnapshot()});
  </script>`}));
  const fixture = await page.context().newPage();
  await fixture.setViewportSize({width:1100,height:600});
  fixture.on('pageerror',error=>errors.push(error.message));
  await fixture.goto(`${url}/fixture.html`);
  await fixture.waitForFunction(()=>window.one && window.two);
  await fixture.locator('#one .prismdeck').focus();
  await fixture.keyboard.press('ArrowRight');
  assert.equal((await fixture.evaluate(()=>window.check())).two.focus,0,'keyboard only controls focused deck');
  assert.equal((await fixture.evaluate(()=>window.check())).one.focus,1);
  await fixture.evaluate(()=>window.one.update({onSelect:()=>{window.revised=true;}}));
  await fixture.keyboard.press('Enter');
  assert.equal(await fixture.evaluate(()=>window.revised),true,'update uses new callbacks');
  await fixture.evaluate(()=>window.one.dispose());
  assert.equal(await fixture.locator('#one .prismdeck').count(),0);
  assert.equal(await fixture.locator('#two .prismdeck').count(),1);
  await fixture.close();

  await page.locator('#spatial-button').click();
  await page.waitForSelector('#spatial-stage canvas');
  await page.waitForFunction(()=>document.querySelector('#spatial-message').textContent.includes('WebGL preview'));
  await page.locator('#close-spatial').click();
  await page.waitForFunction(()=>!document.querySelector('#spatial-stage canvas'));

  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>{window.setCollection(1000);window.deck.controller.setZoom(0);window.deck.controller.focus(20);});
  await page.waitForTimeout(100);
  const viewport = await page.locator('.prismdeck-viewport').boundingBox();
  assert.ok(viewport);
  await page.mouse.move(viewport.x+viewport.width/2,viewport.y+viewport.height/2);
  await page.mouse.wheel(0,450);
  await page.waitForTimeout(100);
  assert.ok((await snapshot()).zoom>0,'vertical wheel compresses prism');
  const cdp=await page.context().newCDPSession(page);
  const x=viewport.x+viewport.width/2,y=viewport.y+viewport.height/2;
  const before=(await snapshot()).zoom;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x-60,y},{x:x+60,y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-30,y},{x:x+30,y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForTimeout(100);
  assert.ok((await snapshot()).zoom>before,'native two-touch pinch compresses prism');
  await mkdir(new URL('../test-results/',import.meta.url),{recursive:true});
  await page.screenshot({path:new URL('../test-results/mobile.png',import.meta.url).pathname});
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(()=>window.deck.controller.setZoom(0));
  await page.waitForTimeout(150);
  await page.screenshot({path:new URL('../test-results/desktop.png',import.meta.url).pathname});

  const reactUrl=await serve('react',2);
  const react=await browser.newPage();
  react.on('pageerror',error=>errors.push(error.message));
  await react.goto(reactUrl);
  await react.waitForSelector('.prismdeck-pane');
  await react.waitForTimeout(300);
  assert.ok(await react.locator('.prismdeck-pane').count()<=40,'React portals stay bounded');
  assert.ok((await react.locator('.prismdeck-pane img').first().getAttribute('alt')).length>0,'React content renders in portals');
  await react.locator('.prismdeck').focus();
  await react.keyboard.press('ArrowRight');
  await react.keyboard.press('End');
  await react.waitForTimeout(100);
  assert.ok(await react.locator('.prismdeck-pane').count()<=40);
  assert.deepEqual(errors,[],'no browser errors');
  console.log('Browser checks passed: virtualization, zero default XR/Three, pointer hit, navigation, selection, updates, multi-instance isolation, empty data, native pinch, mobile, React portals.');
} finally {
  await browser?.close();
  for(const child of servers) child.kill('SIGTERM');
}
