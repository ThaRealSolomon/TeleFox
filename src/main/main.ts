import { app, BrowserWindow, WebContentsView, ipcMain, session, shell, Menu, IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import { parseProxy, isProxyUri, isProxyError, normalizeInput } from '../shared/proxy'
import { db, loadDb, initEngine, registerProxyIpc, onProxyFailure, reportOk, startup, flushNow, clearData as clearBrowsing } from './engine'

const dev = process.argv.includes('--dev')
const CHROME_H = 88
let win: BrowserWindow
let ses: Electron.Session
const tabs = new Map<number, WebContentsView>()
let activeTab = 0, nextId = 1, overlay = false
const closed: string[] = []

// ---------- tabs ----------
function emitTabs() {
  win?.webContents.send('tabs', { active: activeTab, list: [...tabs].map(([id, v]) => ({ id, title: v.webContents.getTitle() || v.webContents.getURL() || 'New tab', url: v.webContents.getURL(), loading: v.webContents.isLoading() })) })
}
function layout() {
  const [w, h] = win.getContentSize()
  for (const [id, v] of tabs) { v.setBounds({ x: 0, y: CHROME_H, width: w, height: Math.max(0, h - CHROME_H) }); v.setVisible(id === activeTab && !overlay) }
}
function interceptTg(url: string) {
  if (isProxyUri(url) && parseProxy(url).ok) { win.webContents.send('import-link', url); return true }
  return /^tg:/i.test(url)
}
function newTab(url?: string) {
  const v = new WebContentsView({ webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } })
  const id = nextId++, wc = v.webContents
  tabs.set(id, v); win.contentView.addChildView(v)
  wc.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) newTab(url); else interceptTg(url); return { action: 'deny' } })
  wc.on('will-navigate', (e, url) => { if (!/^(https?|file|about):/i.test(url)) { e.preventDefault(); if (!interceptTg(url) && /^(mailto|tel):/i.test(url)) shell.openExternal(url) } })
  for (const ev of ['did-start-loading', 'did-stop-loading', 'page-title-updated', 'did-navigate', 'did-navigate-in-page'] as const) wc.on(ev as any, emitTabs)
  wc.on('did-fail-load', (_e, code, _d, _u, main) => { if (main && isProxyError(code)) onProxyFailure() })
  wc.on('did-finish-load', reportOk)
  wc.on('render-process-gone', () => { wc.loadURL('about:blank') })
  if (dev) wc.on('before-input-event', (_e, i) => { if (i.key === 'F12' && i.type === 'keyDown') wc.toggleDevTools() })
  switchTab(id); wc.loadURL(normalizeInput(url ?? db.homepage))
  return id
}
function switchTab(id: number) { if (tabs.has(id)) { activeTab = id; layout(); emitTabs() } }
function closeTab(id: number) {
  const v = tabs.get(id); if (!v) return
  const u = v.webContents.getURL(); if (/^https?:/.test(u)) closed.push(u)
  win.contentView.removeChildView(v); tabs.delete(id); v.webContents.close()
  if (!tabs.size) newTab(); else if (id === activeTab) switchTab([...tabs.keys()].pop()!)
  emitTabs()
}
const cur = () => tabs.get(activeTab)?.webContents
const cycle = (d: number) => { const k = [...tabs.keys()]; switchTab(k[(k.indexOf(activeTab) + d + k.length) % k.length]) }

// ---------- IPC ----------
const str = (v: unknown, max = 4096) => { if (typeof v !== 'string' || v.length > max) throw new Error('bad input'); return v }
function h(ch: string, fn: (...a: any[]) => unknown) {
  ipcMain.handle(ch, async (e: IpcMainInvokeEvent, ...a) => {
    if (e.sender !== win.webContents) return { ok: false, error: 'Denied' }
    try { return await fn(...a) } catch (er) { if (dev) console.error(ch, (er as Error).message); return { ok: false, error: 'Request failed' } }
  })
}
const clearData = clearBrowsing
function setupIpc() {
  h('init', async () => { if (!tabs.size) { await startup(); newTab() } return { ok: true } })
  h('tab:new', (u?: unknown) => newTab(u === undefined ? undefined : str(u)))
  h('tab:close', (id: number) => closeTab(Number(id)))
  h('tab:switch', (id: number) => switchTab(Number(id)))
  h('tab:nav', (s: unknown) => { cur()?.loadURL(normalizeInput(str(s, 2048))) })
  h('tab:back', () => cur()?.navigationHistory.goBack())
  h('tab:forward', () => cur()?.navigationHistory.goForward())
  h('tab:reload', () => { const w = cur(); if (w) (w.isLoading() ? w.stop() : w.reload()) })
  h('overlay', (v: unknown) => { overlay = v === true; layout() })
  h('data:clear', async () => { await clearData(); return { ok: true } })
}

function createWindow() {
  win = new BrowserWindow({ width: 1280, height: 800, minWidth: 700, minHeight: 480, backgroundColor: '#14141a', title: 'TeleFox',
    webPreferences: { preload: path.join(__dirname, '../preload/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } })
  win.setMenuBarVisibility(false)
  win.on('resize', layout)
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  if (dev) { win.loadURL('http://localhost:5173'); win.webContents.openDevTools({ mode: 'detach' }) }
  else win.loadFile(path.join(__dirname, '../../renderer/index.html'))
}

app.whenReady().then(() => {
  loadDb(); ses = session.fromPartition('persist:telefox')
  initEngine(ses, () => win)
  ses.setPermissionRequestHandler((_w, _p, cb) => cb(false))
  setupIpc(); registerProxyIpc(h); createWindow()
  const go = (fn: () => void) => ({ click: fn })
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'Browser', submenu: [
    { label: 'New Tab', accelerator: 'CmdOrCtrl+T', ...go(() => newTab()) },
    { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', ...go(() => closeTab(activeTab)) },
    { label: 'Reopen Tab', accelerator: 'CmdOrCtrl+Shift+T', ...go(() => { const u = closed.pop(); if (u) newTab(u) }) },
    { label: 'Address Bar', accelerator: 'CmdOrCtrl+L', ...go(() => win.webContents.send('focus-addr')) },
    { label: 'Reload', accelerator: 'CmdOrCtrl+R', ...go(() => cur()?.reload()) },
    { label: 'Reload (F5)', accelerator: 'F5', ...go(() => cur()?.reload()) },
    { label: 'Back', accelerator: 'Alt+Left', ...go(() => cur()?.navigationHistory.goBack()) },
    { label: 'Forward', accelerator: 'Alt+Right', ...go(() => cur()?.navigationHistory.goForward()) },
    { label: 'Next Tab', accelerator: 'Ctrl+Tab', ...go(() => cycle(1)) },
    { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', ...go(() => cycle(-1)) },
    { label: 'Clear Browsing Data', accelerator: 'CmdOrCtrl+Shift+Delete', ...go(() => void clearData()) },
    { label: 'Developer Tools', accelerator: 'F12', visible: dev, ...go(() => cur()?.toggleDevTools()) }
  ] }]))
})
app.on('before-quit', flushNow)
app.on('window-all-closed', () => app.quit())
