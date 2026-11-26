// The side bar's drawers other than the repos and the loose conversations (weevils next, main.tsx SideBar): each one pinned (always there, its
// small pin between its icon and its name), out of it, or left to its own rule. weevils and Your factory are always
// there (Your factory is where this is chosen), never pinned. Projects follow the same idea with the app's pins
// (next/src/factory.tsx inSideBar).

export const DRAWERS = ['autonomous', 'pages', 'settings'] as const
export type Drawer = (typeof DRAWERS)[number]

/** What the drawers hold now, for their own rule: autonomous shows while it has automations, pages and settings
 *  always. (No catch-all drawer since 2026-11-26: a conversation started with no repo is its own band.) */
export type DrawerFacts = { autonomous: boolean }

/** Whether a drawer is in the side bar. choice: true pinned (always), false out (never), undefined its own rule. */
export function drawerShown(choice: boolean | undefined, id: Drawer, facts: DrawerFacts): boolean {
  if (choice === false) return false
  if (id === 'autonomous') return choice === true || facts.autonomous
  return true
}
