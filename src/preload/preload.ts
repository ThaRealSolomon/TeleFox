import { contextBridge, ipcRenderer } from 'electron'
const invokes = ['init', 'tab:new', 'tab:close', 'tab:switch', 'tab:nav', 'tab:back', 'tab:forward', 'tab:reload', 'overlay', 'data:clear',
  'clipboard:read', 'proxy:preview', 'proxy:commit', 'proxy:list', 'proxy:best', 'proxy:test', 'proxy:cancel', 'proxy:delete', 'proxy:use', 'proxy:auto', 'proxy:export', 'proxy:copy', 'settings:set', 'state:get']
const events = ['tabs', 'state', 'import-link', 'focus-addr']
contextBridge.exposeInMainWorld('tf', {
  invoke: (c: string, ...a: unknown[]) => (invokes.includes(c) ? ipcRenderer.invoke(c, ...a) : Promise.reject(new Error('blocked'))),
  on: (c: string, f: (d: any) => void) => { if (events.includes(c)) ipcRenderer.on(c, (_e, d) => f(d)) }
})
