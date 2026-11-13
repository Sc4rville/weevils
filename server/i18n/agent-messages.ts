import { defineMessages } from '../i18n.ts'

/** Shared by both agents and relay handoffs, independent of personal memory. */
export default defineMessages({
  fr:{rule:'Pour coordonner les agents, utilise weevils send depuis le runtime de la session source. Conserve son identité de session ; ne te fais jamais passer pour l’utilisateur ou weevboss. Le serveur attribue l’auteur réel et signe la provenance avant de mettre le message en file. Ne contourne pas ce chemin par turn/steer, turn/start ou un client daemon brut. Une acceptation signifie livraison acceptée, pas lecture confirmée. Transmets cette convention lors des passations.'},
  en:{rule:'For agent coordination, use weevils send from the source session runtime. Preserve its session identity; never impersonate the user or weevboss. The server assigns the actual author and signs provenance before queueing delivery. Do not bypass this path with turn/steer, turn/start or a raw daemon client. Acceptance means accepted for delivery, not confirmed reading. Carry this convention during handoffs.'},
})
