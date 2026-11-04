import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url);
const address = 'http://127.0.0.1:5203';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'examples/vanilla', '--host', '127.0.0.1', '--port', '5203', '--strictPort'], { cwd: root, stdio: 'pipe' });
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error('Three browser test server exited early');
    try { ready = (await fetch(address)).ok; } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'Three browser fixture server starts');
  browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || undefined, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 900, height: 700 }, hasTouch: true });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/three-fixture.html', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>html,body{margin:0}#mount{width:900px;height:700px}</style><div id="mount"></div><script type="module">
    import {createDeckController} from '/@fs${new URL('../packages/core/dist/index.js', import.meta.url).pathname}';
    import {createThreePrismDeck} from '/@fs${new URL('../packages/three/dist/index.js', import.meta.url).pathname}';
    const items=Array.from({length:10000},(_,id)=>({id,position:id*2}));
    const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#9bdac5"/></svg>');
    window.controller=createDeckController({items,adapter:{getKey:item=>item.id,getPosition:item=>item.position}});
    window.spatial=createThreePrismDeck(document.querySelector('#mount'),{controller:window.controller,maxVisible:12,getImage:()=>image,onError:error=>{throw error;}});
  </script>` }));
  await page.goto(`${address}/three-fixture.html`);
  await page.waitForFunction(() => window.spatial?.renderer.info.memory.textures > 0);
  assert.equal(await page.locator('canvas').count(), 1);
  assert.equal(await page.evaluate(() => window.spatial.scene.children[0].children.length), 12);
  assert.ok(await page.evaluate(() => window.spatial.renderer.info.memory.textures <= 12), 'Visible texture budget stays bounded');
  assert.equal(await page.evaluate(() => window.spatial.renderer.xr.enabled), false, 'Onscreen renderer leaves XR disabled');
  await page.waitForTimeout(150);
  const rendered = await page.evaluate(() => window.spatial.renderer.info.render.frame);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.spatial.renderer.info.render.frame), rendered, 'Desktop GPU rendering stops while idle');

  const point = await page.evaluate(() => {
    const mesh = window.spatial.scene.children[0].children.find((entry) => entry.userData.prismIndex === 0);
    const center = mesh.getWorldPosition(mesh.position.clone()).project(window.spatial.camera);
    return { x: (center.x + 1) * 450, y: (1 - center.y) * 350 };
  });
  await page.mouse.click(point.x, point.y);
  assert.equal(await page.evaluate(() => window.controller.getSnapshot().selectedKey), 0, 'Pointer raycast activates the visible pane');

  await page.locator('canvas').focus();
  await page.keyboard.press('End');
  assert.equal(await page.evaluate(() => window.controller.getSnapshot().focus), 9999);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.controller.getSnapshot().selectedKey), 9998);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.controller.getSnapshot().selectedKey), null);
  await page.keyboard.press('-');
  const zoom = await page.evaluate(() => window.controller.getSnapshot().zoom);
  assert.ok(zoom > 0, 'Minus compresses the prism');
  await page.mouse.move(450, 350);
  await page.mouse.wheel(0, 180);
  await page.waitForTimeout(75);
  assert.ok(await page.evaluate(() => window.controller.getSnapshot().zoom) > zoom, 'Vertical wheel adjusts density');

  const cdp = await page.context().newCDPSession(page);
  const beforePinch = await page.evaluate(() => window.controller.getSnapshot().zoom);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 390, y: 350 }, { x: 510, y: 350 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 420, y: 350 }, { x: 480, y: 350 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.ok(await page.evaluate(() => window.controller.getSnapshot().zoom) > beforePinch, 'Two-touch pinch adjusts density');
  assert.ok(await page.evaluate(() => window.spatial.renderer.info.memory.textures <= 12), 'Navigation recycles offscreen textures');
  await page.evaluate(() => window.spatial.dispose());
  assert.equal(await page.locator('canvas').count(), 0);
  assert.equal(await page.evaluate(() => window.spatial.scene.children[0].children.length), 0);
  await page.evaluate(() => { window.spatial.dispose(); window.controller.focus(0); window.controller.dispose(); });
  assert.deepEqual(errors, []);
  console.log('Three browser checks passed: bounded textures, idle GPU frames, keyboard, wheel, native pinch, XR remains disabled, and disposal.');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
