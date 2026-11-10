/** Presentation only: remove familiar routing tags at the start, never machine details in prose. */
export const withoutMachinePrefix = (text: string): string => text.replace(/^\s*(?:\[(?:PC|VPS|GPU)\]\s*)+/i, '')
