import {test, expect, _electron, type ElectronApplication} from "@playwright/test";
import {spawn, type ChildProcess} from "node:child_process";
import {mkdtemp, mkdir, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {createRequire} from "node:module";
import {createServer} from "node:net";
const require = createRequire(import.meta.url);
const {resolveTestPython} = require("../support/python.cjs");
const root = resolve(import.meta.dirname, "../../..");
let sandbox: string, host: ChildProcess, vite: ChildProcess, runtime: any, port: number, app: ElectronApplication;
const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
async function wait(check: () => Promise<boolean>) {
  const end = Date.now() + 30000;
  while(Date.now() < end) { if(await check()) return; await new Promise(r => setTimeout(r, 100)); }
  throw new Error("Timed out waiting for isolated terminal fixture");
}
async function invoke(name: string, args = {}) {
  const response = await fetch(`http://${runtime.host}:${runtime.port}/test/terminal-tool`, {method: "POST",
    headers: {Authorization: `Bearer ${runtime.token}`, "Content-Type": "application/json"}, body: JSON.stringify({name, arguments: args})});
  expect(response.ok, await response.clone().text()).toBe(true);
  return response.json();
}
test.beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "coloride-agent-terminals-"));
  await mkdir(join(sandbox, "home"));
  host = spawn(resolveTestPython(), [join(root, "tests/electron/support/agent-terminal-host.py")], {
    cwd: root, env: {...env, HOME: join(sandbox, "home"), PYTHONPATH: join(root, "core/ide-host/src"),
      COLORIDE_TEST_PROJECT: sandbox, COLORIDE_TEST_LAUNCH: join(sandbox, "runtime.json"),
      COLORIDE_TERMINAL_STATE_DIR: join(sandbox, "sessions"), COLORIDE_MANAGED_LLM: "0", SHELL: "/bin/zsh"}, stdio: ["ignore", "ignore", "pipe"]});
  host.stderr?.on("data", chunk => process.stderr.write(chunk));
  await wait(async () => {try {runtime = JSON.parse(await readFile(join(sandbox,"runtime.json"), "utf8")); return true;} catch{return false;}});
  await wait(async () => {try {return (await fetch(`http://${runtime.host}:${runtime.port}/api/health`, {headers: {Authorization: `Bearer ${runtime.token}`}})).ok;} catch{return false;}});
  port = await new Promise<number>(res => {const s=createServer(); s.listen(0,"127.0.0.1",()=>{const p=(s.address() as any).port;s.close(()=>res(p));});});
  vite = spawn(process.execPath,[join(root,"client/ide/node_modules/vite/bin/vite.js"),"--host","127.0.0.1","--port",String(port),"--strictPort"], {cwd:join(root,"client/ide"),env,stdio:"ignore"});
  await wait(async()=>{try{return (await fetch(`http://127.0.0.1:${port}/tests/agent-terminals.html`)).ok;}catch{return false;}});
});
test.afterAll(async()=>{
  await app?.close().catch(()=>{});
  if(runtime) {
    const response=await fetch(`http://${runtime.host}:${runtime.port}/api/term`,{headers:{Authorization:`Bearer ${runtime.token}`}});
    for(const t of await response.json()) await fetch(`http://${runtime.host}:${runtime.port}/api/term/${t.termId}/close`,{method:"POST",headers:{Authorization:`Bearer ${runtime.token}`}});
  }
  host?.kill("SIGTERM");vite?.kill("SIGTERM");
  if(sandbox) await rm(sandbox,{recursive:true,force:true});
});
test("agent creates native tabs, streams commands and recovers without duplicate PTYs",async()=>{
  app=await _electron.launch({executablePath:require("electron"), args:[join(root,"tests/electron/support/electron-main.cjs")],env:{...env,
    COLORIDE_TEST_USER_DATA:join(sandbox,"electron"),COLORIDE_TEST_CONFIG:JSON.stringify(runtime),
    COLORIDE_TEST_URL:`http://127.0.0.1:${port}/tests/agent-terminals.html?cwd=${encodeURIComponent(sandbox)}&session=${runtime.agentSessionId}`}});
  const page=await app.firstWindow();
  await (await app.browserWindow(page)).evaluate(win=>win.showInactive());
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await expect.poll(async()=>page.evaluate(()=>document.querySelector(".agent-view")!==null)).toBe(true);
  // Wait for the event subscription, rather than relying on a startup timeout.
  await expect.poll(async()=>invoke("list_terminals").then(r=>r.terminals.length)).toBe(0);
  const first=await invoke("create_terminal",{cwd:sandbox,title:"Agent checks"});
  // Recovery also handles a create arriving before the websocket subscription.
  await page.reload();
  await expect(page.getByText("Agent checks",{exact:true})).toBeVisible();
  await expect(page.locator("[data-terminal-status=ready]")).toHaveCount(1);
  await expect.poll(async()=>invoke("list_terminals").then(r=>r.terminals.length)).toBe(1);
  await invoke("run_terminal_command",{terminal_id:first.termId,command:"printf 'AGENT_%s\\n' VISIBLE"});
  await expect.poll(async()=>invoke("read_terminal",{terminal_id:first.termId,lines:100}).then(r=>r.output)).toContain("AGENT_VISIBLE");

  await expect(page.locator(".xterm-rows")).toContainText("AGENT_VISIBLE");
  const snapshot=await invoke("read_terminal",{terminal_id:first.termId,lines:100});
  expect(snapshot.output).toContain("AGENT_VISIBLE");
  const second=await invoke("create_terminal",{cwd:sandbox,title:"Agent server"});
  await expect(page.getByText("Agent server",{exact:true})).toBeVisible();
  await expect.poll(async()=>invoke("list_terminals").then(r=>r.terminals.length)).toBe(2);
  await invoke("run_terminal_command",{terminal_id:first.termId,command:"printf 'REUSED_%s\\n' TERMINAL"});
  await expect(page.locator(".xterm-rows").filter({visible:true})).toContainText("REUSED_TERMINAL");
  await page.reload();
  await expect(page.getByText("Agent checks",{exact:true})).toBeVisible();
  await expect(page.getByText("Agent server",{exact:true})).toBeVisible();
  await expect.poll(async()=>invoke("list_terminals").then(r=>r.terminals.length)).toBe(2);
  await page.getByRole("button", {name: "Open Agent checks", exact: true}).click();
  await expect(page.locator(".xterm-rows").filter({visible:true})).toContainText("REUSED_TERMINAL");
  const hidden=await invoke("start_process",{command:"printf 'CHAT_PROCESS_READY\\n'; sleep 30",cwd:"."});
  await expect.poll(async()=>invoke("list_terminals").then(r=>r.terminals.length)).toBe(3);
  await expect(page.getByText("printf 'CHAT_PROCESS_READY\\n'; sleep 30",{exact:true})).toHaveCount(0);
  await page.evaluate(metadata=>window.dispatchEvent(new CustomEvent("show-agent-process",{detail:metadata})),hidden);
  const openProcess=page.getByRole("button",{name:/Open .* in terminal/});
  await expect(openProcess).toBeVisible();
  await openProcess.click();
  await expect(page.getByText("printf 'CHAT_PROCESS_READY\\n'; sleep 30",{exact:true})).toBeVisible();
  await expect(page.locator(".xterm-rows").filter({visible:true})).toContainText("CHAT_PROCESS_READY");
  await page.screenshot({path:join(root,"artifacts/terminal-smoke/agent-terminals-dark.png")});
  await page.evaluate(()=>{document.documentElement.dataset.theme="light";document.body.dataset.theme="light";});
  await page.getByRole("button", {name: "Open Agent checks", exact: true}).click();
  const activeTab = page.locator('.agent-workspace-tab[title="Agent checks"]');
  await expect(activeTab).toHaveAttribute("data-active", "true");
  await expect(activeTab).toHaveCSS("color", "rgb(24, 24, 27)");
  await page.screenshot({path:join(root,"artifacts/terminal-smoke/agent-terminals-light.png")});
  expect(errors).toEqual([]);
  expect(second.termId).not.toBe(first.termId);
});
