/**
 * preload/index.ts — the security bridge between the UI and the backend.
 *
 * This is the ONLY file that can see both worlds: it runs with access to
 * Electron's ipcRenderer, but in the renderer's context. It exposes a small,
 * frozen, explicitly-typed API as `window.cratemate` — nothing else crosses.
 *
 * Rule of the house: this file stays DUMB. No logic, no validation, no state —
 * just one line per channel forwarding to the main process. Logic lives in
 * main/ (trusted) or renderer/ (untrusted), never in between.
 */
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { IPC, IPC_EVENTS, type CrateMateApi, type IndexProgress } from '../shared/ipc'

const api: CrateMateApi = {
  ping: () => ipcRenderer.invoke(IPC.PING),
  chooseFolder: () => ipcRenderer.invoke(IPC.CHOOSE_FOLDER),
  startIndex: (folder) => ipcRenderer.invoke(IPC.START_INDEX, folder),
  libraryStats: () => ipcRenderer.invoke(IPC.LIBRARY_STATS),
  // webUtils only exists in the preload world — exactly why this line lives here
  getFilePath: (file) => webUtils.getPathForFile(file),
  findSimilar: (p) => ipcRenderer.invoke(IPC.FIND_SIMILAR, p),
  exportCrate: (trackPaths, suggestedName) => ipcRenderer.invoke(IPC.EXPORT_CRATE, trackPaths, suggestedName),
  onIndexProgress: (cb) => {
    const listener = (_e: IpcRendererEvent, p: IndexProgress): void => cb(p)
    ipcRenderer.on(IPC_EVENTS.INDEX_PROGRESS, listener)
    return () => ipcRenderer.removeListener(IPC_EVENTS.INDEX_PROGRESS, listener)
  },
}

contextBridge.exposeInMainWorld('cratemate', api)
