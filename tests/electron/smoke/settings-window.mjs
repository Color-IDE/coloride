import {_electron, expect} from '@playwright/test';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require = createRequire(import.meta.url);
const {resolveTestPython} = require('../support/python.cjs');
const sandbox = await mkdtemp(join(tmpdir(), 'coloride-settings-'));
const project = join(sandbox, 'project');
const output = resolve('artifacts/settings-window');
await mkdir(project); await mkdir(output, {recursive:true});
await writeFile(join(project, 'settings-fixture.ts'), 'export const greeting = "Coloride";\n');
const env = {...process.env, HOME:join(sandbox,'home'), COLORIDE_TEST_USER_DATA:join(sandbox,'profile'), COLORIDE_PYTHON:resolveTestPython(), COLORIDE_SENTRY_DISABLED:'1', COLORIDE_SKIP_UPDATE_CHECK:'1', COLORIDE_DEV:'0'};
await mkdir(env.HOME);
delete env.ELECTRON_RUN_AS_NODE; delete env.COLORIDE_WEB_DEV_URL;
let app, page, settings;
try {
  app = await _electron.launch({executablePath:require('electron'),args:[resolve('client/desktop/src/main.cjs')],env,timeout:60000});
  page = await app.firstWindow(); page.setDefaultTimeout(15000);
  const errors=[]; page.on('pageerror', error=>errors.push(error.message));
  await expect(page.getByRole('menuitem',{name:'Open Project',exact:true})).toBeVisible({timeout:60000});
  await expect(page.locator('html')).not.toHaveAttribute('data-startup', /.+/);
  const openSettings = () => app.evaluate(({Menu}) => {
    const walk = items => items.flatMap(item => [item, ...(item.submenu ? walk(item.submenu.items) : [])]);
    const item = walk(Menu.getApplicationMenu().items).find(item => item.label === 'Settings…');
    if (!item) throw new Error('Native Settings menu item missing');
    item.click();
  });
  const newSettings = async () => {
    const created=app.waitForEvent('window');
    await openSettings();
    const settings=await created;
    settings.setDefaultTimeout(15000);
    settings.on('pageerror', error=>errors.push(error.message));
    await expect(settings.getByRole('region',{name:'General settings',exact:true})).toBeVisible();
    return settings;
  };
  // A separate native window works even without a project or login.
  settings=await newSettings();
  await expect(page.getByRole('menuitem',{name:'Open Project',exact:true})).toBeVisible();
  expect(app.windows()).toHaveLength(2);
  await expect(settings.locator('.settings-navigation-title, .settings-navigation-footer, .settings-page-header')).toHaveCount(0);
  if (process.platform === 'darwin') expect(await (await app.browserWindow(settings)).evaluate(win=>win.getContentBounds().height===win.getBounds().height)).toBe(true);
  await (await app.browserWindow(settings)).evaluate(win=>win.setSize(1120,550));
  const contentScroll=settings.getByRole('scrollbar',{name:'Settings content scroll'});
  await expect(contentScroll).toBeAttached();
  await contentScroll.focus();
  await contentScroll.press('End');
  await expect.poll(()=>settings.locator('.settings-page-scroll').evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
  await contentScroll.press('Home');
  await (await app.browserWindow(settings)).evaluate(win=>win.setSize(1120,800));
  expect(await (await app.browserWindow(settings)).evaluate(win=>win.getParentWindow())).toBeNull();
  const nav=()=>settings.getByRole('navigation',{name:'Settings sections'});
  const category=name=>nav().getByRole('button',{name,exact:true}).and(settings.locator('.settings-nav-label'));
  await category('Appearance').click();
  await settings.getByRole('radio',{name:'Light theme',exact:true}).click();
  await expect(settings.locator('body')).toHaveAttribute('data-theme','light');
  await expect(page.locator('body')).toHaveAttribute('data-theme','light');
  await category('General').click();
  const restore=()=>settings.getByRole('switch',{name:'Restore open files',exact:true});
  const before=await restore().getAttribute('aria-checked');
  await restore().click();
  const changed=before==='true'?'false':'true';
  await expect(restore()).toHaveAttribute('aria-checked',changed);
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('coloride.app-preferences.v1')).restoreOpenFiles)).toBe(changed==='true');
  await settings.screenshot({path:join(output,'settings-light.png')});
  await (await app.browserWindow(settings)).evaluate(win=>win.close());
  await expect.poll(()=>app.windows().length).toBe(1);
  await app.evaluate(({dialog}, folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},project);
  await page.getByRole('menuitem',{name:'Open Project',exact:true}).click();
  await expect(page.getByLabel('Workspace file tree')).toBeVisible();
  await page.getByLabel('Workspace file tree').getByText('settings-fixture.ts',{exact:true}).click();
  await expect(page.locator('.cm-content').first()).toContainText('greeting');
  await page.getByRole('button',{name:'Show terminal',exact:true}).first().click();
  await expect(page.locator('[data-terminal-status=ready]').first()).toBeVisible({timeout:30000});
  const writeShellPid=async name=>{
    await page.locator('.xterm-helper-textarea').first().focus();
    await page.keyboard.insertText(`printf '%s' $$ > ${name}`);
    await page.keyboard.press('Enter');
    await expect.poll(()=>readFile(join(project,name),'utf8').catch(()=>'' )).toMatch(/^\d+$/);
    return readFile(join(project,name),'utf8');
  };
  const pid=await writeShellPid('settings-shell.pid');
  settings=await newSettings();
  await expect(restore()).toHaveAttribute('aria-checked',changed);
  const settingsId=await (await app.browserWindow(settings)).evaluate(win=>win.id);
  await openSettings();
  await expect.poll(()=>app.windows().length).toBe(2);
  expect(await app.evaluate(({BrowserWindow},id)=>BrowserWindow.getFocusedWindow()?.id===id,settingsId)).toBe(true);
  const search=settings.getByRole('textbox',{name:'Search settings'});
  await settings.keyboard.press('Meta+f');
  await expect(search).toBeFocused();
  await search.fill('minimap');
  await expect(settings.getByRole('switch',{name:'Editor minimap',exact:true})).toBeVisible();
  await expect(restore()).toBeHidden();
  await search.fill('nonexistent-preference-xyz');
  await expect(settings.getByRole('heading',{name:'No settings found'})).toBeVisible();
  await search.press('Escape');
  await expect(search).toHaveValue('');
  // Section links reuse the same window and leave search results.
  await search.fill('minimap');
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('coloride:open-settings',{detail:{section:'terminal'}})));
  await expect(settings.getByRole('region',{name:'Terminal settings',exact:true})).toBeVisible();
  await category('Appearance').click();
  await settings.getByRole('radio',{name:'Dark theme',exact:true}).click();
  await expect(page.locator('body')).toHaveAttribute('data-theme','dark');
  await category('General').click();
  await settings.screenshot({path:join(output,'settings-dark.png')});
  await (await app.browserWindow(settings)).evaluate(win=>win.setSize(760,650));
  await expect.poll(()=>settings.evaluate(()=>innerWidth)).toBe(760);
  await expect.poll(()=>settings.locator('.settings-workbench').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await settings.screenshot({path:join(output,'settings-narrow.png')});
  const settingsClosed=settings.waitForEvent('close');
  await settings.keyboard.press('Meta+w').catch(error=>{ if(!settings.isClosed()) throw error; });
  await settingsClosed;
  await expect.poll(()=>app.windows().length).toBe(1);
  await expect(page.locator('.cm-content').first()).toContainText('greeting');
  expect(await writeShellPid('settings-shell-return.pid')).toBe(pid);
  expect(errors).toEqual([]);
  console.log('PASS: Independent native Settings window, reuse, section links, search, persisted live preferences, themes, resize, native close and preserved editor/shell.');
} catch (error) {
  if (settings && !settings.isClosed()) {
    console.error('Settings focus:',await settings.evaluate(()=>({active:document.activeElement?.tagName,focused:document.hasFocus(),visibility:document.visibilityState})).catch(()=>null));
    console.error('Native focus:',await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(win=>({id:win.id,focused:win.isFocused(),visible:win.isVisible()}))));
  }
  await page?.screenshot({path:join(output,'failure.png')}).catch(()=>{});
  console.error(await page?.locator('body').innerText().catch(()=>''));
  throw error;
} finally {
  await app?.close().catch(()=>{});
  try {
    const runtime=JSON.parse(await readFile(join(sandbox,'profile','terminal-host.json'),'utf8'));
    const pids=execFileSync('/usr/sbin/lsof',['-tiTCP:'+runtime.port,'-sTCP:LISTEN'],{encoding:'utf8'}).trim().split(/\s+/);
    const processes=execFileSync('/bin/ps',['-axo','pid=,ppid='],{encoding:'utf8'}).trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number));
    const fixturePids=new Set(pids.map(Number).filter(pid=>pid>0));
    let changed=true;
    while(changed) { changed=false; for(const [pid,parent] of processes) if(fixturePids.has(parent)&&!fixturePids.has(pid)) { fixturePids.add(pid); changed=true; } }
    for(const pid of [...fixturePids].reverse()) { try { process.kill(pid,'SIGTERM'); } catch {} }
  } catch {}
  await rm(sandbox,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
