import { spawn } from 'node:child_process'
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const { ensureAgentTeamsPlugin, validateAgentTeamsArtifactRoot } = require('../electron/bridge/agent-teams-plugin-service.cjs')
const { resolveDshBin } = require('../electron/bridge/dsh-resolver.cjs')
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function stopChild(child, exitPromise, timeoutMs = 5_000) {
  if (!child || child.exitCode !== null) return
  child.kill()
  const exited = await Promise.race([exitPromise || new Promise(resolve => child.once('exit', resolve)), wait(timeoutMs).then(() => false)])
  if (exited === false && child.exitCode === null) {
    child.kill('SIGKILL')
    await Promise.race([exitPromise || new Promise(resolve => child.once('exit', resolve)), wait(2_000)])
  }
}

async function seedPausedTeam(dshHome, installedRoot, sessionId) {
  await access(path.join(installedRoot, 'lib', 'index.js'))
  const timestamp = new Date().toISOString()
  const objective = 'Verify installed Stop and Resume preview controls'
  const teamId = randomUUID()
  const planHash = createHash('sha256').update(JSON.stringify({ objective, tasks: [] })).digest('hex')
  const document = {
    version: 6,
    settings: { enabled: true, maxMembers: 4, maxActiveTurns: 2 },
    teams: [{
      id: teamId, rootLeadSessionId: sessionId, name: objective, objective, state: 'paused', pauseEpoch: 1,
      ownershipHistory: [], createdAt: timestamp, updatedAt: timestamp,
      members: [{ id: `lead:${sessionId}`, sessionId, name: 'Lead', role: 'root lead and coordinator', kind: 'lead', state: 'running', createdAt: timestamp, updatedAt: timestamp }],
      tasks: [], messages: [], plan: { phase: 'draft', revision: 1, hash: planHash, migrationState: 'ready' }
    }]
  }
  const storeFile = path.join(dshHome, 'storages', 'agent_teams.json')
  await mkdir(path.dirname(storeFile), { recursive: true })
  await writeFile(storeFile, JSON.stringify(document), 'utf8')
  return { teamId, sessionId }
}

async function materializeArtifactFixture(sourceRoot, temporaryRoot) {
  const fixtureRoot = path.join(temporaryRoot, 'artifact-fixture', 'dsh-agent-teams')
  await cp(path.resolve(sourceRoot), fixtureRoot, { recursive: true })
  await writeFile(path.join(fixtureRoot, '.agent-teams-packaged-artifact-fixture.json'), JSON.stringify({ kind: 'agent-teams-packaged-artifact-fixture', version: 1 }), 'utf8')
  return fixtureRoot
}

async function verifyInstalledAuthorizationFailClosed(installedRoot) {
  const moduleUrl = `${pathToFileURL(path.join(installedRoot, 'lib', 'desktop-authorization-capability.js')).href}?installed-smoke=${Date.now()}`
  const { consumeDesktopAuthorizationCapability } = await import(moduleUrl)
  const env = {}
  const capability = consumeDesktopAuthorizationCapability({ env, timeoutMs: 50 })
  if (capability.available !== false) throw new Error('Installed Host authorization capability did not fail closed without Host environment.')
  await capability.consumeResolveUnknown({}).then(
    () => { throw new Error('Unavailable Host authorization capability unexpectedly authorized a request.') },
    error => { if (error?.code !== 'AGENT_TEAMS_HOST_AUTHORIZATION_UNAVAILABLE') throw error }
  )
  return { bridgePresent: true, defaultFailClosed: true, ciDialogClicked: false, dynamicConfirmationCoveredByReleaseBlockingP1Gate: true }
}

export function parseArguments(argv) {
  const result = { artifactFixture: false, dom: true }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--artifact-root') result.artifactRoot = argv[++index]
    else if (value === '--dsh-home') result.dshHome = argv[++index]
    else if (value === '--artifact-fixture') result.artifactFixture = true
    else if (value === '--skip-dom') result.dom = false
    else throw new Error(`Unknown argument: ${value}`)
  }
  if (!result.artifactRoot) throw new Error('--artifact-root is required')
  return result
}

function inspectUrl(chunk) {
  return String(chunk || '').match(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+(?:\/\?[^\s)]+)?/iu)?.[0]?.replace('localhost', '127.0.0.1') || null
}

async function authenticateRuntimeUrl(url) {
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(1_500) })
  const sessionCookie = response.headers.get('set-cookie')?.split(';', 1)[0]
  if (response.status !== 303 || typeof sessionCookie !== 'string' || sessionCookie.length === 0) throw new Error(`DSH Web authentication bootstrap failed closed with HTTP ${response.status}.`)
  return sessionCookie
}

async function startRuntime(dshHome, timeoutMs = 45_000) {
  const dsh = resolveDshBin()
  if (dsh.source !== 'bundled') throw new Error(`The repository-recognized bundled DSH CLI is required, got ${dsh.source}.`)
  const child = spawn(dsh.command, [...dsh.argsPrefix, 'web', '--port', '0', '--no-open'], {
    cwd: repositoryRoot,
    env: { ...process.env, ...dsh.env, DSH_HOME: dshHome, HARNESS_DESKTOP_MARKETPLACE_PATCH_OWNER: '1' },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let url = null
  let output = ''
  const consume = chunk => {
    output = `${output}${String(chunk)}`.slice(-32_768)
    url ||= inspectUrl(chunk)
  }
  child.stdout.on('data', consume)
  child.stderr.on('data', consume)
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (url) {
      try {
        const sessionCookie = await authenticateRuntimeUrl(url)
        return { child, exitPromise: exited, url, sessionCookie, output: () => output }
      } catch {}
    }
    const ended = await Promise.race([exited, wait(150).then(() => null)])
    if (ended) throw new Error(`DSH Web exited before readiness (${ended.code ?? ended.signal}).\n${output}`)
  }
  await stopChild(child, exited)
  throw new Error(`DSH Web did not expose a local URL within ${timeoutMs}ms.\n${output}`)
}

function trustedHeaders(url, extra = {}) {
  return { Origin: new URL(url).origin, Accept: 'application/json', ...extra }
}

async function readSseEvent(reader, timeoutMs = 8_000) {
  const decoder = new TextDecoder()
  let buffered = ''
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now())
    const result = await Promise.race([reader.read(), wait(remaining).then(() => ({ timeout: true }))])
    if (result.timeout) break
    if (result.done) break
    buffered += decoder.decode(result.value, { stream: true })
    const boundary = buffered.indexOf('\n\n')
    if (boundary >= 0) {
      const block = buffered.slice(0, boundary)
      const data = block.split(/\r?\n/u).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n')
      if (data) return JSON.parse(data)
      buffered = buffered.slice(boundary + 2)
    }
  }
  throw new Error('Timed out waiting for an Agent Teams SSE event.')
}

export async function verifyRuntimeApi(url, workspacePath, sessionId, sessionCookie) {
  if (typeof sessionCookie !== 'string' || sessionCookie.length === 0) throw new Error('DSH runtime API authentication is unavailable.')
  const authenticatedHeaders = extra => trustedHeaders(url, { Cookie: sessionCookie, ...extra })
  const rpc = async (endpoint, request) => {
    const rpcId = `installed-smoke-${randomUUID()}`
    const response = await fetch(new URL(`/api/${endpoint}`, url), {
      method: 'POST',
      headers: authenticatedHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: { args: { request } } })
    })
    const responseText = await response.text()
    let envelope
    try { envelope = JSON.parse(responseText) } catch {
      throw new Error(`DSH ${endpoint} fail-closed: HTTP ${response.status} returned non-JSON: ${responseText.slice(0, 512)}`)
    }
    if (!response.ok) throw new Error(`DSH ${endpoint} fail-closed: HTTP ${response.status}: ${JSON.stringify(envelope)}`)
    if (envelope?.type !== 'server-response' || envelope.rpcId !== rpcId || envelope.result?.ok !== true) throw new Error(`DSH ${endpoint} fail-closed: invalid response envelope: ${JSON.stringify(envelope)}`)
    return envelope.result.value
  }
  const workspace = await rpc('workspace/create', { path: workspacePath })
  const workspaceId = workspace?.workspace?.workspaceId
  if (typeof workspaceId !== 'string' || workspaceId.length === 0 || workspace?.workspace?.path !== workspacePath) throw new Error(`DSH workspace/create fail-closed: unexpected workspace result: ${JSON.stringify(workspace)}`)
  const created = await rpc('session/create', { workspaceId, sessionId })
  if (created?.sessionId !== sessionId) throw new Error(`DSH session/create fail-closed: unexpected session result: ${JSON.stringify(created)}`)
  const title = 'Installed artifact DOM smoke'
  const renamed = await rpc('session/rename', { sessionId, title })
  if (renamed?.title !== title || !Number.isSafeInteger(renamed?.seq) || renamed.seq < 0) throw new Error(`DSH session/rename fail-closed: unexpected rename result: ${JSON.stringify(renamed)}`)
  const prompted = await rpc('session/prompt', { requestId: `installed-smoke-${randomUUID()}`, sessionId, mode: 'queue', content: [{ type: 'text', text: '/help' }] })
  if (prompted?.accepted !== true) throw new Error(`DSH session/prompt fail-closed: unexpected prompt result: ${JSON.stringify(prompted)}`)
  const stateUrl = new URL(`/api/agent-teams/state?sessionId=${encodeURIComponent(sessionId)}`, url)
  const stateResponse = await fetch(stateUrl, { headers: authenticatedHeaders() })
  if (!stateResponse.ok) throw new Error(`Agent Teams /state failed with HTTP ${stateResponse.status}.`)
  const before = await stateResponse.json()
  const eventsResponse = await fetch(new URL(`/api/agent-teams/events?sessionId=${encodeURIComponent(sessionId)}`, url), { headers: authenticatedHeaders() })
  if (!eventsResponse.ok || !String(eventsResponse.headers.get('content-type')).startsWith('text/event-stream')) throw new Error('Agent Teams /events is not a live SSE endpoint.')
  const reader = eventsResponse.body.getReader()
  const initial = await readSseEvent(reader)
  const currentLimit = Number(before.config?.maxMembers ?? before.settings?.maxMembers ?? 4)
  const changedLimit = currentLimit === 4 ? 5 : 4
  const mutation = await fetch(new URL('/api/agent-teams/action', url), {
    method: 'POST',
    headers: authenticatedHeaders({ 'content-type': 'application/json', 'x-harness-agent-teams': '1' }),
    body: JSON.stringify({ action: 'settings', sessionId, maxMembers: changedLimit })
  })
  if (!mutation.ok) throw new Error(`Agent Teams state mutation failed with HTTP ${mutation.status}: ${await mutation.text()}`)
  const changed = await readSseEvent(reader)
  await reader.cancel()
  const observedLimit = Number(changed.config?.maxMembers ?? changed.settings?.maxMembers)
  if (observedLimit !== changedLimit) throw new Error('SSE did not publish the verified Agent Teams state change.')
  return { state: true, sse: true, stateChanged: true, sessionCreated: true, sessionId, localCommandOnly: '/help', modelProviderInvoked: false, initialEnabled: Boolean(initial.config?.enabled ?? initial.settings?.enabled ?? initial.enabled), changedLimit }
}

async function verifyDesktopDom(url, temporaryRoot) {
  const electron = require('electron')
  const harnessFile = path.join(temporaryRoot, 'installed-dom-smoke.cjs')
  const reportFile = path.join(temporaryRoot, 'installed-dom-report.json')
  const harness = `
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const url = ${JSON.stringify(url)}
const out = ${JSON.stringify(reportFile)}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
app.disableHardwareAcceleration()
app.setPath('userData', ${JSON.stringify(path.join(temporaryRoot, 'electron-user-data'))})
async function evaluate(window, source) { return window.webContents.executeJavaScript(source, true) }
async function setViewport(window, width, height) {
  const inspector = window.webContents.debugger
  if (!inspector.isAttached()) inspector.attach('1.3')
  await inspector.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, screenWidth: width, screenHeight: height, deviceScaleFactor: 1, mobile: false })
}
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { sandbox: true, contextIsolation: true } })
  await window.loadURL(url)
  await setViewport(window, 1280, 900)
  await sleep(500)
  await evaluate(window, \`(()=>{const button=[...document.querySelectorAll('button')].find(node=>/^(继续|Continue)$/i.test((node.innerText||'').trim()));button?.click();return !!button})()\`)
  await sleep(500)
  await evaluate(window, \`(()=>{const button=[...document.querySelectorAll('button,a')].find(node=>/^(稍后配置|Configure later|Later)$/i.test((node.innerText||'').trim()));button?.click();return !!button})()\`)
  await sleep(800)
  let ready = false
  for (let attempt = 0; attempt < 80 && !ready; attempt += 1) {
    await evaluate(window, \`(()=>{const rows=[...document.querySelectorAll('[role=treeitem]')];const row=rows.find(node=>/Installed artifact DOM smoke/i.test(node.innerText||''));row?.click();return !!row})()\`)
    await sleep(80)
    await evaluate(window, \`(()=>{const input=document.querySelector('[data-composer-input]');input?.focus();return !!input})()\`)
    await sleep(80)
    await evaluate(window, \`(()=>{const tab=[...document.querySelectorAll('[role=tab],button')].find(node=>/^(代理团队|Agent Teams)$/i.test((node.innerText||'').trim()));tab?.click();return !!tab})()\`)
    await sleep(180)
    await evaluate(window, \`(()=>{const button=[...document.querySelectorAll('button')].find(node=>/查看团队关系|view team relationship|agent directory/i.test((node.innerText||node.getAttribute('aria-label')||'').trim()));button?.click();return !!button})()\`)
    await sleep(120)
    ready = await evaluate(window, \`(()=>{const root=document.querySelector('.dat-workspace');const text=root?.innerText||'';return !!root&&/已由用户停止|stopped by (?:the )?user/i.test(text)&&/生成继续请求|准备继续请求|prepare continue request|resume/i.test(text)})()\`)
  }
  if (!ready) { const debug = await evaluate(window, \`(()=>({body:(document.body.innerText||'').slice(0,4000),rows:[...document.querySelectorAll('[role=treeitem]')].map(n=>(n.innerText||'').trim()),tabs:[...document.querySelectorAll('[role=tab]')].map(n=>(n.innerText||'').trim()),composers:[...document.querySelectorAll('[data-composer-input]')].map(n=>({text:n.innerText||n.textContent||'',html:n.innerHTML})),teamRoots:[...document.querySelectorAll('[class*=dat-]')].map(n=>n.className).slice(0,50)}))()\`); throw new Error('Paused Agent Teams workbench did not render: '+JSON.stringify(debug)) }
  fs.writeFileSync(out, JSON.stringify({ stage: 'paused-workbench-ready' }))
  const baseline = await evaluate(window, \`(()=>{const node=[...document.querySelectorAll('button,[role=button]')].find(node=>/生成继续请求|准备继续请求|prepare continue request|resume/i.test((node.innerText||node.getAttribute('aria-label')||'').trim()));const style=node?getComputedStyle(node):null;return {outlineStyle:style?.outlineStyle,outlineWidth:style?.outlineWidth,outlineColor:style?.outlineColor,boxShadow:style?.boxShadow}})()\`)
  window.show()
  window.focus()
  window.webContents.focus()
  await sleep(100)
  await evaluate(window, \`(()=>{document.activeElement?.blur();return true})()\`)
  let focus
  for (let step = 0; step < 120; step += 1) {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' })
    await sleep(25)
    focus = await evaluate(window, \`(()=>{const node=document.activeElement;const name=(node?.getAttribute('aria-label')||node?.innerText||'').trim();const rect=node?.getBoundingClientRect();const style=node?getComputedStyle(node):null;const visibleColor=value=>!!value&&value!=='transparent'&&!/rgba\\([^)]*,\\s*0(?:\\.0+)?\\s*\\)/i.test(value);const outlineVisible=!!style&&style.outlineStyle!=='none'&&parseFloat(style.outlineWidth)>0&&visibleColor(style.outlineColor);const shadowVisible=!!style&&style.boxShadow!=='none'&&visibleColor(style.boxShadow);const point=rect?[rect.left+rect.width/2,rect.top+rect.height/2]:null;const hitStack=point?document.elementsFromPoint(point[0],point[1]):[];const unobscured=!!node&&hitStack.some(hit=>hit===node||node.contains(hit));return {name,tag:node?.tagName,role:node?.getAttribute('role'),className:node?.className,focused:!!node?.matches?.(':focus'),focusVisible:!!node?.matches?.(':focus-visible'),nativeOrAria:node?.tagName==='BUTTON'||node?.getAttribute('role')==='button',outlineStyle:style?.outlineStyle,outlineWidth:style?.outlineWidth,outlineColor:style?.outlineColor,boxShadow:style?.boxShadow,outlineVisible,shadowVisible,rect:rect&&{left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height},inViewport:!!rect&&rect.left>=0&&rect.top>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight,ring:outlineVisible||shadowVisible,unobscured}})()\`)
    if ((focus?.tag === 'BUTTON' || focus?.role === 'button') && /生成继续请求|准备继续请求|prepare continue request|resume/i.test(focus?.name || '')) break
  }
  if ((focus?.tag !== 'BUTTON' && focus?.role !== 'button') || !/生成继续请求|准备继续请求|prepare continue request|resume/i.test(focus?.name || '')) throw new Error('Tab navigation did not reach the named Resume preview control: ' + JSON.stringify(focus))
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
  window.webContents.sendInputEvent({ type: 'char', keyCode: '\\r' })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const value = await evaluate(window, \`(()=>{const input=document.querySelector('[data-composer-input]');return (input?.innerText||input?.textContent||'').trim()})()\`)
    if (/team_resume|恢复|继续|continue|resume/i.test(value)) break
    await sleep(50)
  }
  const desktop = await evaluate(window, \`(()=>{const root=document.querySelector('.dat-workspace');const text=root?.innerText||'';const buttons=[...root.querySelectorAll('button')];const resume=buttons.filter(node=>/生成继续请求|准备继续请求|prepare continue request|resume/i.test((node.innerText||node.getAttribute('aria-label')||'')));const stop=buttons.filter(node=>/停止团队|stop team/i.test((node.innerText||node.getAttribute('aria-label')||'')));const input=document.querySelector('[data-composer-input]');const inputValue=(input?.innerText||input?.textContent||'').trim();return {viewportSize:[innerWidth,innerHeight],rendered:!!root,paused:/已由用户停止|stopped by (?:the )?user/i.test(text),resumeCount:resume.length,stopCount:stop.length,agentDirectory:/代理目录|agent directory|统一代理目录|unified agent catalog|查看团队关系|view team relationships?/i.test(text),draftNotice:/已放入底部输入框|Added to the composer below/i.test(text),preview:/team_resume|恢复|继续|continue|resume/i.test(inputValue),inputValue}})()\`)
  await setViewport(window, 390, 844)
  await sleep(500)
  const mobile = await evaluate(window, \`(()=>{const root=document.querySelector('.dat-workspace');const rect=root?.getBoundingClientRect();const viewport=document.querySelector('meta[name=viewport]')?.content||'';const targets=[...root.querySelectorAll('button')].filter(node=>/生成继续请求|准备继续请求|prepare continue request|resume|代理目录|agent directory|统一代理目录|unified agent catalog|查看团队关系|view team relationships?/i.test((node.innerText||node.getAttribute('aria-label')||''))).map(node=>{const r=node.getBoundingClientRect();return {name:(node.innerText||node.getAttribute('aria-label')||'').trim(),width:r.width,height:r.height}});return {viewportSize:[innerWidth,innerHeight],viewportMeta:/width=device-width/i.test(viewport),rendered:!!root,visible:!!rect&&rect.width>0&&rect.height>0,noHorizontalOverflow:document.documentElement.scrollWidth<=document.documentElement.clientWidth,touchTargets:targets,touchTargets44:targets.length>0&&targets.every(target=>target.width>=44&&target.height>=44)}})()\`)
  if (window.webContents.debugger.isAttached()) window.webContents.debugger.detach()
  fs.writeFileSync(out, JSON.stringify({ desktop, focusBaseline: baseline, focus, mobile }))
  app.exit(0)
}).catch(error => { try { fs.writeFileSync(out, JSON.stringify({ error: String(error?.stack || error) })) } catch {} app.exit(1) })
`
  await writeFile(harnessFile, harness)
  const electronEnv = { ...process.env }
  delete electronEnv.ELECTRON_RUN_AS_NODE
  const child = spawn(electron, ['--no-sandbox', '--disable-gpu', harnessFile], { env: electronEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  const exitPromise = new Promise(resolve => child.once('exit', code => resolve(code)))
  const exit = await Promise.race([exitPromise, wait(70_000).then(() => 'timeout')])
  if (exit === 'timeout') await stopChild(child, exitPromise)
  const report = JSON.parse(await readFile(reportFile, 'utf8').catch(() => '{}'))
  if (exit === 'timeout' || exit !== 0 || report.error) throw new Error(`Electron DOM smoke failed: ${report.error || `exit=${exit} report=${JSON.stringify(report)} output=${output}`}`)
  if (report.desktop?.viewportSize?.[0] !== 1280 || report.desktop?.viewportSize?.[1] !== 900) throw new Error(`1280x900 Electron desktop-viewport contract failed: ${JSON.stringify(report.desktop)}`)
  if (!report.desktop?.rendered || !report.desktop.paused || report.desktop.resumeCount < 1 || report.desktop.stopCount !== 0 || !report.desktop.agentDirectory || !report.desktop.preview) throw new Error(`Paused/Resume DOM interaction failed: ${JSON.stringify(report.desktop)}`)
  const ringChanged = ['outlineStyle', 'outlineWidth', 'outlineColor', 'boxShadow'].some(field => report.focus?.[field] !== report.focusBaseline?.[field])
  if (!report.focus?.focused || !report.focus.nativeOrAria || !report.focus.name || !report.focus.ring || !ringChanged || !report.focus.inViewport || !report.focus.unobscured) throw new Error(`Keyboard focus contract failed: ${JSON.stringify({ baseline: report.focusBaseline, focused: report.focus, ringChanged })}`)
  if (!report.mobile?.rendered || !report.mobile.visible || !report.mobile.noHorizontalOverflow || !report.mobile.viewportMeta || !report.mobile.touchTargets44 || report.mobile.viewportSize?.[0] !== 390 || report.mobile.viewportSize?.[1] !== 844) throw new Error(`390x844 Electron mobile-viewport contract failed: ${JSON.stringify(report.mobile)}`)
  return { desktop: true, desktopViewport: 'Electron Chromium 1280x900', mobileViewport: 'Electron Chromium 390x844 (not Android/iOS hardware)', keyboardAndAria: true, focusStyleChanged: true, focusedRectInViewport: true, visibleFocusUnobscured: true, touchTargets44: true, stopResumePreview: true, unifiedAgentDirectory: true }
}

export async function runInstalledSmoke(options) {
  const ownsHome = !options.dshHome
  const ownsTemporary = true
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-installed-smoke-'))
  const dshHome = path.resolve(options.dshHome || path.join(temporaryRoot, 'dsh-home'))
  let runtime
  try {
    const artifactRoot = options.artifactFixture === true ? await materializeArtifactFixture(options.artifactRoot, temporaryRoot) : options.artifactRoot
    const artifact = await validateAgentTeamsArtifactRoot(artifactRoot, { allowArtifactFixture: options.artifactFixture === true })
    const installed = await ensureAgentTeamsPlugin({ dshHome, bundledRoot: artifact.source, allowArtifactFixture: options.artifactFixture === true, requireArtifact: true })
    await access(path.join(installed.destination, 'lib', 'desktop-authorization-capability.js'))
    const installedLaunchPath = path.join(installed.destination, 'lib', 'project-session-launch.js')
    await access(installedLaunchPath)
    const installedHost = await readFile(path.join(installed.destination, 'lib', 'index.js'), 'utf8')
    const installedLaunch = await readFile(installedLaunchPath, 'utf8')
    if (!installedHost.includes('name: "project_session_launch"') || !installedHost.includes('resolveProjectSessionLaunchProvider(ctx)') || !installedHost.includes('runtime.prepareStart(exec') || !installedHost.includes('runtime.activatePreparedBatch(exec') || !installedHost.includes('reserveProjectLaunchSlots(projectEntry') || !installedHost.includes('adoptProjectLaunchSlot(projectSessionLaunch')) throw new Error('Installed Host is missing the two-phase reserve-before-launch project session plane.')
    for (const marker of ['reserveAdoption', 'redeemAdoption', 'DSH_AGENT_TEAMS_SESSION_LAUNCH_CALLER_SALT']) if (!installedLaunch.includes(marker)) throw new Error(`Installed project session launch provider is missing the private adoption marker: ${marker}`)
    const installedClient = await readFile(path.join(installed.destination, 'lib', 'client.js'), 'utf8')
    for (const marker of ['代理目录', '已由用户停止', '生成继续请求', 'aria-live', 'tabIndex']) {
      if (!installedClient.includes(marker)) throw new Error(`Installed client is missing the required workbench contract marker: ${marker}`)
    }
    const patch = await readFile(path.join(dshHome, 'profiles', 'web', 'cordis.patch.yml'), 'utf8')
    if (!patch.includes('dsh-agent-teams')) throw new Error('Installed Web profile does not register dsh-agent-teams.')
    const sessionId = 'installed-artifact-smoke-session'
    const seeded = await seedPausedTeam(dshHome, installed.destination, sessionId)
    const hostResolveUnknown = await verifyInstalledAuthorizationFailClosed(installed.destination)
    runtime = await startRuntime(dshHome)
    const api = await verifyRuntimeApi(runtime.url, temporaryRoot, sessionId, runtime.sessionCookie)
    const dom = options.dom === false ? { skipped: true } : await verifyDesktopDom(runtime.url, temporaryRoot)
    return { ok: true, artifactKind: artifact.kind, installedDestination: installed.destination, freshProfile: ownsHome, profileCreatedByVerifier: ownsHome, runtimeEntry: 'repository-recognized @deepseek-ai/dsh web CLI', runtimeUrl: runtime.url, seededPausedTeamId: seeded.teamId, api, dom, hostResolveUnknown }
  } finally {
    await stopChild(runtime?.child, runtime?.exitPromise)
    if (ownsHome || ownsTemporary) await rm(temporaryRoot, { recursive: true, force: true }).catch(() => {})
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runInstalledSmoke(parseArguments(process.argv.slice(2))).then(report => {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  }).catch(error => {
    console.error(error?.stack || error)
    process.exitCode = 1
  })
}
