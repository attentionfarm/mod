# attentionfarm mod

**log in** or **sign up** for attentionfarm without leaving claude code: type your email, then the 6-digit code we send you. no password, no browser.

above your prompt, a two-line band with a tide outline: the **attentionfarm** wordmark and **sign up or log in**, then "watch an ad, get tokens for claude code." once you're in, it shows your masked email (`y•••@example.com`); click it for your account.

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
- `/attentionfarm account`: your account, log out, delete account.
- `/attentionfarm logout`: logs this machine out, even offline.
- `/attentionfarm free`: use free af tokens now instead of your claude account.
- `/attentionfarm ad`: watch a 15 second ad and earn 1,000,000 tokens.

login works in claude code on macos, in the terminal and in the desktop app.

what is stored, and where:

- **on your mac:** a session key in your macos login keychain, item `attentionfarm-mod`, with your masked email as its comment. never in plain files, never in claude code settings. logging out deletes it.
- **on attentionfarm:** your email, a scrambled copy of each session key with its last-used day, and daily totals with no names attached. sessions end after 90 days.
- **never:** your prompts, code, files, paths, ip address or device name, except while free backup is on (below). the mod hooks no prompt or tool events.

delete account removes your account, sessions and backup keys immediately. see [attentionfarm.com/privacy](https://attentionfarm.com/privacy).

## free backup

when claude stops at a usage limit, the band offers **continue free**. you can also switch any time, with no confirmation: press **use free af tokens** in the band, or run `/attentionfarm free`. it works in the terminal and in the claude desktop app.

- while it is on, the mod answers each model step itself: it sends the conversation, claude code's system prompt and the tool list to attentionfarm, which passes them to a free model on openrouter (nemotron 3 ultra to start). claude code sends nothing to anthropic for those steps, and your claude login is never used or shared.
- every tool call the free model asks for is put to you before it runs, even in auto mode. a deny stays a deny.
- **back to claude** switches back at once. nothing is written to `~/.claude` or your environment.
- attentionfarm keeps none of your prompts or code, but free models' hosts may keep and learn from what they receive.
- each account gets a daily number of free requests. it resets at midnight utc.
- the band counts the free tokens this session used, from each reply's own usage, on your machine. `/clear` starts it again.

## watch ad, get tokens

press **watch ad, get tokens** in the band, or run `/attentionfarm ad`. a 15 second ad plays, either in a side panel or in the band above your text box (each account gets one of the two, at random, so we can learn which works better). it can't be skipped: while it plays the chat is frosted and anything you send waits until it ends. when it ends, **1,000,000 tokens** are added to your account.

- earned tokens are used once your free backup requests for the day run out: free tokens first, then a paid model (deepseek v4 flash) through attentionfarm, on your earned tokens. every token a request uses counts, including the conversation claude code sends again with each request.
- the band shows what you have left (`2m earned`), and offers **watch ad, get more** when today's free requests are used up.
- up to 10 ads a person a day, and a daily limit across everyone; the band says when ads are full until midnight utc.
- what an ad view tells attentionfarm: where it played, terminal or desktop, the day, whether it played to the end and for how many seconds, and how many messages you sent while it played (only the count, never what they said).
- earned tokens are only for compute in claude code. they are never money.

## ticker controls

use `/attentionfarm ticker pause`, `resume`, `off` or `on`. the 60-character line moves two characters each second, and claude clips it to the available width. claude controls its prefix and icon. the timer stops on session end; no ticker runs in noninteractive sessions.

## development

```sh
claude plugin validate --strict .claude-plugin/plugin.json
claude plugin test .
```

native tests passed on claude code 2.1.290. a version number alone does not establish mod support.

to try login against a local worker: `ATTENTIONFARM_MOD_API_BASE=http://127.0.0.1:8787 claude --plugin-dir .`. only `localhost` and `127.0.0.1` are accepted, and that session uses its own keychain item, `attentionfarm-mod-dev`.
