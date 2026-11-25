// The lines a person pastes on another computer to plug it in (server/join.sh) or bring its conversations
// (server/bring.sh): `npx weevils …` first, short and readable (the npm package in npm/, a thin wrapper that runs the
// same script), and the curl line it stands for, which needs nothing installed (a fresh Mac or server has no Node.js).

export type PasteKind = 'join' | 'bring'

/** Whether the npm package `weevils` is published (by its owner): until then the npx line is never shown, only the
 *  curl one (an unpublished name could be taken by anyone, and the line would run their code). get/server.mjs has the
 *  same switch; test/npx-weevils.test.ts keeps them equal. */
export const NPX_PUBLISHED = false

/** The lines to show for one code: the npx one first when the package is published, always the curl one. */
export function pasteLines(kind: PasteKind, url: string, code: string, extra = ''): { npx: string | null; curl: string } {
  return { npx: NPX_PUBLISHED ? npxLine(kind, url, code, extra) : null, curl: curlLine(kind, url, code, extra) }
}

/** A weevils' address as the npx line shows it: https is the default there, so only its host; http stays whole. */
export function lineAddress(url: string): string {
  const u = url.replace(/\/+$/, '')
  return /^https:\/\//i.test(u) ? u.slice('https://'.length) : u
}

/** `npx weevils join weevils.example.com <code>`, with the options the curl line would carry. */
export function npxLine(kind: PasteKind, url: string, code: string, extra = ''): string {
  return `npx weevils ${kind} ${lineAddress(url)} ${code}${extra}`
}

/** The same, for a machine without Node.js: `curl -fsSL <url>/api/join.sh | bash -s <code>`. */
export function curlLine(kind: PasteKind, url: string, code: string, extra = ''): string {
  return `curl -fsSL ${url.replace(/\/+$/, '')}/api/${kind}.sh | bash -s ${code}${extra}`
}

/** A said line with its code masked (either form): the code works on its own, nobody else needs it. */
export function maskPasteCode(text: string): string {
  return text
    .replace(/(\/api\/(?:join|bring)\.sh \| bash -s )[A-Za-z0-9_-]+/g, '$1••••')
    .replace(/(npx weevils (?:join|bring) \S+ )[A-Za-z0-9_-]+/g, '$1••••')
}
