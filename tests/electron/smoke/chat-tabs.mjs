import { _electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
// Run with --source [dark|light]. API/model output is simulated; the real IDE
// and its WebSocket event reducer render every transition in isolated user data.
const require = createRequire(import.meta.url);
const { resolveTestPython } = require('../support/python.cjs');
const source = process.argv[2] === '--source';

const binary = source ? require('electron') : resolve(process.argv[2] ?? 'artifacts/terminal-smoke/package/mac-arm64/Coloride.app/Contents/MacOS/Coloride');
const sandbox = await mkdtemp(join(tmpdir(), 'coloride-package-test-'));
await mkdir(join(sandbox, 'home'));
await mkdir(resolve('artifacts/terminal-smoke'),{recursive:true});
await mkdir(join(sandbox, 'project with spaces'));
await writeFile(join(sandbox, 'project with spaces', 'README.md'), '# Local terminal smoke\n');
await mkdir(join(sandbox,'project with spaces','target','nested'),{recursive:true});
await writeFile(join(sandbox,'project with spaces','source.txt'),'Tree cut fixture\n');
await writeFile(join(sandbox,'project with spaces','target','nested','note.txt'),'tree_menu_search_token\n');

const env = {...process.env, HOME: join(sandbox,'home'), COLORIDE_TEST_USER_DATA: join(sandbox,'user-data'),
  COLORIDE_SENTRY_DISABLED: '1', COLORIDE_SKIP_UPDATE_CHECK: '1', SHELL: process.env.COLORIDE_TEST_SHELL ?? '/bin/zsh'};
delete env.ELECTRON_RUN_AS_NODE;
delete env.COLORIDE_WEB_DEV_URL;
env.COLORIDE_PYTHON = resolveTestPython();
env.COLORIDE_DEV = '0';
let app, runtime;
try {
  app = await _electron.launch({executablePath: binary, args: source ? [resolve("client/desktop/src/main.cjs")] : [], env, timeout: 60000});
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const pageErrors=[];
  page.on("pageerror", error => pageErrors.push(error.message));
  await expect.poll(async () => {try {runtime = JSON.parse(await readFile(join(sandbox,'user-data','terminal-host.json'),'utf8'));return true;}catch{return false;}},{timeout:60000}).toBe(true);
  await page.route('https://**/*', route => route.abort());
  await expect(page.getByRole('button', {name:'Explorer', exact:true})).toBeVisible({timeout:60000});
  await (await app.browserWindow(page)).evaluate(win => { win.webContents.setBackgroundThrottling(false); win.showInactive(); });
  expect(await app.evaluate(({app}) => app.getName())).toBe('Coloride');
  await expect(page).toHaveTitle('Coloride');
  await expect(page.getByRole('img', {name: 'Coloride', exact: true})).toBeVisible();
  await page.screenshot({path: resolve('artifacts/terminal-smoke/coloride-welcome.png')});
  const nativeMacMenu = await app.evaluate(() => process.platform === 'darwin');
  const applicationMenu = page.getByRole('menubar',{name:'Application'});
  if (nativeMacMenu) {
    await expect(applicationMenu).toHaveCount(0);
    expect(await app.evaluate(({Menu}) => Menu.getApplicationMenu().items.map(item => item.label))).toEqual(['Coloride','File','Edit','Selection','View','Go','Run','Window','Help']);
    const menus = await app.evaluate(({Menu}) => Object.fromEntries(Menu.getApplicationMenu().items.map(menu => [menu.label,menu.submenu?.items.map(item => ({label:item.label,type:item.type,enabled:item.enabled}))])));
    expect(menus.File.filter(item => item.type !== 'separator').map(item => item.label)).toEqual(['New','New Window','Open…','Open Recent…','Open Remote…','Add Folder to Project…','Save','Save As…','Save All','Close Editor','Close Project','Close Window']);
    expect(menus.Selection.filter(item => item.type !== 'separator').map(item => item.label)).toEqual(['Select All','Expand Selection','Shrink Selection','Select Next Sibling','Select Previous Sibling','Add Cursor Above','Add Cursor Below','Select Next Occurrence','Select Previous Occurrence','Select All Occurrences','Move Line Up','Move Line Down','Duplicate Selection']);
    expect(menus.Run.find(item => item.label === 'Start Debugger').enabled).toBe(false);

  } else {
  await expect(applicationMenu.locator('.app-menu-trigger')).toHaveText(['File','Edit','Selection','View','Go','Run','Window','Help']);
  for (const label of ['File','Edit','Selection','View','Go','Run','Window','Help']) {
    await applicationMenu.getByRole('menuitem',{name:label,exact:true}).click();
    await expect(applicationMenu.locator('.app-menu-dropdown')).toHaveCount(1);
    await expect(applicationMenu.locator('.app-menu-dropdown')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(applicationMenu.locator('.app-menu-dropdown')).toHaveCount(0);
  }
  await applicationMenu.getByRole('menuitem',{name:'Selection',exact:true}).click();
  const editorCommands = [];
  await page.exposeFunction('captureMenuEditorCommand', command => editorCommands.push(command));
  await page.evaluate(() => window.addEventListener('coloride:editor-command', event => window.captureMenuEditorCommand(event.detail)));
  await applicationMenu.getByRole('menuitem',{name:/^Select All/}).click();
  await expect.poll(() => editorCommands).toEqual(['selectAll']);
  await expect(applicationMenu.locator('.app-menu-dropdown')).toHaveCount(0);
  await applicationMenu.getByRole('menuitem',{name:'File',exact:true}).focus();
  await page.keyboard.press('ArrowRight');
  await expect(applicationMenu.getByRole('menuitem',{name:'Edit',exact:true})).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(applicationMenu.locator('.app-menu-dropdown > button').first()).toBeFocused();
  await page.keyboard.press('Escape');

  }
  const sockets=[];
  await page.routeWebSocket(/\/ws\/events/,ws=>{sockets.push(ws);ws.connectToServer();});
  let session=null;
  await page.route('**/api/agents/config',async route=>{
    const response=await route.fetch();const config=await response.json();
    await route.fulfill({json:{...config,configured:true,availability:'available',managedLlm:false,credentialSource:'environment'}});
  });
  await page.route('**/api/agents/session/start',async route=>{
    const body=route.request().postDataJSON();
    session={sessionId:'transition-fixture',agent:'coloride',task:body.task,cwd:body.cwd,workspaceKind:'local',mode:'act',state:'running',spentUsd:0,startedAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    await route.fulfill({json:{sessionId:session.sessionId}});
  });
  await page.route('**/api/agents/sessions**',async route=>{
    const pathname=new URL(route.request().url()).pathname;
    if(pathname.endsWith('/sessions/history')) return route.fulfill({json:session?[{sessionId:session.sessionId,firstMessage:'hey',preview:'Ready for your next request',snippet:'',matches:false}]:[]});
    if(pathname.endsWith('/transition-fixture'))return route.fulfill({json:session});
    if(pathname.endsWith('/events'))return route.fulfill({json:[{id:'msg',sessionId:'transition-fixture',sequence:1,type:'user_message',data:{text:'hey'},createdAt:new Date().toISOString()}]});
    if(pathname==='/api/agents/sessions')return route.fulfill({json:session?[session]:[]});
    return route.fulfill({json:[]});
  });
  await page.reload();
  await expect(page.getByRole("button",{name:"Explorer",exact:true})).toBeVisible();
  await app.evaluate(({dialog}, folder) => { dialog.showOpenDialog = async () => ({canceled:false,filePaths:[folder]}); }, join(sandbox,'project with spaces'));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('coloride:app-menu-action', {detail:'open-local-folder'})));
  await expect(page.getByLabel('Workspace file tree')).toBeVisible();
  const column=page.locator('.agent-view-sidebar .agent-chat-column');
  await expect(column).toHaveClass(/is-empty-chat/,{timeout:30000});
  await page.waitForTimeout(500);
  expect(sockets.length).toBeGreaterThan(0);
  const theme=process.argv[3] ?? 'dark';
  await page.evaluate(theme=>document.body.dataset.theme=theme,theme);
  if (process.argv.includes('--composer-shape')) {
    await expect(page.locator('.agent-view-sidebar .agent-chat-column.is-empty-chat > .agent-composer-wrap')).toHaveCSS('padding-top','2px');
    await page.getByRole('button',{name:'Add tab',exact:true}).click();
    const addTabMenu = page.getByRole('menu',{name:'Add tab',exact:true});
    await expect(addTabMenu).toHaveCSS('border-radius','6px');
    await expect(addTabMenu).toHaveCSS('background-color',theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(48, 48, 48)');
    await expect(addTabMenu.getByRole('menuitem',{name:'Terminal',exact:true})).toHaveCSS('height','24px');
    await expect(addTabMenu.getByRole('menuitem',{name:'Terminal',exact:true})).toHaveCSS('border-radius','4px');
    await expect(addTabMenu.getByRole('menuitem',{name:'Coloride Agent',exact:true})).toHaveCSS('height','24px');
    await page.screenshot({path:resolve(`artifacts/terminal-smoke/add-tab-height-${theme}.png`)});
    await page.getByRole('button',{name:'Add tab',exact:true}).click();
    const modelTrigger = page.locator('.agent-view-sidebar .agent-composer-model-trigger').filter({visible:true});
    await modelTrigger.click();
    await expect(modelTrigger).toHaveAttribute('aria-expanded','true');
    if (theme === 'light') await expect(modelTrigger).toHaveCSS('background-color','rgb(228, 228, 231)');
    await page.screenshot({path:resolve(`artifacts/terminal-smoke/model-menu-active-${theme}.png`)});
    await modelTrigger.click();
    const headerRadius = await page.locator('.agent-view-sidebar [aria-label="Add tab"]').evaluate(node => getComputedStyle(node).borderRadius);
    expect(headerRadius).toBe('4px');
    await expect(page.locator('.agent-view-sidebar .agent-composer').filter({visible:true})).toHaveCSS('border-radius',headerRadius);
    await page.screenshot({path:resolve(`artifacts/terminal-smoke/composer-shape-sidebar-${theme}.png`)});
    const sidebar = page.locator('.agent-view-sidebar');
    await sidebar.locator('.agent-composer textarea').fill('hey');
    await sidebar.locator('.agent-composer textarea').press('Enter');
    await expect(sidebar.locator('.agent-user-message')).toContainText('hey');
    await expect(sidebar.locator('.agent-main')).toHaveCSS('--agent-content-top','2px');
    await page.screenshot({path:resolve(`artifacts/terminal-smoke/message-header-gap-${theme}.png`)});
    await page.getByRole('button',{name:'Agents',exact:true}).click();
    const composer = page.locator('.agent-view:not(.agent-view-sidebar) .agent-composer').filter({visible:true});
    await expect(composer).toHaveCSS('border-radius',headerRadius);
    await composer.locator('textarea').fill('hey');
    await composer.locator('textarea').press('Enter');
    const message = page.locator('.agent-view:not(.agent-view-sidebar) .agent-user-message').filter({visible:true}).last();
    await expect(message).toContainText('hey');
    await expect(message).toHaveCSS('border-radius',headerRadius);
    await expect(composer).toHaveCSS('border-radius',headerRadius);
    await page.screenshot({path:resolve(`artifacts/terminal-smoke/composer-shape-full-${theme}.png`)});
    expect(pageErrors).toEqual([]);
    console.log(`Composer shape ${theme}: passed`);
  } else {
  await page.getByLabel('Workspace file tree').getByText('README.md',{exact:true}).click();
  await expect(page.locator('.cm-content')).toContainText('Local terminal smoke',{timeout:15000});
  if (nativeMacMenu) {
    await expect(applicationMenu).toHaveCount(0);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.evaluate(() => {window.nativeCommand = null; window.addEventListener('coloride:editor-command', event => {window.nativeCommand=event.detail;});});
    await app.evaluate(({Menu}) => {const item=Menu.getApplicationMenu().items.find(item => item.label === 'Selection').submenu.items.find(item => item.label === 'Select Next Occurrence'); item.click(item);});
    await expect.poll(() => page.evaluate(() => window.nativeCommand)).toBe('selectNext');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('coloride:editor-command',{detail:'selectAll'})));
    await app.evaluate(({Menu}) => {const item=Menu.getApplicationMenu().items.find(item => item.label === 'Selection').submenu.items.find(item => item.label === 'Duplicate Selection'); item.click(item);});
    await expect.poll(async () => ((await page.locator('.cm-content').textContent()).match(/Local terminal smoke/g) || []).length).toBe(2);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('coloride:editor-command',{detail:'undo'})));
    await expect.poll(async () => ((await page.locator('.cm-content').textContent()).match(/Local terminal smoke/g) || []).length).toBe(1);
    const fontSize = await page.locator('.cm-content').evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    await app.evaluate(({Menu}) => {const item=Menu.getApplicationMenu().items.find(item => item.label === 'View').submenu.items.find(item => item.label === 'Zoom In'); item.click(item);});
    await expect.poll(() => page.locator('.cm-content').evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThan(fontSize);
    await app.evaluate(({Menu}) => {const item=Menu.getApplicationMenu().items.find(item => item.label === 'View').submenu.items.find(item => item.label === 'Reset Zoom'); item.click(item);});

  } else {
    await applicationMenu.getByRole('menuitem',{name:'Selection',exact:true}).click();
    await expect(applicationMenu.locator('.app-menu-dropdown')).toHaveCSS('opacity','1');
    await applicationMenu.getByRole('menuitem',{name:/^Select All/}).click();
  }
  if (!nativeMacMenu) await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).not.toBe('');
  await page.screenshot({path:resolve(`artifacts/terminal-smoke/application-menu-${theme}.png`)});
  await page.locator('.cm-content').click();

  const treeMenu = page.getByRole('menu').filter({has:page.getByRole('menuitem',{name:'Copy Relative Path',exact:true})});
  const treeRow = path => page.locator(`[data-tree-path=${JSON.stringify(path)}]`);
  const sourcePath = await page.locator('[data-tree-path]').filter({hasText:'source.txt'}).first().getAttribute('data-tree-path');
  const rootFolder = sourcePath.slice(0,sourcePath.lastIndexOf('/'));
  const openRootMenu = () => page.locator('.filetree-workspace-toggle').click({button:'right'});
  await openRootMenu();
  await expect(treeMenu.getByRole('menuitem',{name:'Open in Terminal',exact:true})).toBeVisible();
  for (const label of ['Cut','Rename','Delete']) await expect(treeMenu.getByRole('menuitem',{name:label,exact:true})).toHaveCount(0);
  await page.screenshot({path:resolve(`artifacts/terminal-smoke/tree-root-menu-${theme}.png`)});
  await treeMenu.getByRole('menuitem',{name:'Expand All',exact:true}).click();
  await expect(treeRow(join(rootFolder,'target','nested','note.txt'))).toBeVisible();
  await openRootMenu();
  await treeMenu.getByRole('menuitem',{name:'Collapse All',exact:true}).click();
  await expect(treeRow(join(rootFolder,'target','nested','note.txt'))).toHaveCount(0);
  await treeRow(join(rootFolder,'target')).click({button:'right'});
  await treeMenu.getByRole('menuitem',{name:'Find in Folder…',exact:true}).click();
  await page.getByPlaceholder('Search files and contents...').fill('tree_menu_search_token');
  await expect(page.getByPlaceholder('Search files and contents...')).toHaveValue('tree_menu_search_token');
  await expect(page.locator('.filetree-search-panel')).toContainText('note.txt',{timeout:15000});
  if (theme === 'light') await expect(page.getByPlaceholder('Search files and contents...')).toHaveCSS('color','rgb(39, 39, 42)');
  await page.screenshot({path:resolve(`artifacts/terminal-smoke/tree-folder-search-${theme}.png`)});
  await page.getByRole('button',{name:'Back to file tree',exact:true}).click();
  await treeRow(join(rootFolder,'source.txt')).click({button:'right'});
  for (const label of ['Cut','Copy','Duplicate','Paste','Undo','Copy Path','Copy Relative Path','Rename','Delete','Open in Terminal','Find in Folder…']) await expect(treeMenu.getByRole('menuitem',{name:label,exact:true})).toBeVisible();
  await page.screenshot({path:resolve(`artifacts/terminal-smoke/tree-file-menu-${theme}.png`)});
  await treeMenu.getByRole('menuitem',{name:'Cut',exact:true}).click();
  await treeRow(join(rootFolder,'target')).click({button:'right'});
  await treeMenu.getByRole('menuitem',{name:'Paste',exact:true}).click();
  await expect.poll(() => readFile(join(rootFolder,'target','source.txt'),'utf8').catch(() => null)).toBe('Tree cut fixture\n');
  await expect.poll(() => readFile(join(rootFolder,'source.txt'),'utf8').then(() => false).catch(error => error.code === 'ENOENT')).toBe(true);
  await app.evaluate(({shell}) => {globalThis.treeShellActions=[];shell.showItemInFolder=path => {globalThis.treeShellActions.push({action:'reveal',path});};shell.openPath=async path => {globalThis.treeShellActions.push({action:'open',path});return '';};});
  for (const label of ['Reveal in Finder','Open in Default App']) {
    await treeRow(join(rootFolder,'README.md')).click({button:'right'});
    await treeMenu.getByRole('menuitem',{name:label,exact:true}).click();
  }
  await expect.poll(() => app.evaluate(() => globalThis.treeShellActions)).toEqual([{action:'reveal',path:join(rootFolder,'README.md')},{action:'open',path:join(rootFolder,'README.md')}]);
  await treeRow(join(rootFolder,'target')).click({button:'right'});
  await treeMenu.getByRole('menuitem',{name:'Open in Terminal',exact:true}).click();
  await expect(page.locator('.terminal-pane-header').filter({visible:true}).first()).toBeVisible();
  await expect.poll(async () => {const response=await fetch(`http://${runtime.host}:${runtime.port}/api/term`,{headers:{Authorization:`Bearer ${runtime.token}`}});return (await response.json()).some(terminal => terminal.cwd === join(rootFolder,'target'));}).toBe(true);
  await page.getByRole('button',{name:'Hide terminal',exact:true}).first().click();
  await column.locator('textarea').fill('hey');
  await column.locator('textarea').press('Enter');
  await expect(column.locator('.agent-user-message-text')).toHaveText('hey');
  const contextMenu = page.getByRole('menu', {name: 'Agent context menu'});
  await column.locator('.agent-user-message-text').click({button:'right'});
  await expect(contextMenu).toBeVisible();
  expect((await contextMenu.boundingBox()).width).toBe(224);
  await contextMenu.getByRole('menuitem', {name:'Copy message',exact:true}).click();
  await expect.poll(() => app.evaluate(({clipboard}) => clipboard.readText())).toBe('hey');
  const composer = column.locator('textarea');
  await composer.fill('temporary draft');
  await composer.evaluate(input => {input.focus(); input.select();});
  await composer.click({button:'right',position:{x:15,y:10}});
  await expect(contextMenu.getByRole('menuitem', {name:/^Cut/})).toBeEnabled();
  await contextMenu.getByRole('menuitem', {name:/^Cut/}).click();
  await expect(composer).toHaveValue('');
  await expect.poll(() => app.evaluate(({clipboard}) => clipboard.readText())).toBe('temporary draft');
  await composer.press('Meta+z');
  await expect(composer).toHaveValue('temporary draft');
  await app.evaluate(({clipboard}) => clipboard.writeText('pasted draft'));
  await composer.evaluate(input => {input.focus(); input.select();});
  await composer.click({button:'right',position:{x:15,y:10}});
  await contextMenu.getByRole('menuitem', {name:/^Paste/}).click();
  await expect(composer).toHaveValue('pasted draft');
  await column.locator('.agent-user-message-text').click({button:'right'});
  await page.screenshot({path:resolve(`artifacts/terminal-smoke/agent-context-menu-${theme}.png`)});
  await contextMenu.getByRole('menuitem', {name:'Chat history',exact:true}).click();
  await expect(page.getByRole('dialog', {name:'Chat history'})).toBeVisible();
  await expect(page.getByRole('dialog', {name:'Chat history'})).toContainText('Ready for your next request');
  await page.screenshot({path:resolve(`artifacts/terminal-smoke/chat-history-app-${theme}.png`)});
  await page.keyboard.press('Escape');
  await composer.fill('');
  const chatTabs = page.getByRole('tablist', {name: 'Open chats'});
  await expect(chatTabs.getByRole('tab')).toHaveCount(1);
  const plus = page.getByRole('button', {name: 'Add tab', exact: true});
  const plusBefore = await plus.boundingBox();
  await plus.click();
  await expect(page.getByRole('menuitem', {name: 'Coloride Agent', exact: true})).toContainText('⌘T');
  await page.getByRole('menuitem', {name: 'Coloride Agent', exact: true}).click();
  const plusAfter = await plus.boundingBox();
  expect(plusAfter.x).toBe(plusBefore.x);
  const activeTab = page.locator('.agent-sidebar-tab[data-active="true"]');
  await expect(activeTab).toHaveClass(/editor-file-tab/);

  await expect(chatTabs.getByRole('tab')).toHaveCount(2);
  await expect(chatTabs.getByRole('tab', {name: 'New chat', exact: true})).toHaveAttribute('aria-selected', 'true');
  if (theme === 'light') {
    await page.evaluate(() => { document.body.dataset.theme = "light"; });
    await expect(chatTabs.getByRole('tab', {name: 'hey', exact: true})).toHaveCSS('color', 'rgb(113, 113, 122)');
    await expect(chatTabs.getByRole('tab', {name: 'New chat', exact: true})).toHaveCSS('color', 'rgb(23, 23, 23)');
  }
  await column.locator('textarea').fill('Keep this draft');
  await chatTabs.getByRole('tab', {name: 'hey', exact: true}).click();
  await expect(column.locator('.agent-user-message-text')).toHaveText('hey');
  await page.screenshot({path: resolve(`artifacts/terminal-smoke/chat-message-${theme}.png`)});
  await chatTabs.getByRole('tab', {name: 'New chat', exact: true}).click();
  await expect(column.locator('textarea')).toHaveValue('Keep this draft');
  await chatTabs.evaluate((element) => { element.parentElement.style.flex = '0 0 100px'; });
  const header = page.locator('.agent-sidebar-header');
  await expect(header.locator('[data-edge="right"]')).toHaveClass(/opacity-100/);
  await expect(header.locator('[data-edge="left"]')).toHaveClass(/opacity-0/);
  await expect(header.getByRole('scrollbar')).toBeVisible();
  await chatTabs.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  await expect(header.locator('[data-edge="left"]')).toHaveClass(/opacity-100/);
  await expect(header.locator('[data-edge="right"]')).toHaveClass(/opacity-0/);
  await page.screenshot({path: resolve(`artifacts/terminal-smoke/chat-tabs-overflow-${theme}.png`)});
  await chatTabs.evaluate((element) => { element.parentElement.style.flex = ''; });
  await page.screenshot({path: resolve(`artifacts/terminal-smoke/chat-tabs-${theme}.png`)});
  await page.getByRole('button', {name: 'Close chat: New chat', exact: true}).click();
  await expect(chatTabs.getByRole('tab')).toHaveCount(1);
  await expect(chatTabs.getByRole('tab', {name: 'hey', exact: true})).toHaveAttribute('aria-selected', 'true');
  await plus.click();
  await expect(page.getByRole('menu', {name: 'Add tab'})).toBeVisible();
  await page.screenshot({path: resolve(`artifacts/terminal-smoke/header-tab-menu-${theme}.png`)});
  await page.getByRole('menuitem', {name: 'Terminal', exact: true}).click();
  const terminalTab = chatTabs.getByRole('tab', {name: 'Terminal', exact: true});
  await expect(terminalTab).toHaveAttribute('aria-selected', 'true');
  const terminal = page.locator('.agent-view-sidebar .xterm').filter({visible: true});
  await expect(terminal).toBeVisible();
  await expect(terminal).toContainText('%');
  const spacing = await page.evaluate(() => {
    const root = document.querySelector('.agent-view-sidebar');
    const header = root.querySelector('.agent-sidebar-header').getBoundingClientRect();
    const screen = root.querySelector('.xterm-screen').getBoundingClientRect();
    return {gap: screen.top - header.bottom, firstRow: root.querySelector('.xterm-rows > div')?.textContent};
  });
  expect(spacing.gap).toBe(0);
  expect(spacing.firstRow).toContain('%');
  await terminal.click();
  await page.keyboard.type("printf 'HEADER_TERMINAL_OK\\n'");
  await page.keyboard.press('Enter');
  await expect(terminal).toContainText('HEADER_TERMINAL_OK');
  await chatTabs.getByRole('tab', {name: 'hey', exact: true}).click();
  await expect(column.locator('.agent-user-message-text')).toHaveText('hey');
  await terminalTab.click();
  await expect(terminal).toContainText('HEADER_TERMINAL_OK');
  await page.screenshot({path: resolve(`artifacts/terminal-smoke/header-terminal-${theme}.png`)});
  await page.getByRole('button', {name: 'Close chat: Terminal', exact: true}).click();
  await expect(terminalTab).toHaveCount(0);
  await page.getByRole('button', {name: 'Show terminal', exact: true}).first().click();
  const drawerHeader = page.locator('.terminal-pane-header').filter({visible: true}).first();
  await drawerHeader.getByRole('button', {name: 'Add tab', exact: true}).click();
  const drawerMenu = page.locator('.terminal-add-dropdown');
  await expect(drawerMenu).toBeVisible();
  await expect(drawerMenu).toHaveCSS('box-shadow', 'none');
  await expect(drawerMenu.getByRole('menuitem', {name: 'Terminal', exact: true})).toBeVisible();
  await page.screenshot({path: resolve(`artifacts/terminal-smoke/terminal-add-menu-${theme}.png`)});
  await page.keyboard.press('Escape');
  // A transformed panel must not become the fixed menu's coordinate system.
  await drawerHeader.evaluate(node => {node.closest('.terminal-panel-root')?.style.setProperty('transform','translateZ(0)');});
  const terminalSurface = page.locator('.terminal-xterm-host').filter({visible:true}).first();
  const terminalMenu = page.locator('.terminal-context-menu');
  for (const edge of ['top','bottom']) {
    const rect = await terminalSurface.boundingBox();
    const viewport = page.viewportSize() ?? await page.evaluate(() => ({width:innerWidth,height:innerHeight}));
    const point = {x:rect.x+40,y:edge === 'top' ? rect.y+10 : viewport.height-12};
    if (edge === 'top') await terminalSurface.click({button:'right',position:{x:40,y:10}});
    else await terminalSurface.dispatchEvent('contextmenu',{clientX:point.x,clientY:point.y,bubbles:true});
    await expect(terminalMenu).toBeVisible();
    expect(await terminalMenu.evaluate(node => node.parentElement === document.body)).toBe(true);
    const box = await terminalMenu.boundingBox();
    expect(Math.abs(box.x-point.x)).toBeLessThan(2);
    expect(box.y).toBeGreaterThanOrEqual(7);
    expect(box.y+box.height).toBeLessThanOrEqual(viewport.height-7);
    await page.screenshot({path:resolve(`artifacts/terminal-smoke/terminal-context-${edge}-${theme}.png`)});
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', {name: 'Hide agent panel', exact: true}).click();
  await expect(page.locator('.explorer-agent-dock')).toHaveAttribute('aria-hidden', 'true');
  await page.keyboard.press('Meta+t');
  await expect(page.locator('.explorer-agent-dock')).toHaveAttribute('aria-hidden', 'false');
  await expect(chatTabs.getByRole('tab', {name: 'New chat', exact: true})).toHaveAttribute('aria-selected', 'true');
  expect(pageErrors).toEqual([]);
  console.log(`Chat tabs ${theme}: passed`);
  }
} finally {
  await app?.close().catch(()=>{});
  if (!runtime) {try {runtime=JSON.parse(await readFile(join(sandbox,'user-data','terminal-host.json'),'utf8'));} catch {}}
  if (runtime) {
    const headers = {Authorization:`Bearer ${runtime.token}`};
    const sessions = await (await fetch(`http://${runtime.host}:${runtime.port}/api/term`,{headers})).json();
    for (const session of sessions) await fetch(`http://${runtime.host}:${runtime.port}/api/term/${session.termId}/close`,{method:'POST',headers});
  }
  // The app intentionally leaves the host alive. Terminate only this isolated
  // fixture's host by its discovery port, never a user's installed host.
  const {execFileSync} = await import('node:child_process');
  if (runtime) {
    try {
      const pids=execFileSync('/usr/sbin/lsof',['-tiTCP:'+runtime.port,'-sTCP:LISTEN'],{encoding:'utf8'}).trim().split(/\s+/);
      for(const pid of pids) if(Number(pid)>0) process.kill(Number(pid),'SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 1000));
      for(const pid of pids) if(Number(pid)>0) {
        try { process.kill(Number(pid), 'SIGKILL'); } catch {}
      }
    } catch {}
  }
  await rm(sandbox,{recursive:true,force:true});
}
