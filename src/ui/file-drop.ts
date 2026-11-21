import { useEffect, useRef, type ClipboardEvent as ReactClipboardEvent } from 'react'

/**
 * Files from the computer the app is opened on, wherever weevilsd runs: pasted (Ctrl/Cmd+V of a screenshot, an image,
 * copied files) or dropped from the desktop onto a thread. Both are plain browser events: they need no clipboard
 * permission and no secure context (navigator.clipboard does, and only weevboss's proactive offer uses it).
 */

/** The files a paste carries; none for plain text, which the field takes natively. */
export function pastedFiles(data: DataTransfer | null): File[] {
  if (!data) return []
  const files = [...(data.files ?? [])]
  if (files.length) return files
  // Some browsers list a pasted image only among the items.
  return [...(data.items ?? [])].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter((f): f is File => !!f)
}

/** Files copied in a file manager reach the page as their addresses only (Linux, some browsers): unreadable from here. */
export function onlyFileAddresses(data: DataTransfer | null): boolean {
  if (!data) return false
  const list = (data.getData('text/uri-list') || data.getData('text/plain') || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  return list.length > 0 && list.every((l) => /^file:\/\//i.test(l))
}

/** A paste handler for a message field: files become attachments, file addresses a hint, text stays native. */
export function pasteHandler(take: (files: File[]) => void, hint: () => void) {
  return (e: ReactClipboardEvent<HTMLElement>) => {
    const files = pastedFiles(e.clipboardData)
    if (files.length) {
      e.preventDefault()
      take(files)
    } else if (onlyFileAddresses(e.clipboardData)) {
      e.preventDefault()
      hint()
    }
  }
}

type Target = { el: () => HTMLElement | null; take: (files: File[]) => void }
const targets: Target[] = []
let lit: HTMLElement | null = null
const carriesFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files')
const shown = (el: HTMLElement) => el.isConnected && el.getClientRects().length > 0

/** Where a drop lands: the message box nearest the spot dropped on (the thread's own box, the sheet open on top). */
export function dropTargetFor(node: Node | null): Target | undefined {
  const live = targets.filter((t) => { const el = t.el(); return !!el && shown(el) })
  for (let at: Node | null = node; at; at = at.parentNode) {
    // The latest mounted first: a sheet open over a thread wins over the thread.
    const hit = [...live].reverse().find((t) => { const el = t.el()!; return el === at || el.contains(at) || at!.contains(el) })
    if (hit) return hit
  }
  return undefined
}

const light = (el: HTMLElement | null) => {
  if (lit === el) return
  lit?.removeAttribute('data-dropping')
  lit = el
  lit?.setAttribute('data-dropping', '')
}
const over = (e: DragEvent) => {
  if (!carriesFiles(e)) return
  // Never let the browser open a dropped file in place of the app.
  e.preventDefault()
  const target = dropTargetFor(e.target as Node)
  if (e.dataTransfer) e.dataTransfer.dropEffect = target ? 'copy' : 'none'
  light(target?.el() ?? null)
}
const leave = (e: DragEvent) => { if (!e.relatedTarget) light(null) }
const drop = (e: DragEvent) => {
  if (!carriesFiles(e)) return
  e.preventDefault()
  light(null)
  const files = [...(e.dataTransfer?.files ?? [])]
  if (files.length) dropTargetFor(e.target as Node)?.take(files)
}

/** Takes files dropped on (or near) this box. Several boxes on screen: the drop goes to the nearest one. */
export function useDropTarget(ref: React.RefObject<HTMLElement | null>, take: (files: File[]) => void, enabled: boolean) {
  const latest = useRef(take)
  latest.current = take
  useEffect(() => {
    if (!enabled) return
    const target: Target = { el: () => ref.current, take: (files) => latest.current(files) }
    if (!targets.length) {
      document.addEventListener('dragover', over)
      document.addEventListener('dragleave', leave)
      document.addEventListener('drop', drop)
    }
    targets.push(target)
    return () => {
      targets.splice(targets.indexOf(target), 1)
      if (lit === ref.current) light(null)
      if (!targets.length) {
        document.removeEventListener('dragover', over)
        document.removeEventListener('dragleave', leave)
        document.removeEventListener('drop', drop)
      }
    }
  }, [enabled, ref])
}
