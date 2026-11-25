# weevils

[weevils](https://github.com/Sc4rville/weevils) is an app on your phone to watch and drive the Claude Code and Codex
sessions running on your computers and servers.

```sh
npx weevils                          # install weevils on this machine
npx weevils <setup id>               # the setup you started on the weevils site
npx weevils join <address> <code>    # plug this computer into your weevils (weevboss gives you the line)
npx weevils bring <address> <code>   # bring this computer's conversations to your weevils
```

## What this package does

Nothing more than the `curl … | bash` line it stands for. [`bin/weevils.js`](bin/weevils.js), one short file with no
dependencies, picks the script, downloads it whole over HTTPS from the same address the curl line uses, and runs it
with `bash -s`:

| you type | it runs |
|---|---|
| `npx weevils [options]` | `curl -fsSL https://raw.githubusercontent.com/Sc4rville/weevils/main/install.sh \| bash -s -- [options]` |
| `npx weevils <setup id>` | `curl -fsSL https://get.scarville.tech/install.sh \| bash -s <setup id>` |
| `npx weevils join <address> <code>` | `curl -fsSL https://<address>/api/join.sh \| bash -s <code>` |
| `npx weevils bring <address> <code>` | `curl -fsSL https://<address>/api/bring.sh \| bash -s <code>` |

The scripts themselves live in the repository (`install.sh`, `get/bootstrap.sh`, `server/join.sh`,
`server/bring.sh`): read them there, or at their address before you run anything.

## No Node.js on the machine?

A fresh Mac or a new server has no Node.js, so no `npx`. The curl line does exactly the same and needs nothing:

```sh
curl -fsSL https://raw.githubusercontent.com/Sc4rville/weevils/main/install.sh | bash
```

The weevils site and weevboss always show that line under the `npx` one.

On Windows, `npx weevils <setup id>` runs the site's PowerShell line (it installs in Ubuntu, in WSL); `join` and
`bring` run in Ubuntu (WSL), where it prints the line to paste.
