/**
 * App.tsx — the UI shell. v1 slice state: indexing + drop-a-track → 5 mixable
 * matches with reasons. Next ⭐ items: crate export, then the eval harness.
 */
import { useEffect, useState, type DragEvent } from 'react'
import type { CrateMateApi, FindSimilarResult, IndexProgress, LibraryStats } from '../../../shared/ipc'

// `window.cratemate` is injected by the preload script (see src/preload/).
declare global {
  interface Window {
    cratemate: CrateMateApi
  }
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

function trackLabel(t: { artist: string | null; title: string | null; filename: string }): string {
  return t.artist && t.title ? `${t.artist} — ${t.title}` : (t.title ?? t.filename)
}

export default function App() {
  const [stats, setStats] = useState<LibraryStats | null>(null)
  const [progress, setProgress] = useState<IndexProgress | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [finding, setFinding] = useState<string | null>(null) // filename being analyzed
  const [result, setResult] = useState<FindSimilarResult | null>(null)
  const [findError, setFindError] = useState<string | null>(null)
  const [exportMsg, setExportMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const indexing = progress !== null && (progress.phase === 'scanning' || progress.phase === 'analyzing')
  const refreshStats = () => window.cratemate.libraryStats().then(setStats)

  useEffect(() => {
    refreshStats()
    return window.cratemate.onIndexProgress((p) => {
      setProgress(p)
      if (p.phase === 'done') refreshStats()
    })
  }, [])

  const pickAndIndex = async () => {
    const folder = await window.cratemate.chooseFolder()
    if (!folder) return
    const res = await window.cratemate.startIndex(folder)
    if (!res.started) setProgress({ phase: 'error', message: res.reason, done: 0, total: 0, skipped: 0, errors: 0, elapsedMs: 0 })
  }

  const onDrop = async (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    setFindError(null)
    setResult(null)
    setExportMsg(null)
    setFinding(file.name)
    try {
      const path = window.cratemate.getFilePath(file)
      setResult(await window.cratemate.findSimilar(path))
      refreshStats() // the dropped file may have just been added to the index
    } catch (err) {
      setFindError(err instanceof Error ? err.message.replace(/^.*Error: /, '') : String(err))
    } finally {
      setFinding(null)
    }
  }

  // Crate = query track first, then the 5 matches in rank order — the set
  // a DJ would actually open in Serato and play top to bottom.
  const exportCrate = async () => {
    if (!result) return
    setExportMsg(null)
    const paths = [result.query.path, ...result.matches.map((m) => m.path)]
    const name = `CrateMate - ${trackLabel(result.query)}`
    const res = await window.cratemate.exportCrate(paths, name)
    if (res.saved) setExportMsg({ ok: true, text: `saved ${res.cratePath} (+ .m3u8) — in Serato: Files panel → drag the .crate into the crates column` })
    else if (res.reason) setExportMsg({ ok: false, text: res.reason })
    // cancelled dialog → stay silent
  }

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      {/* header: brand + library stats + index button */}
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-3">
        <h1 className="text-lg font-bold tracking-tight">
          Crate<span className="text-amber-400">Mate</span>
        </h1>
        <div className="flex items-center gap-4">
          {stats && (
            <span className="text-xs text-zinc-500">
              {stats.tracks.toLocaleString()} tracks · {stats.withSeratoBpmKey.toLocaleString()} Serato-tagged
            </span>
          )}
          <button
            onClick={pickAndIndex}
            disabled={indexing}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-amber-400 hover:text-amber-400 disabled:opacity-40"
          >
            {indexing ? 'Indexing…' : 'Index folder'}
          </button>
        </div>
      </header>

      {/* indexing progress strip */}
      {indexing && progress && (
        <div className="border-b border-zinc-800 px-6 py-2">
          <div className="mb-1 flex justify-between text-xs text-zinc-400">
            <span>
              {progress.phase === 'scanning' ? 'scanning…' : `analyzing ${progress.done}/${progress.total}`}
              {progress.skipped > 0 && ` · ${progress.skipped} already indexed`}
              {progress.errors > 0 && ` · ${progress.errors} failed`}
            </span>
            <span>{fmtDuration(progress.elapsedMs)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full bg-amber-400 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {progress?.phase === 'error' && (
        <p className="border-b border-zinc-800 px-6 py-2 text-xs text-red-400">✗ {progress.message}</p>
      )}

      <main className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
        {/* drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`flex min-h-28 flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition
            ${dragOver ? 'border-amber-400 bg-amber-400/5' : 'border-zinc-700'}`}
        >
          {finding ? (
            <>
              <p className="text-sm text-amber-400">analyzing {finding}…</p>
              <p className="mt-1 text-xs text-zinc-500">first time seeing this file — takes a few seconds</p>
            </>
          ) : (
            <>
              <p className="text-base font-medium">Drop a track here</p>
              <p className="mt-1 text-xs text-zinc-500">get the 5 most mixable tracks from your library — with the reasons why</p>
            </>
          )}
        </div>

        {findError && <p className="text-sm text-red-400">✗ {findError}</p>}

        {/* results */}
        {result && (
          <div>
            <div className="mb-3 flex items-center justify-between gap-4">
              <p className="min-w-0 truncate text-sm text-zinc-400">
                mixes with <span className="font-semibold text-zinc-100">{trackLabel(result.query)}</span>
                {result.query.bpm && <span className="ml-2 text-zinc-500">{Math.round(result.query.bpm)} BPM · {result.query.camelot}</span>}
              </p>
              <button
                onClick={exportCrate}
                className="shrink-0 rounded-md bg-amber-400 px-3 py-1.5 text-xs font-semibold text-zinc-950 transition hover:bg-amber-300"
              >
                Export Serato crate
              </button>
            </div>
            {exportMsg && (
              <p className={`mb-3 text-xs ${exportMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                {exportMsg.ok ? '✓' : '✗'} {exportMsg.text}
              </p>
            )}
            <ol className="space-y-2">
              {result.matches.map((m, i) => (
                <li key={m.id} className="flex items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3">
                  <span className="w-5 text-right font-mono text-sm text-zinc-500">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{trackLabel(m)}</p>
                    <p className="truncate text-xs text-zinc-500">
                      {m.bpm && `${Math.round(m.bpm)} BPM`} {m.camelot && `· ${m.camelot}`}
                      {m.bpmKeySource === 'serato' && ' · serato-tagged'}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                    {m.reasons.map((r) => (
                      <span key={r} className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs text-amber-300/90">{r}</span>
                    ))}
                  </div>
                  <span className="w-12 text-right font-mono text-sm text-zinc-400">{Math.round(m.score * 100)}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* empty state */}
        {!result && !finding && stats && stats.tracks === 0 && (
          <p className="text-center text-sm text-zinc-500">
            Index a folder first (top right) — then drop any MP3 above.
          </p>
        )}
      </main>
    </div>
  )
}
