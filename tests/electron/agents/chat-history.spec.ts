import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname,"../../..");
let app: ElectronApplication, page: Page, vite: ChildProcess, sandbox: string;
const errors: string[] = [];
test.beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(),"coloride-history-"));
  const net = await import("node:net");
  const port = await new Promise<number>(res => {const server=net.createServer();server.listen(0,"127.0.0.1",()=>{const n=(server.address() as any).port;server.close(()=>res(n));});});
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  vite=spawn(process.execPath,[join(root,"client/ide/node_modules/vite/bin/vite.js"),"--host","127.0.0.1","--port",String(port),"--strictPort"],{cwd:join(root,"client/ide"),env,stdio:"ignore"});
  await expect.poll(async () => {try{return (await fetch(`http://127.0.0.1:${port}/tests/chat-history.html`)).ok;}catch{return false;}},{timeout:30000}).toBe(true);
  app=await _electron.launch({executablePath:require("electron"),args:[join(root,"tests/electron/support/electron-main.cjs")],env:{...env,COLORIDE_TEST_USER_DATA:join(sandbox,"data"),COLORIDE_TEST_URL:`http://127.0.0.1:${port}/tests/chat-history.html`,COLORIDE_TEST_CONFIG:"{}"}});
  page=await app.firstWindow();page.on("pageerror",error=>errors.push(error.message));
  await page.route('**/api/agents/sessions/history**', async route => {
    const q = new URL(route.request().url()).searchParams.get('q')?.toLowerCase() || '';
    await route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},json:[
      {sessionId:'a',firstMessage:'hey',preview:'Camera request completed',snippet:q && 'OpenSky provider was repaired',matches:'opensky provider was repaired'.includes(q)},
      {sessionId:'b',firstMessage:'Fix the camera',preview:'Camera controls restored',snippet:'',matches:false},
    ]});
  });
  await page.reload();
  await expect(page.getByRole('option', {name:/hey/})).toBeVisible();
});
test.afterAll(async () => {await app?.close();vite?.kill("SIGTERM");if(sandbox)await rm(sandbox,{recursive:true,force:true});});

test('history distinguishes chats, filters projects and searches message content', async () => {
  const dialog = page.getByRole('dialog', {name:'Chat history'});
  await expect(dialog.locator('[role="option"]')).toHaveCount(2);
  await expect(dialog).toContainText('Today');
  await expect(dialog).toContainText('Yesterday');
  await expect(dialog).toContainText('Camera request completed');
  await dialog.getByLabel('Search chat history').fill('OpenSky');
  await expect(dialog.locator('[role="option"]')).toHaveCount(1);
  await expect(dialog.locator('[role="option"]')).toContainText('OpenSky provider was repaired');
  await dialog.getByLabel('Search chat history').fill('');
  await dialog.getByLabel('Filter by project').click();
  await dialog.getByRole('button', {name:'All projects',exact:true}).click();
  await expect(dialog.locator('[role="option"]')).toHaveCount(3);
  await dialog.getByLabel('Search chat history').fill('no matching term');
  await expect(dialog).toContainText('No conversations match');
  await dialog.getByLabel('Search chat history').fill('');
  await dialog.getByLabel('Filter by project').click();
  await dialog.getByRole('button', {name:'godseye · /projects/godseye',exact:true}).click();
});

test('rename, pin, archive and recoverable trash work with compact shared geometry', async () => {
  const dialog = page.getByRole('dialog', {name:'Chat history'});
  const actions = () => page.getByRole('menu', {name:'Conversation actions'});
  const originalRow = await dialog.getByRole('option', {name:/hey/}).boundingBox();
  await dialog.getByRole('option', {name:/hey/}).hover();
  await dialog.getByRole('button', {name:'Conversation actions: hey',exact:true}).click();
  await actions().getByRole('menuitem', {name:'Rename',exact:true}).click();
  const editingRow = await dialog.getByLabel('Conversation title').locator('..').boundingBox();
  expect(editingRow!.height).toBe(originalRow!.height);
  await expect(dialog.getByLabel('Conversation title').locator('..')).toContainText('Camera request completed');
  await page.screenshot({path:resolve('artifacts/terminal-smoke/chat-history-rename.png')});
  await dialog.getByLabel('Conversation title').fill('OpenSky fix');
  await dialog.getByLabel('Conversation title').press('Enter');
  await expect(dialog.getByRole('option', {name:/OpenSky fix/})).toBeVisible();
  await dialog.getByRole('option', {name:/OpenSky fix/}).hover();
  await dialog.getByRole('button', {name:'Pin OpenSky fix',exact:true}).click();
  await expect(dialog).toContainText('Pinned');
  await dialog.getByRole('option', {name:/OpenSky fix/}).hover();
  await dialog.getByRole('button', {name:'Conversation actions: OpenSky fix',exact:true}).click();
  await actions().getByRole('menuitem', {name:'Archive',exact:true}).click();
  await expect(dialog.getByRole('option', {name:/OpenSky fix/})).toHaveCount(0);
  await dialog.getByLabel('History view').click();
  await dialog.getByRole('button', {name:'Archived',exact:true}).click();
  await expect(dialog.getByRole('option', {name:/OpenSky fix/})).toBeVisible();
  await dialog.getByRole('option', {name:/OpenSky fix/}).hover();
  await dialog.getByRole('button', {name:'Conversation actions: OpenSky fix',exact:true}).click();
  await actions().getByRole('menuitem', {name:'Restore',exact:true}).click();
  await dialog.getByLabel('History view').click();
  await dialog.getByRole('button', {name:'Chats',exact:true}).click();
  await dialog.getByRole('option', {name:/OpenSky fix/}).hover();
  await dialog.getByRole('button', {name:'Conversation actions: OpenSky fix',exact:true}).click();
  await actions().getByRole('menuitem', {name:'Move to trash',exact:true}).click();
  await dialog.getByLabel('History view').click();
  await dialog.getByRole('button', {name:'Trash',exact:true}).click();
  await expect(dialog.getByRole('option', {name:/OpenSky fix/})).toBeVisible();
  await dialog.getByRole('option', {name:/OpenSky fix/}).hover();
  await dialog.getByRole('button', {name:'Conversation actions: OpenSky fix',exact:true}).click();
  await actions().getByRole('menuitem', {name:'Restore',exact:true}).click();
  await dialog.getByLabel('History view').click();
  await dialog.getByRole('button', {name:'Chats',exact:true}).click();
  await expect(dialog).toHaveCSS('border-radius','6px');
  await expect(dialog.locator('[role="option"]').first().locator('..')).toHaveCSS('border-radius','4px');
  for (const theme of ['dark','light']) {
    await page.evaluate(theme => document.body.dataset.theme=theme,theme);
    await page.screenshot({path:resolve(`artifacts/terminal-smoke/chat-history-${theme}.png`)});
  }
  expect(errors).toEqual([]);
});

test('keyboard navigation opens the selected conversation and Escape closes the dialog', async () => {
  const dialog = page.getByRole('dialog', {name:'Chat history'});
  await dialog.getByLabel('Search chat history').focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('Opened conversation')).toHaveText('b');
  await page.getByRole('button', {name:'Open history'}).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', {name:'Open history'})).toBeFocused();
});

test('selection, action alignment, shared dropdowns and tree scrollbar work in both themes', async () => {
  await page.reload();
  const dialog = page.getByRole('dialog', {name:'Chat history'});
  const rows = dialog.getByRole('option');
  await expect(rows).toHaveCount(2);
  await rows.nth(1).hover();
  await expect(rows.nth(1)).toHaveAttribute('aria-selected','true');
  await dialog.getByLabel('Search chat history').focus();
  await page.keyboard.press('ArrowUp');
  await expect(rows.first()).toHaveAttribute('aria-selected','true');
  await expect(rows.nth(1)).toHaveAttribute('aria-selected','false');
  await expect(rows.first().locator('..')).toHaveCSS('box-shadow','none');
  const rowBox = await rows.first().boundingBox();
  const actionBox = await dialog.getByRole('button', {name:'Pin hey',exact:true}).boundingBox();
  expect(actionBox!.y-rowBox!.y).toBeLessThan(10);
  await dialog.getByLabel('History view').click();
  await expect(dialog.locator('.agent-history-filter-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.agent-history-filter-menu')).toHaveCount(0);
  await expect(dialog.locator('footer kbd')).toHaveCount(3);
  await dialog.getByLabel('Search chat history').focus();
  await page.keyboard.press('ArrowUp');
  await dialog.getByRole('button', {name:'Next conversation',exact:true}).click();
  await expect(rows.nth(1)).toHaveAttribute('aria-selected','true');
  await dialog.getByRole('button', {name:'Previous conversation',exact:true}).click();
  await expect(rows.first()).toHaveAttribute('aria-selected','true');
  await dialog.getByLabel('History view').focus();
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toHaveAttribute('aria-selected','true');
  const footer = await dialog.locator('footer').boundingBox();
  await page.mouse.move(footer!.x+8,footer!.y+footer!.height/2);
  await page.mouse.down();
  await page.mouse.move(footer!.x+footer!.width-8,footer!.y+footer!.height/2,{steps:15});
  await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
  const search = dialog.getByLabel('Search chat history');
  await search.fill('selectable');
  await search.selectText();
  expect(await search.evaluate((node: HTMLInputElement) => node.value.slice(node.selectionStart ?? 0,node.selectionEnd ?? 0))).toBe('selectable');
  await search.fill('');
  await page.evaluate(() => window.dispatchEvent(new Event('populate-history')));
  await expect(rows).toHaveCount(32);
  await expect(dialog.getByRole('scrollbar',{name:'Chat history scroll'})).toBeVisible();
  await expect(dialog.locator('.agent-history-fade.bottom')).toHaveClass(/is-visible/);
  await dialog.locator('.agent-history-list').evaluate(node => node.scrollTop=100);
  await expect(dialog.locator('.agent-history-fade.top')).toHaveClass(/is-visible/);
  for (const theme of ['dark','light']) {
    await page.evaluate(theme => document.body.dataset.theme=theme,theme);
    await expect(dialog.getByLabel('History view')).toHaveCSS('background-color',theme === 'light' ? 'rgb(241, 242, 243)' : 'rgb(44, 44, 44)');
    await page.screenshot({path:resolve(`artifacts/terminal-smoke/chat-history-scroll-${theme}.png`)});
    await dialog.getByLabel('Filter by project').click();
    await expect(dialog.locator('.agent-history-filter-menu')).toHaveCSS('box-shadow','none');
    await expect(dialog.locator('.agent-history-filter-menu')).toHaveCSS('opacity','1');
    await page.screenshot({path:resolve(`artifacts/terminal-smoke/chat-history-dropdown-${theme}.png`)});
    await page.keyboard.press('Escape');
  }
  expect(errors).toEqual([]);
});
