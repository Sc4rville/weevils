// The side bar's drawers other than the projects (weevils next, main.tsx SideBar): each one pinned (always there, its
// small pin between its icon and its name), out of it, or left to its own rule. weevils and Your factory are always
// there (Your factory is where this is chosen), never pinned. Projects follow the same idea with the app's pins
// (next/src/factory.tsx inSideBar).

export const DRAWERS = ['misc', 'autonomous', 'pages', 'settings'] as const
export type Drawer = (typeof DRAWERS)[number]

/** What the drawers hold now, for their own rule: misc shows while one of its conversations needs you, autonomous
 *  while it has automations, pages and settings always. */
export type DrawerFacts = { miscNeedsYou: boolean; miscAny: boolean; autonomous: boolean }

/** Whether a drawer is in the side bar. choice: true pinned (always; misc once it has a conversation to show), false
 *  out (never), undefined its own rule. */
export function drawerShown(choice: boolean | undefined, id: Drawer, facts: DrawerFacts): boolean {
  if (choice === false) return false
  if (id === 'misc') return choice === true ? facts.miscAny : facts.miscNeedsYou
  if (id === 'autonomous') return choice === true || facts.autonomous
  return true
}
