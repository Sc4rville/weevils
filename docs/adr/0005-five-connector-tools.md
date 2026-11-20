# ADR 0005 · The connector has five tools

Status: proposed (step 0) · Specified in [05 Connector](../spec/05-connector.md)

## Context

Chat apps reach the weevbook through MCP tools, and it is the chat app's model that decides which tool to call and
with what. A model picks well among a few tools with clear descriptions and badly among many similar ones. Each
tool is also a door into a server that drives agents with shell access.

## Decision

Exactly five tools: `send_to_weevboss`, `continue_with_agent`, `search_weevbook`, `read_thread`, `thread_status`.
Answers are one or two sentences and a link. Long chats are sent in parts; every message has a key derived from its
content and position, so any call can be repeated safely.

## Consequences

- The connector can add to the weevbook, read it and start a turn. It cannot read files, change settings or reach
  the rest of the API. Its tokens are refused everywhere but on `/mcp`.
- A model's retry, a network retry and a user asking twice all end the same way: nothing is written twice.
- There is no tool to rename, move, merge or delete a thread from a chat. Those stay in the app.
- A sixth tool needs a reason stronger than convenience, and a new version of this decision.
- Short text answers mean the chat app's model cannot show rich results. The link opens the app for that.
