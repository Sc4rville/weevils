# Agents that write to weevboss

Another agent (a bot, a web agent, a CI job, a colleague's assistant) can write to weevboss and read its replies.
There are two ways in, depending on what the agent is. Both need your weevils at a public https address: your own
domain, or, for a computer set up from the setup page, its stable address `https://<name>.tryweevils.scarville.tech`
([stable-address.md](stable-address.md)), which stays the same across restarts, so a connector or a key given to an
agent keeps working.

## ChatGPT, Claude.ai and other chat apps with MCP: the connector

A chat app that adds MCP connectors with OAuth (ChatGPT, Claude.ai) uses weevils' connector: one address,
`https://<your weevils>/mcp`, added in the chat app, and a consent page where you type your access code once. Ask
weevboss to "plug in ChatGPT" (or Claude.ai) and it turns the connector on and gives you the address and the clicks.
The settings page **ChatGPT and agents** shows the address first, with a Copy button and the three steps (and turns the connector on in one tap when it is off). Details:
[spec/05-connector.md](spec/05-connector.md).

## Everything else: an agent key

1. In the app, open **settings → ChatGPT and agents**, type the agent's name (for example `Helper`) and tap **Create the
   key**. Copy the key at once: it is shown this one time (**copy the instructions with the key** copies a short text
   to paste into the agent, with the address and the key).
2. Give the key to the agent. It writes to `https://<your weevils>/agent/v1/messages`.

Send a message:

```sh
curl -sS https://weevils.example.com/agent/v1/messages \
  -H "Authorization: Bearer $WEEVILS_AGENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text": "The nightly import failed on shop-app, can you look?"}'
# 202 {"id":"msg_3q1k…","status":"sent"}
```

`Content-Type: text/plain` with the bare text works too. Then read weevboss's reply, waiting up to 25 seconds per call
(`wait`, 0 to 25), again while the status is `working`:

```sh
curl -sS "https://weevils.example.com/agent/v1/messages/msg_3q1k…?wait=25" \
  -H "Authorization: Bearer $WEEVILS_AGENT_KEY"
# 200 {"id":"msg_3q1k…","status":"working"}
# 200 {"id":"msg_3q1k…","status":"answered","reply":"Looked at it: …"}
# 200 {"id":"msg_3q1k…","status":"timeout"}       no written reply within 45 minutes
```

The reply is weevboss's written answer in its thread after the message (everything it wrote until it stopped
working), kept in memory for a day, the last 200 messages per key.

### Answers and errors

| status | when |
|---|---|
| `202` | the message is in weevboss's thread |
| `400` | empty text, unreadable JSON |
| `401` | no key, a wrong key or a revoked one (`WWW-Authenticate: Bearer`) |
| `404` | a message of another key, an unknown address, or weevboss doesn't run on this machine |
| `409` | a test message (`[test]`, `TEST…`): tests never write to weevboss's thread |
| `413` | more than 20 000 characters |
| `415` | a body that is neither JSON nor plain text |
| `429` | too many messages for this key (10 a minute, 100 an hour) or too many wrong keys from one address; `Retry-After` says when |
| `503` | weevboss can't take a message right now (its model is at its limit); `Retry-After` says when to try again |

Errors are JSON: `{"error": "…"}`. There is no CORS: the address is for programs, not for web pages.

## Security

- **One key, one author.** Each key has a name, and its messages arrive in weevboss's thread signed with it
  (`[from:helper]`), in its colour. The author is set by weevils from the key, never from what the agent sends: a
  `[from:…]` the agent writes in its text stays quoted inside the message. A key never speaks as you, and weevboss
  treats it as a colleague: anything that is yours to decide (deleting, paying, publishing) waits for you.
- **One scope.** A key sends messages to weevboss and reads the replies to its own messages. It opens nothing else:
  not the app, not `/api`, not the sessions, not the files. A key never reads another key's messages.
- **Shown once, kept as a hash.** weevils keeps only the key's SHA-256 (`~/.local/share/weevils/agent-keys.json`,
  readable by your user only) and compares it in constant time. Lost the key? Revoke it and create another.
- **Revocable at once.** **revoke** on the settings page: the next request with that key gets `401`. Its old
  messages keep its name.
- Only a browser signed in with your access code creates a key. Rate limits apply per key.
- A key whose name is a declared author (`WEEVILS_AUTHOR_<ID>` in `~/.config/weevils/env`) speaks as that author. The
  names `weevboss`, `weevils`, `boss`, `codex`, `claude`, `agent`, `owner`, `user`, `you` and `me` are reserved.

The e-mail bridge ([email.md](email.md)) did this before; it is deprecated and off by default.
