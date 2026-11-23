// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { WeevilLoading } from './loading'
import { setLang } from '../i18n'

it('a page on its way shows the weevil itself, jumping, announced to screen readers', () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  setLang('en')
  const host = document.createElement('div'); document.body.append(host)
  const r = createRoot(host)
  act(() => r.render(<WeevilLoading />))
  expect(host.querySelector('.weevil-loading[role=status] svg.weevboss-logo')).not.toBeNull()
  expect(host.textContent).toContain('Loading')
  act(() => r.unmount()); host.remove(); setLang(null)
})
