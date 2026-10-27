import { test, expect, _electron, type ElectronApplication } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '../../..');

test('editor loading preserves the minimap and selection; preference changes still apply', async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'coloride-editor-options-'));
  const server = createServer();
  const port = await new Promise<number>(done => server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture port');
    server.close(() => done(address.port));
  }));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  let vite: ChildProcess | undefined, app: ElectronApplication | undefined;
  try {
    vite = spawn(process.execPath, [join(root, 'client/ide/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
      { cwd: join(root, 'client/ide'), env, stdio: 'ignore' });
    const base = `http://127.0.0.1:${port}`;
    await expect.poll(async () => { try { return (await fetch(`${base}/@vite/client`)).ok; } catch { return false; } }).toBe(true);
    app = await _electron.launch({ executablePath: require('electron'), args: [join(root, 'tests/electron/support/electron-main.cjs')],
      env: { ...env, COLORIDE_TEST_USER_DATA: join(sandbox, 'data'), COLORIDE_TEST_URL: 'about:blank', COLORIDE_TEST_CONFIG: '{}' } });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    // A same-origin fixture loads the actual editor engine; no host or provider mocks.
    await page.route(`${base}/tests/editor-options.html`, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body>
      <div id="editor" style="height:500px;width:800px"></div><script type="module">
      import {createCodeMirrorEditor} from '/src/features/editor/hosts/codemirror/index.ts';
      import {mapEditorPreferences} from '/src/features/editor/core/index.ts';
      import {defaultAppPreferences} from '/src/features/settings/preferences.ts';
      let options=mapEditorPreferences(defaultAppPreferences,{readOnly:false}), theme='dark';
      const doc=Array.from({length:300},(_,i)=>'Fixture line '+i).join('\\n');
      const host=createCodeMirrorEditor({parent:document.querySelector('#editor'),path:'/fixture/sample.txt',doc,language:'plaintext',theme,options});
      window.editorFixture={host,doc,patch(next,nextTheme=theme){options={...options,...next};theme=nextTheme;host.setTheme(theme,options);}};
      </script></body></html>` }));
    await page.goto(`${base}/tests/editor-options.html`);
    const editor = page.locator('.cm-content');
    await expect(editor).toContainText('Fixture line 0');
    const minimap = page.locator('.coloride-minimap');
    await expect(minimap).toBeVisible();
    await minimap.evaluate(element => { element.dataset.identity = 'original'; });
    await page.evaluate(() => {
      const fixture = (window as any).editorFixture;
      fixture.host.view.dispatch({ selection: { anchor: 3, head: 8 } });
      fixture.patch({ readOnly: true });
    });
    await expect(editor).toHaveAttribute('contenteditable', 'false');
    await editor.focus();
    await page.keyboard.insertText('BLOCKED_INPUT');
    expect(await page.evaluate(() => (window as any).editorFixture.host.handle.getValue())).not.toContain('BLOCKED_INPUT');
    await page.evaluate(() => (window as any).editorFixture.patch({ readOnly: false }));
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    await expect(minimap).toHaveAttribute('data-identity', 'original');
    expect(await page.evaluate(() => {
      const selection = (window as any).editorFixture.host.view.state.selection.main;
      return [selection.anchor, selection.head];
    })).toEqual([3, 8]);
    const dark = await page.locator('.cm-editor').evaluate(element => getComputedStyle(element).backgroundColor);
    await page.evaluate(() => (window as any).editorFixture.patch({ fontSize: 20, lineNumbers: 'off', wordWrap: 'on', minimap: false }, 'light'));
    await expect.poll(() => editor.evaluate(element => getComputedStyle(element).fontSize)).toBe('20px');
    await expect.poll(() => page.locator('.cm-editor').evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(dark);
    await expect(page.locator('.cm-lineNumbers')).toHaveCount(0);
    await expect(page.locator('.cm-lineWrapping')).toBeVisible();
    await expect(minimap).toHaveCount(0);
    await page.evaluate(() => (window as any).editorFixture.patch({ minimap: true }));
    await expect(minimap).toBeVisible();
    expect(await page.evaluate(() => (window as any).editorFixture.host.handle.getValue())).toBe(
      await page.evaluate(() => (window as any).editorFixture.doc));
    expect(errors).toEqual([]);
  } finally {
    await app?.close(); vite?.kill('SIGTERM');
    await rm(sandbox, { recursive: true, force: true });
  }
});
