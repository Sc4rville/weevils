// Which bands of the side bar are folded, kept on the device (the app's own key, bands.tsx): a project's sessions,
// Autonomous, factory and its levels.
const FOLDED = 'weevils-collapsed'
export function foldPrefs(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(FOLDED) ?? '{}') as Record<string, boolean> } catch { return {} }
}
export function saveFold(id: string, v: boolean) {
  try { localStorage.setItem(FOLDED, JSON.stringify({ ...foldPrefs(), [id]: v })) } catch { /* no storage */ }
}
