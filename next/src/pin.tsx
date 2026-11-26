import { Icon } from '../../src/ui/icons.tsx'

/** The small thin pin of a drawer pinned in the side bar, between its icon and its name (never on weevils or Your
 *  factory, always there). Unpinned, it is gone. */
export const PinMark = () => <span className="nx-pin" aria-label="pinned"><Icon name="pin" /></span>
