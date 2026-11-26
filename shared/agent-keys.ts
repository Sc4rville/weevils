// Agent keys (server/agent-keys.ts, docs/agents.md): what the app reads of them. Never a secret, never its hash; the
// secret itself comes once, in the answer to its creation.

/** The one thing a key can do: send messages to weevboss and read its replies. */
export type AgentKeyScope = 'boss:messages'

export interface AgentKeyView {
  /** The author id its messages are signed with (`[from:<id>]`), also the key's id. */
  id: string
  name: string
  color: string
  scope: AgentKeyScope
  createdAt: number
  lastUsedAt?: number
}

/** GET /api/agent-keys */
export interface AgentKeysList {
  keys: AgentKeyView[]
  /** This machine runs weevboss: the agents' address answers here. */
  enabled: boolean
  /** This weevils' address, as the app reached it (its public address first). */
  base: string
  /** Where an agent posts its messages. */
  endpoint: string
  /** The connector's address for ChatGPT or Claude.ai, when the connector is on. */
  connector: string | null
}

/** POST /api/agent-keys: the key, shown this once. */
export type AgentKeyCreated = AgentKeyView & { key: string }
