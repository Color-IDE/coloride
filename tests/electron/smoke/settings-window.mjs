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
const launchLog=[];
try {
  app = await _electron.launch({executablePath:require('electron'),args:[resolve('client/desktop/src/main.cjs')],env,timeout:60000});
  for (const stream of [app.process().stdout, app.process().stderr]) stream?.on('data', chunk => { launchLog.push(String(chunk)); if (launchLog.length > 30) launchLog.shift(); });
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
  // Exercise configuration with a fake key; never touch the OS credential store.
  const fakeKey='test-settings-key-not-a-real-secret';
  const secondKey='test-gemini-key-not-a-real-secret';
  const providerWrites=[];
  let legacyProviderResponse=false;
  let failProviderSave=true;
  const profiles={
    openai:{provider:'openai',model:'gpt-5.3-codex',baseUrl:'https://api.openai.com/v1',configured:false,credentialSource:'none'},
    gemini:{provider:'gemini',model:'gemini-3.8-flash',baseUrl:'https://generativelanguage.googleapis.com/v1beta',configured:false,credentialSource:'none'},
    xai:{provider:'xai',model:'grok-4.5',baseUrl:'https://api.x.ai/v1',configured:false,credentialSource:'none'},
    deepseek:{provider:'deepseek',model:'deepseek-flash',baseUrl:'https://api.deepseek.com',configured:false,credentialSource:'none'},
    fireworks:{provider:'fireworks',model:'accounts/fireworks/models/kimi-k3',baseUrl:'https://api.fireworks.ai/inference/v1',configured:false,credentialSource:'none'},
  };
  let providerFixture={...profiles.xai,availability:'missing_credentials',managedLlm:false,
    capabilities:{tools:true,streaming:true,encryptedReasoning:true,maxContextCharacters:100000,maxContextTokens:100000,maxRetries:3}};
  const providerRoute=async route=>{
    const connection=route.request().url().match(/\/providers\/(openai|gemini|xai|fireworks|deepseek|custom:[a-z0-9-]+)\/connect/);
    if(route.request().url().endsWith('/api/agents/providers') && route.request().method()==='POST') {
      const body=route.request().postDataJSON();
      profiles[body.id]={provider:body.id,label:body.label,protocol:body.protocol,baseUrl:body.baseUrl,requiresKey:body.requiresKey,showInSettings:true,configured:!body.requiresKey,credentialSource:body.requiresKey?'none':'local',model:'',availableModels:[]};
      await route.fulfill({status:201,json:{...body,builtin:false,showInSettings:true}}); return;
    }
    if(connection) {
      const provider=connection[1];
      const body=route.request().postDataJSON();
      providerWrites.push({provider,...body});
      if(body.apiKey && failProviderSave) { failProviderSave=false; await route.fulfill({status:503,json:{detail:'Credential store unavailable: '+fakeKey}}); return; }
      const availableModels=provider.startsWith('custom:') ? [{id:'small-local',label:'small-local',capabilities:{tools:false,images:false,reasoning:false,streaming:false,encrypted_reasoning:false,context_tokens:128000,context_characters:409600,source:'unknown'}}] : provider==='openai' ? [{id:'gpt-6.1-sol',label:'GPT-6.1 Sol'},{id:'gpt-5.3-codex',label:'GPT-5.3 Codex'}] : [{id:'gemini-4-argon',label:'Gemini 4 Argon'}];
      profiles[provider]={...profiles[provider],configured:true,credentialSource:profiles[provider].requiresKey===false?'local':'keychain',model:availableModels[0].id,availableModels};
      if(!providerFixture.configured || providerFixture.provider===provider) providerFixture={...providerFixture,...profiles[provider],availability:'available'};
    } else if(route.request().method()==='PUT') {
      const body=route.request().postDataJSON();
      providerWrites.push(body);
      if(failProviderSave) { failProviderSave=false; await route.fulfill({status:503,json:{detail:'Credential store unavailable: '+fakeKey}}); return; }
      profiles[body.provider]={...profiles[body.provider],model:body.model,
        ...(body.apiKey ? {configured:true,credentialSource:'keychain'} : {})};
      if(body.activate!==false || body.provider===providerFixture.provider) providerFixture={...providerFixture,...profiles[body.provider],availability:profiles[body.provider].configured?'available':'missing_credentials'};
    }
    await route.fulfill({json:{...providerFixture,...(legacyProviderResponse ? {} : {providers:Object.values(profiles).map(entry=>({...entry,active:entry.provider===providerFixture.provider}))})}});
  };
  await page.route('**/api/agents/config*',providerRoute);
  await page.route('**/api/agents/providers/*/connect',providerRoute);
  await page.route('**/api/agents/providers',providerRoute);
  const newSettings = async () => {
    const created=app.waitForEvent('window');
    await openSettings();
    const settings=await created;
    settings.setDefaultTimeout(15000);
    await settings.route('**/api/agents/config*',providerRoute);
    await settings.route('**/api/agents/providers/*/connect',providerRoute);
    await settings.route('**/api/agents/providers',providerRoute);
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
  const category=name=>nav().locator('.settings-nav-label').filter({hasText:new RegExp('^'+name+'$')});
  await category('Appearance').click();
  await settings.getByRole('radio',{name:'Light theme',exact:true}).click();
  await expect(settings.locator('body')).toHaveAttribute('data-theme','light');
  await expect(page.locator('body')).toHaveAttribute('data-theme','light');
  await settings.screenshot({path:join(output,'settings-appearance-light.png')});
  await category('General').click();
  const afterConnecting=settings.getByRole('button',{name:'After connecting',exact:true});
  await afterConnecting.click();
  await expect(settings.locator('.settings-select-menu')).toBeVisible();
  await expect(settings.locator('.settings-select-menu').getByRole('button',{name:'Open server health',exact:true})).toBeVisible();
  await expect.poll(()=>settings.locator('.settings-select-menu').evaluate(el=>getComputedStyle(el).opacity)).toBe('1');
  await settings.screenshot({path:join(output,'settings-dropdown-light.png')});
  await afterConnecting.press('Escape');
  await expect(afterConnecting).toHaveAttribute('aria-expanded','false');
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
    await (await app.browserWindow(page)).evaluate(win=>win.focus());
    await page.locator('.xterm-helper-textarea').first().focus();
    await page.keyboard.press('Control+u');
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
  // Each provider has an independent visible form, not a provider dropdown.
  await expect(page.getByRole('button',{name:'Open LLM provider settings',exact:true})).toBeVisible();
  await expect(page.locator('.agent-provider-setup input')).toHaveCount(0);
  legacyProviderResponse=true;
  await page.getByRole('button',{name:'Open LLM provider settings',exact:true}).click();
  await expect(settings.getByRole('region',{name:'LLM Providers settings',exact:true})).toBeVisible();
  const pendingKey=settings.getByLabel('OpenAI API key',{exact:true});
  await expect(settings.getByRole('alert')).toContainText('Close your terminal tabs and restart Coloride');
  await pendingKey.fill('draft-not-a-real-key');
  await expect(pendingKey).toHaveValue('draft-not-a-real-key');
  expect(providerWrites).toHaveLength(0);
  await pendingKey.fill('');
  legacyProviderResponse=false;
  await expect(settings.getByRole('alert')).toHaveCount(0,{timeout:10000});
  await expect(settings.getByRole('button',{name:'Model provider',exact:true})).toHaveCount(0);
  for(const label of ['OpenAI','Gemini','xAI','DeepSeek']) await expect(settings.getByRole('group',{name:label+' configuration',exact:true})).toBeAttached();
  await expect(settings.getByRole('textbox',{name:'OpenAI model',exact:true})).toHaveCount(0);
  await expect(settings.getByRole('button',{name:/^(Save|Use) /})).toHaveCount(0);
  const key=settings.getByLabel('OpenAI API key',{exact:true});
  const geminiKey=settings.getByLabel('Gemini API key',{exact:true});
  await expect(key).toHaveAttribute('type','password');
  await key.fill(' '+fakeKey+' ');
  await expect(settings.getByRole('alert')).toContainText('Retrying automatically');
  await expect(settings.getByRole('alert')).not.toContainText(fakeKey);
  await expect(key).toHaveValue(' '+fakeKey+' ');
  // Editing only restarts the debounce; no submit or provider selection.
  await key.fill(fakeKey);
  await settings.getByRole('group',{name:'OpenAI configuration',exact:true}).getByRole('button',{name:'Change API key',exact:true}).click();
  await expect(key).toHaveValue('');
  await expect(settings.getByLabel('OpenAI available models')).toContainText('GPT-6.1 Sol');
  expect(providerWrites[1]).toEqual({provider:'openai',apiKey:fakeKey});
  expect(providerFixture.provider).toBe('openai');
  await expect(page.locator('textarea.agent-composer-input').first()).toHaveAttribute('placeholder','Ask Coloride…');
  await geminiKey.evaluate((input,value)=>{ const clipboardData=new DataTransfer(); clipboardData.setData('text/plain',value); input.dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true})); },secondKey);
  await settings.getByRole('group',{name:'Gemini configuration',exact:true}).getByRole('button',{name:'Change API key',exact:true}).click();
  await expect(geminiKey).toHaveValue('');
  await expect(settings.getByLabel('Gemini available models')).toContainText('Gemini 4 Argon');
  expect(providerFixture.provider).toBe('openai');
  await page.locator('.agent-composer-model-trigger').first().click();
  await page.getByRole('menuitem',{name:'GPT-6.1 Sol',exact:true}).click();
  for(const label of ['GPT-6.1 Sol','GPT-5.3 Codex','Gemini 4 Argon']) await expect(page.getByRole('menuitemradio',{name:label,exact:true})).toBeVisible();
  await expect(page.getByRole('menuitemradio',{name:'Grok 4.7',exact:true})).toHaveCount(0);
  await expect(page.getByRole('menuitemradio',{name:'Kimi K3',exact:true})).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  expect(await settings.evaluate(()=>Object.values(localStorage).join('\n').includes('test-settings-key-not-a-real-secret'))).toBe(false);
  await category('General').click();
  await category('LLM Providers').click();
  await expect(settings.getByLabel('OpenAI available models')).toContainText('GPT-6.1 Sol');
  await expect(settings.getByLabel('Gemini available models')).toContainText('Gemini 4 Argon');
  await settings.getByRole('group',{name:'OpenAI configuration',exact:true}).getByRole('button',{name:'Change API key',exact:true}).click();
  await settings.getByRole('group',{name:'Gemini configuration',exact:true}).getByRole('button',{name:'Change API key',exact:true}).click();
  await expect(key).toHaveValue('');
  await expect(geminiKey).toHaveValue('');
  await key.scrollIntoViewIfNeeded();
  await settings.screenshot({path:join(output,'settings-provider-light.png')});
  await settings.getByRole('button',{name:'Add provider',exact:true}).click();
  await settings.getByLabel('Provider name',{exact:true}).fill('Local Test');
  await settings.getByLabel('Provider API endpoint',{exact:true}).fill('http://127.0.0.1:11434/v1');
  await settings.getByRole('switch',{name:'API key required',exact:true}).click();
  await settings.getByRole('button',{name:'Add provider',exact:true}).click();
  const localModels=settings.getByLabel('Local Test available models',{exact:true});
  await expect(localModels).toContainText('small-local · Ask only');
  await settings.locator('.settings-subnav').getByRole('button',{name:'Local Test',exact:true}).click();
  await expect(settings.getByRole('group',{name:'Local Test configuration',exact:true})).toBeInViewport();
  await expect(settings.getByLabel('Local Test API key',{exact:true})).toBeDisabled();
  expect(providerWrites.some(body=>body.provider==='custom:local-test' && !body.apiKey)).toBe(true);
  expect(providerFixture.provider).toBe('openai');
  await settings.screenshot({path:join(output,'settings-custom-provider.png')});
  const search=settings.getByRole('textbox',{name:'Search settings'});
  await (await app.browserWindow(settings)).evaluate(win=>win.focus());
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
  await page.evaluate(()=>window.colorideDesktop.openSettings('terminal'));
  await expect(settings.getByRole('region',{name:'Terminal settings',exact:true})).toBeVisible();
  await category('Appearance').click();
  await settings.getByRole('radio',{name:'Dark theme',exact:true}).click();
  await expect(page.locator('body')).toHaveAttribute('data-theme','dark');
  await settings.screenshot({path:join(output,'settings-appearance-dark.png')});
  await settings.getByRole('radio',{name:'System theme',exact:true}).click();
  await expect(settings.getByRole('radio',{name:'System theme',exact:true})).toHaveAttribute('aria-checked','true');
  await settings.screenshot({path:join(output,'settings-appearance-system.png')});
  await settings.getByRole('radio',{name:'Dark theme',exact:true}).click();
  await category('LLM Providers').click();
  await expect(settings.getByRole('group',{name:'OpenAI configuration',exact:true})).toBeVisible();
  await expect(settings.getByRole('button',{name:/^(Save|Use) /})).toHaveCount(0);
  await settings.screenshot({path:join(output,'settings-provider-dark.png')});
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
  console.log('PASS: Independent Settings window, automatic API setup with mocked keys, protected replacements, discovered composer models and live agent readiness, search, themes, native close and preserved editor/shell.');
} catch (error) {
  console.error('Electron exit:',app?.process().exitCode,app?.process().signalCode);
  console.error(launchLog.join('').split('\n').filter(line=>/\[sidecar\]|\[Electron\]|Error|ERR_|\[quit\]/.test(line)).join('\n'));
  if (settings && !settings.isClosed()) {
    await settings.screenshot({path:join(output,'failure-settings.png')}).catch(()=>{});
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
