// The side bar's drawers other than the repos and the loose conversations (weevils next, main.tsx SideBar): each one pinned (always there, its
// small pin between its icon and its name), out of it, or left to its own rule. weevils, Your factory and settings are
// always there, never pinned, with no switch: Your factory is where this is chosen, and settings is the way back to
// everything else (2026-11-27: it was a drawer for a day, one stray tap on its pin took it away; a choice kept for it
// from then is ignored). Projects follow the same idea with the app's pins (next/src/factory.tsx inSideBar).

export const DRAWERS = ['autonomous', 'pages'] as const
export type Drawer = (typeof DRAWERS)[number]

/** What the drawers hold now, for their own rule: autonomous shows while it has automations, pages always.
 *  (No requests band in the side bar since 2026-11-27: the requests page opens from settings, as before it. No
 *  catch-all drawer since 2026-11-26: a conversation started with no repo is its own band.) */
export type DrawerFacts = { autonomous: boolean }

/** Whether a drawer is in the side bar. choice: true pinned (always), false out (never), undefined its own rule. */
export function drawerShown(choice: boolean | undefined, id: Drawer, facts: DrawerFacts): boolean {
  if (choice === false) return false
  if (id === 'autonomous') return choice === true || facts.autonomous
  return true
}
