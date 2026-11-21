export type OutboxStatus = 'accepted' | 'delivering' | 'delivered' | 'uncertain' | 'failed'
export interface OutboxReceipt {
  messageId: string
  status: OutboxStatus
  acceptedAt: number
  updatedAt: number
  id?: string
  result?: { id?: string; ok?: boolean; [key: string]: unknown }
  error?: string
  /** A confirmed failure's cause, for one short line under the message (src/ui/outbox-status.tsx). */
  cause?: DeliveryCause
}
/** unreachable: the session's process does not answer (nothing was written); offline: its machine is gone; refused: the server said no. */
export type DeliveryCause = 'unreachable' | 'offline' | 'refused'
