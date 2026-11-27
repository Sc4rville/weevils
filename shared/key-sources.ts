// Where a key or a token comes from, so that nobody types what weevils can get by itself (the rule: CONTRIBUTING.md,
// « Rules of the house »). In this order, for a secret an agent asks for ([[setup:key:NAME]], « weevils setup key NAME »):
//   1. already on this machine (its shell settings, the provider's own command line tool): weevils takes it there
//      (server/key-sources.ts) and says so;
//   2. a sign-in by link (`login`): GitHub's device page, npm's web sign-in. One link to tap, weevils says when it is done;
//   3. the provider's own page that creates it (`create`), next to the masked field: the last resort, one paste.
// Shared by the server (what it says and does) and the app (the link next to the field).

export interface KeySource {
  /** weevils signs in by itself, with one link to tap: the key is never seen. */
  login?: 'github' | 'npm'
  /** The exact page that creates the key, shown next to the masked field. */
  create?: string
}

/** GitHub's page for a token with the rights weevils uses already ticked: only when its sign-in by link failed. */
const GITHUB_TOKEN_PAGE = 'https://github.com/settings/tokens/new?scopes=repo,read:org,workflow&description=weevils'

// By the name's prefix (« OPENAI » of OPENAI_API_KEY). Only pages that open on the key itself, never a home page.
const SOURCES: Record<string, KeySource> = {
  GITHUB: { login: 'github', create: GITHUB_TOKEN_PAGE },
  GH: { login: 'github', create: GITHUB_TOKEN_PAGE },
  NPM: { login: 'npm' },
  OPENAI: { create: 'https://platform.openai.com/api-keys' },
  ANTHROPIC: { create: 'https://console.anthropic.com/settings/keys' },
  GEMINI: { create: 'https://aistudio.google.com/apikey' },
  GOOGLE: { create: 'https://aistudio.google.com/apikey' },
  MISTRAL: { create: 'https://console.mistral.ai/api-keys' },
  XAI: { create: 'https://console.x.ai/team/default/api-keys' },
  OPENROUTER: { create: 'https://openrouter.ai/settings/keys' },
  GROQ: { create: 'https://console.groq.com/keys' },
  DEEPSEEK: { create: 'https://platform.deepseek.com/api_keys' },
  CARTESIA: { create: 'https://play.cartesia.ai/keys' },
  ELEVENLABS: { create: 'https://elevenlabs.io/app/developers/api-keys' },
  REPLICATE: { create: 'https://replicate.com/account/api-tokens' },
  FAL: { create: 'https://fal.ai/dashboard/keys' },
  RUNPOD: { create: 'https://console.runpod.io/user/settings' },
  VAST: { create: 'https://cloud.vast.ai/manage-keys/' },
  HF: { create: 'https://huggingface.co/settings/tokens/new?tokenType=read' },
  HUGGINGFACE: { create: 'https://huggingface.co/settings/tokens/new?tokenType=read' },
  STRIPE: { create: 'https://dashboard.stripe.com/apikeys' },
  VERCEL: { create: 'https://vercel.com/account/settings/tokens' },
  CLOUDFLARE: { create: 'https://dash.cloudflare.com/profile/api-tokens' },
}

/** « OPENAI_API_KEY » → « OPENAI »: the provider a secret's name points to. */
export const keyPrefix = (name: string): string => name.replace(/_(API_KEY|TOKEN)$/, '')

/** How weevils gets this secret with the least to do: a sign-in link, the page that creates it, or nothing known. */
export const keySource = (name: string): KeySource => SOURCES[keyPrefix(name)] ?? {}

/** Gmail's page that creates an app password (the e-mail bridge). */
export const GMAIL_APP_PASSWORD = 'https://myaccount.google.com/apppasswords'

/** A link that opens a provider's page with a code already copied (GitHub's and Codex's device pages ask for one):
 *  `/#open=<address>&copy=<code>`. The app copies the code in the tap that opens the page (src/ui/living-link.tsx). */
export const copyLink = (url: string, code: string): string => `/#open=${encodeURIComponent(url)}&copy=${encodeURIComponent(code)}`

/** Reads such a link back: an https address and a short code, nothing else. */
export function readCopyLink(hash: string): { url: string; code: string } | undefined {
  const m = /^#open=([^&]+)&copy=([^&]+)$/.exec(hash)
  if (!m) return undefined
  let url: string, code: string
  try {
    url = decodeURIComponent(m[1])
    code = decodeURIComponent(m[2])
  } catch {
    return undefined
  }
  if (!/^https:\/\/[^\s<>"']+$/.test(url) || !/^[A-Za-z0-9-]{4,24}$/.test(code)) return undefined
  return { url, code }
}
