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
    import {createDeckController,getPrismGeometry} from '/@fs${new URL('../packages/core/dist/index.js', import.meta.url).pathname}';
    import {createThreePrismDeck} from '/@fs${new URL('../packages/three/dist/index.js', import.meta.url).pathname}';
    const items=Array.from({length:10000},(_,id)=>({id,position:id*2}));
    const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#9bdac5"/></svg>');
    window.controller=createDeckController({items,adapter:{getKey:item=>item.id,getPosition:item=>item.position}});
    window.imageRequests=0;
    window.makeSpatial=(extra={})=>createThreePrismDeck(document.querySelector('#mount'),{controller:window.controller,maxVisible:12,getImage:()=>{window.imageRequests++;return image;},onError:error=>{throw error;},...extra});
    window.spatial=window.makeSpatial();
    window.expectedGeometry=()=>{const {count,focus,zoom,view}=window.controller.getSnapshot();return getPrismGeometry({count,focus,zoom,view,width:900,height:700,positions:window.controller.getPositions()});};
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

  await page.evaluate(() => window.controller.setZoom(1));
  await page.waitForFunction(() => window.spatial.scene.children[0].children.every((mesh) => mesh.material.map));
  const beforeOrbit = await page.evaluate(() => {
    const { focus, selectedKey } = window.controller.getSnapshot();
    return { focus, selectedKey, textures: window.spatial.renderer.info.memory.textures,
      meshes: window.spatial.scene.children[0].children.map((mesh) => ({ uuid: mesh.uuid, texture: mesh.material.map.uuid, position: mesh.position.toArray() })) };
  });
  await page.keyboard.press('Alt+ArrowRight');
  await page.keyboard.press('Alt+ArrowUp');
  assert.deepEqual(await page.evaluate(() => window.controller.getSnapshot().view), { yaw: 5, pitch: 5 }, 'Alt-arrows orbit the shared camera state');
  await page.keyboard.down('Shift');
  await page.mouse.move(450, 350);
  await page.mouse.down();
  await page.mouse.move(550, 300, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  assert.deepEqual(await page.evaluate(() => window.controller.getSnapshot().view), { yaw: 25, pitch: 15 }, 'Shift-drag changes both viewing angles');
  await page.mouse.move(500, 350);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(450, 400, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  assert.deepEqual(await page.evaluate(() => window.controller.getSnapshot().view), { yaw: 15, pitch: 5 }, 'Right-drag also orbits without selecting');
  const afterOrbit = await page.evaluate(() => {
    const { focus, selectedKey } = window.controller.getSnapshot();
    const spatial = window.spatial, expected = window.expectedGeometry();
    const actualDirection = spatial.camera.getWorldDirection(spatial.camera.position.clone()).toArray();
    const cameraError = Math.max(...actualDirection.map((value, index) => Math.abs(value - expected.camera.direction[index])),
      ...spatial.camera.up.toArray().map((value, index) => Math.abs(value - expected.camera.up[index])),
      ...spatial.camera.position.toArray().map((value, index) => Math.abs(value - expected.camera.position[index] * 0.8 / expected.paneWidth)));
    return { focus, selectedKey, textures: spatial.renderer.info.memory.textures, cameraError,
      meshes: spatial.scene.children[0].children.map((mesh) => ({ uuid: mesh.uuid, texture: mesh.material.map.uuid, position: mesh.position.toArray() })) };
  });
  assert.equal(afterOrbit.focus, beforeOrbit.focus, 'Orbit never browses the collection');
  assert.equal(afterOrbit.selectedKey, beforeOrbit.selectedKey, 'Orbit never changes selection');
  assert.ok(afterOrbit.textures <= 12, 'Orbit stays within the GPU texture budget');
  assert.deepEqual(afterOrbit.meshes, beforeOrbit.meshes, 'Orbit retains pane meshes, texture objects, and fixed pane positions');
  assert.ok(afterOrbit.cameraError < 1e-8, 'WebGL camera position and basis match shared core geometry');
  await page.keyboard.press('0');
  assert.deepEqual(await page.evaluate(() => window.controller.getSnapshot().view), { yaw: 0, pitch: 0 }, '0 restores the default camera angle');

  // Exercise the presenting branch without starting an XR session or importing XR.
  // Actual tracking remains owned by the browser/headset and needs device testing.
  const xrBefore = await page.evaluate(() => {
    window.spatial.renderer.xr.isPresenting = true;
    const camera = window.spatial.camera;
    return { position: camera.position.toArray(), quaternion: camera.quaternion.toArray() };
  });
  await page.evaluate(() => window.controller.setView({ yaw: 20, pitch: -10 }));
  await page.keyboard.press('Alt+ArrowRight');
  await page.keyboard.press('0');
  assert.deepEqual(await page.evaluate(() => window.controller.getSnapshot().view), { yaw: 20, pitch: -10 }, 'Synthetic orbit shortcuts do not affect an immersive view');
  assert.deepEqual(await page.evaluate(() => ({ position: window.spatial.camera.position.toArray(), quaternion: window.spatial.camera.quaternion.toArray() })), xrBefore,
    'View updates preserve native headset camera pose while presenting');
  await page.evaluate(() => { window.spatial.renderer.xr.isPresenting = false; window.controller.resetView(); window.controller.setZoom(0); });
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
  await page.evaluate(() => { window.spatial = window.makeSpatial({ cameraControls: false }); window.controller.setView({ yaw: 20, pitch: -10 }); });
  await page.locator('canvas').focus();
  await page.keyboard.press('Alt+ArrowRight');
  await page.keyboard.press('0');
  await page.mouse.move(500, 350);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(450, 400, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  assert.deepEqual(await page.evaluate(() => window.controller.getSnapshot().view), { yaw: 20, pitch: -10 }, 'cameraControls:false disables orbit gestures and shortcuts');
  assert.equal(await page.locator('canvas').evaluate((canvas) => !canvas.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))), false,
    'Disabled camera controls leave the native context menu available');
  await page.evaluate(() => { window.spatial.dispose(); window.spatial.dispose(); window.controller.focus(0); window.controller.dispose(); });
  assert.deepEqual(errors, []);
  console.log('Three browser checks passed: bounded textures, idle GPU frames, shared orbit geometry, angle keyboard and drag controls, native XR pose isolation, wheel, native pinch, and disposal.');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
