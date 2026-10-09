# attentionfarm mod

**log in** or **sign up** for attentionfarm without leaving claude code: type your email, then the 6-digit code we send you. no password, no browser.

above your prompt, a two-line band with a tide outline: the **attentionfarm** wordmark and **sign up or log in**, then "watch an ad, get tokens for claude code." once you're in, it shows your masked email (`n•••@gmail.com`); click it for your account.

the cli status line scrolls: **watch ad, get tokens | attentionfarm |**.

## install

requires macos and a claude code build with native mod support.

```sh
claude plugin marketplace add attentionfarm/mod
claude plugin install attentionfarm@attentionfarm
```

exit claude, then restart:

```sh
claude
```

see [installation and controls](INSTALL.md) for more details.

## update

```sh
claude plugin marketplace update attentionfarm
claude plugin update attentionfarm@attentionfarm
```

exit and restart with `claude` after updating.

## your account

- `/attentionfarm signup` or `/attentionfarm login`: opens the sign-in pane. paste the code with or without spaces; it checks itself at 6 digits.
- `/attentionfarm account`: your account, log out, log out everywhere, delete account.
- `/attentionfarm logout`: logs this machine out, even offline.
- `/attentionfarm free`: use free tokens now instead of your claude account (terminal only).

login works in claude code on macos, in the terminal and in the desktop app.

what is stored, and where:

- **on your mac:** a session key in your macos login keychain, item `attentionfarm-mod`, with your masked email as its comment. never in plain files, never in claude code settings. logging out deletes it.
- **on attentionfarm:** your email, a scrambled copy of each session key with its last-used day, and daily totals with no names attached. sessions end after 90 days.
- **never:** your prompts, code, files, paths, ip address or device name, except while free backup is on (below). the mod hooks no prompt or tool events.

delete account removes your account, sessions and backup keys immediately. see [attentionfarm.com/privacy](https://attentionfarm.com/privacy).

## free backup

when claude stops at a usage limit in a terminal session, the band offers **continue free**. you can also choose it any time: press **use free tokens** in the band, or run `/attentionfarm free`. continuing points this claude code process at attentionfarm, which passes its requests to a free model on openrouter (nemotron 3 ultra to start); after a limit stop it also sends "continue where you left off." the band shows which model is answering and how many free requests are left today. **back to claude** puts your own login back.

- it only switches what this process uses: no file, no `~/.claude` setting, nothing after you quit.
- it is never offered in the desktop app, a remote session, a cloud provider, or when you use your own api key, gateway or key helper, because there the switch could send your own credential to attentionfarm.
- while it is on, your prompts and code go through attentionfarm to openrouter and the model's host. attentionfarm keeps none of them, but free models' hosts may keep and learn from what they receive.
- each account gets a daily number of free requests. it resets at midnight utc.
- the band counts the free tokens this session used, from each reply's own usage, on your machine. switching back keeps the count; `/clear` starts it again.

## ticker controls

use `/attentionfarm ticker pause`, `resume`, `off` or `on`. the 60-character line moves two characters each second, and claude clips it to the available width. claude controls its prefix and icon. the timer stops on session end; no ticker runs in noninteractive sessions.

## development

```sh
claude plugin validate --strict .claude-plugin/plugin.json
claude plugin test .
```

native tests passed on claude code 2.1.290. a version number alone does not establish mod support.

to try login against a local worker: `ATTENTIONFARM_MOD_API_BASE=http://127.0.0.1:8787 claude --plugin-dir .`. only `localhost` and `127.0.0.1` are accepted, and that session uses its own keychain item, `attentionfarm-mod-dev`.
