/**
 * main/index.ts — the Electron MAIN process: the app's Node.js backend.
 *
 * Everything privileged lives here (and only here): window management, and —
 * as Phase 1 progresses — the SQLite library index, the audio-analysis worker
 * pool, Serato file readers, and crate export. The React UI never touches any
 * of that directly; it goes through the typed IPC bridge (src/shared/ipc.ts).
 *
 * Security posture (PLAN.md → Security Concerns → Electron hardening):
 *   - renderer is sandboxed, no Node integration, context isolation ON
 *   - navigation and window.open to anywhere are blocked (this app loads
 *     exactly one page; everything else is treated as hostile)
 *   - no `webview`, no remote module, strict typed IPC only
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import { IPC, IPC_EVENTS, type ExportCrateResult, type FindSimilarResult, type LibraryStats, type PingResponse, type StartIndexResult } from '../shared/ipc'
import { getMeta, getStats, getTracksByPaths } from './library/db'
import { analyzeSingleFile, isIndexRunning, runIndex } from './library/indexer'
import { findSimilar } from './library/similar'
import { isInsideSeratoFolder, writeCrateFile, writeM3u8File } from './serato/crate-export'

const startedAt = Date.now()

function createMainWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 560,
    title: 'CrateMate',
    backgroundColor: '#09090b', // matches the UI's zinc-950 — no white flash on load
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true, // renderer gets an isolated JS world
      nodeIntegration: false, // renderer has NO require()/fs/process
      sandbox: true,          // renderer runs in Chromium's OS-level sandbox
      webviewTag: false,      // no embedded browsers
    },
  })

  // Dev: electron-vite serves the renderer with HMR. Prod: load the built file.
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

// ---- IPC handlers (each channel in shared/ipc.ts gets exactly one handler) ----

ipcMain.handle(IPC.PING, (): PingResponse => ({
  ok: true,
  version: app.getVersion(),
  uptimeMs: Date.now() - startedAt,
}))

ipcMain.handle(IPC.CHOOSE_FOLDER, async (): Promise<string | null> => {
  const res = await dialog.showOpenDialog({
    title: 'Choose your music folder',
    defaultPath: path.join(app.getPath('home'), 'Documents', 'dj'),
    properties: ['openDirectory'],
  })
  return res.canceled ? null : res.filePaths[0]
})

ipcMain.handle(IPC.START_INDEX, (event, folder: unknown): StartIndexResult => {
  // Validate everything crossing the bridge — the renderer is untrusted.
  if (typeof folder !== 'string' || !path.isAbsolute(folder)) {
    return { started: false, reason: 'invalid folder path' }
  }
  if (isIndexRunning()) return { started: false, reason: 'an index run is already in progress' }

  const target = event.sender
  // Deliberately not awaited: indexing takes minutes, progress streams as events.
  void runIndex(folder, (p) => {
    if (!target.isDestroyed()) target.send(IPC_EVENTS.INDEX_PROGRESS, p)
  }).catch(() => { /* already surfaced via the 'error' progress event */ })
  return { started: true }
})

ipcMain.handle(IPC.FIND_SIMILAR, async (_event, filePath: unknown): Promise<FindSimilarResult> => {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || !filePath.toLowerCase().endsWith('.mp3')) {
    throw new Error('drop an MP3 file')
  }
  // New/changed file? Analyze it first (~3–6 s), then rank against the library.
  await analyzeSingleFile(filePath)
  return findSimilar(filePath)
})

ipcMain.handle(IPC.EXPORT_CRATE, async (_event, trackPaths: unknown, suggestedName: unknown): Promise<ExportCrateResult> => {
  // Validate everything crossing the bridge — the renderer is untrusted.
  if (!Array.isArray(trackPaths) || trackPaths.length === 0 ||
      !trackPaths.every((p): p is string => typeof p === 'string' && path.isAbsolute(p))) {
    return { saved: false, reason: 'nothing to export' }
  }
  // Only library tracks may be exported — re-resolving through the DB also
  // means the renderer can't make us write arbitrary strings into a playlist.
  const known = getTracksByPaths(trackPaths)
  const tracks = trackPaths.filter((p) => known.has(p))
  if (tracks.length === 0) return { saved: false, reason: 'none of these tracks are in the library index' }

  const safeName = (typeof suggestedName === 'string' ? suggestedName : 'CrateMate export')
    .replace(/[/\\:]+/g, '-').slice(0, 80) // strip path separators from track titles

  const res = await dialog.showSaveDialog({
    title: 'Export Serato crate',
    defaultPath: path.join(app.getPath('home'), 'Documents', `${safeName}.crate`),
    filters: [{ name: 'Serato crate', extensions: ['crate'] }],
  })
  if (res.canceled || !res.filePath) return { saved: false }

  // Belt-and-braces: the writers also enforce this, but fail with a clear
  // message before any temp file is created.
  if (isInsideSeratoFolder(res.filePath)) {
    return { saved: false, reason: 'pick a folder outside _Serato_ — then import the crate from inside Serato (Files → Import)' }
  }

  try {
    const cratePath = res.filePath.endsWith('.crate') ? res.filePath : `${res.filePath}.crate`
    const m3u8Path = cratePath.replace(/\.crate$/, '.m3u8')
    writeCrateFile(cratePath, tracks)
    writeM3u8File(m3u8Path, tracks.map((p) => known.get(p)!))
    return { saved: true, cratePath, m3u8Path }
  } catch (err) {
    return { saved: false, reason: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle(IPC.LIBRARY_STATS, (): LibraryStats => {
  const lastIndexedAt = getMeta('lastIndexedAt')
  return {
    ...getStats(),
    lastIndexedAt: lastIndexedAt ? Number(lastIndexedAt) : null,
    libraryFolder: getMeta('libraryFolder'),
  }
})

// ---- app lifecycle ----

app.whenReady().then(() => {
  // Block ALL navigation + new windows app-wide. If a future feature needs to
  // open a link (e.g. a Spotify result), it must use shell.openExternal with
  // an allowlisted https URL — never navigate the app window itself.
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event) => event.preventDefault())
    contents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://')) shell.openExternal(url)
      return { action: 'deny' }
    })
  })

  createMainWindow()

  // macOS convention: re-create the window when the dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

// macOS convention: app stays alive with no windows; quit everywhere else
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
