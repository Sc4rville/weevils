// The keyboard, on a computer: Escape closes the side bar, as a tap outside it does (docs/next-interaction.md).

/** Whether this key press closes the open side bar: Escape, unless something already took it (a field or a sheet that
 *  answers Escape itself and says so), a key held down, or a word still being composed (an input method's Escape). */
export const closesSideBar = (e: Pick<KeyboardEvent, 'key' | 'defaultPrevented' | 'repeat' | 'isComposing'>): boolean =>
  e.key === 'Escape' && !e.defaultPrevented && !e.repeat && !e.isComposing
