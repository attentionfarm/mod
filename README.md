# attentionfarm mod

**log in** or **sign up** for attentionfarm without leaving claude code: type your email, then the 6-digit code we send you. no password, no browser.

above your prompt, a two-line band with a tide outline: the **attentionfarm** wordmark and **sign up or log in**, then "earning isn't live yet. sign up to hold your spot." once you're in, it shows your masked email (`n•••@gmail.com`); click it for your account.

the cli status line scrolls: **watch ad, get tokens | attentionfarm |**.

ads and token earning aren't live yet. an account today only holds your spot for when earning opens.

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

login works in the claude code terminal on macos. on desktop the mod shows the label only.

what is stored, and where:

- **on your mac:** a session key in your macos login keychain, item `attentionfarm-mod`, with your masked email as its comment. never in plain files, never in claude code settings. logging out deletes it.
- **on attentionfarm:** your email, whether you asked for launch emails (off unless you tick the box), a scrambled copy of each session key with its last-used day, and daily totals with no names attached. sessions end after 90 days.
- **never:** your prompts, code, files, paths, ip address or device name. the mod hooks no prompt or tool events.

delete account removes your account, sessions and waitlist email immediately. see [attentionfarm.com/privacy](https://attentionfarm.com/privacy).

## ticker controls

use `/attentionfarm ticker pause`, `resume`, `off` or `on`. the 60-character line moves two characters each second, and claude clips it to the available width. claude controls its prefix and icon. the timer stops on session end; no ticker runs in noninteractive sessions.

## development

```sh
claude plugin validate --strict .claude-plugin/plugin.json
claude plugin test .
```

native tests passed on claude code 2.1.290. a version number alone does not establish mod support.

to try login against a local worker: `ATTENTIONFARM_MOD_API_BASE=http://127.0.0.1:8787 claude --plugin-dir .`. only `localhost` and `127.0.0.1` are accepted, and that session uses its own keychain item, `attentionfarm-mod-dev`.
