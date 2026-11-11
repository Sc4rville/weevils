import { useId, type CSSProperties } from 'react'
const cutout = '/branding/weevboss-cutout.png'

/** One approved silhouette; flat face colours follow the app palette without altering geometry. */
export function WeevbossLogo({ className, style, title }: { className?: string; style?: CSSProperties; title?: string }) {
  const filter = useId()
  return <svg className={`weevboss-logo ${className ?? ''}`} style={style} viewBox="106 126 1046 1046" width={44} height={44} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false">
    <defs>
      <filter id={filter} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feComponentTransfer in="SourceAlpha" result="edge"><feFuncA type="linear" slope="1.111111" intercept="-0.111111" /></feComponentTransfer>
        <feColorMatrix in="SourceGraphic" type="luminanceToAlpha" result="planes" />
        <feComponentTransfer in="planes" result="frontMask"><feFuncA type="discrete" tableValues="1 0 0 0 0" /></feComponentTransfer>
        <feFlood floodColor="var(--logo-front, #211b2e)" result="frontColor" />
        <feComposite in="frontColor" in2="frontMask" operator="in" result="front" />
        <feComponentTransfer in="planes" result="sideMask"><feFuncA type="discrete" tableValues="0 1 0 0 0" /></feComponentTransfer>
        <feFlood floodColor="var(--logo-side, #49405f)" result="sideColor" />
        <feComposite in="sideColor" in2="sideMask" operator="in" result="side" />
        <feComponentTransfer in="planes" result="topMask"><feFuncA type="discrete" tableValues="0 0 1 1 1" /></feComponentTransfer>
        <feFlood floodColor="var(--logo-top, #70508f)" result="topColor" />
        <feComposite in="topColor" in2="topMask" operator="in" result="top" />
        <feMerge result="coloured"><feMergeNode in="front" /><feMergeNode in="side" /><feMergeNode in="top" /></feMerge>
        <feComposite in="coloured" in2="edge" operator="in" />
      </filter>
    </defs>
    <image href={cutout} width={1254} height={1254} filter={`url(#${filter})`} />
  </svg>
}
