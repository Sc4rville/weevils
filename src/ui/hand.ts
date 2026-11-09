// La main du pouce : dans les pages, le logo de weevboss se place en bas de ce côté-là (droite par défaut).
// Rangée sur l'appareil, posée sur <html data-hand> : le CSS fait le reste.

import { useState } from 'react'

export type Hand = 'right' | 'left'
const KEY = 'weevils-hand'

export function getHand(): Hand {
  try {
    return localStorage.getItem(KEY) === 'left' ? 'left' : 'right'
  } catch {
    return 'right'
  }
}

function apply(h: Hand) {
  if (typeof document !== 'undefined') document.documentElement.dataset.hand = h
}
apply(getHand())

export function useHand(): [Hand, (h: Hand) => void] {
  const [hand, setState] = useState(getHand)
  const set = (h: Hand) => {
    try {
      localStorage.setItem(KEY, h)
    } catch {
      /* stockage indisponible */
    }
    apply(h)
    setState(h)
  }
  return [hand, set]
}
