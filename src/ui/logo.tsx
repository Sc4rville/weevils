import type { CSSProperties } from 'react'
import officialLogo from '../assets/weevboss-official.png'

/** Exact approved PNG received from Gepetto; preserve its colours, proportions and white background. */
export function WeevbossLogo({ className, style, title }: { className?: string; style?: CSSProperties; title?: string }) {
  return <img className={className} style={{ objectFit: 'contain', ...style }} src={officialLogo} width={1254} height={1254} alt={title ?? ''} aria-hidden={title ? undefined : true} draggable={false} />
}
