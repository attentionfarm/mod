# attentionfarm mod

a clickable **powered by attentionfarm** label above your claude code prompt. clicking it opens the [email waitlist](https://attentionfarm.com/?utm_source=mod&utm_campaign=mod-waitlist-v0).

the cli status line scrolls: **watch ad, get tokens | attentionfarm |**.

ads and token earning are coming soon. this version is only a label and ticker.

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

## ticker controls

use `/attentionfarm ticker pause`, `resume`, `off` or `on`. the 60-character line moves two characters each second, and claude clips it to the available width. claude controls its prefix and icon. the timer stops on session end; no ticker runs in noninteractive sessions.

## development

```sh
claude plugin validate --strict .claude-plugin/plugin.json
claude plugin test .
```

native tests passed on claude code 2.1.288. a version number alone does not establish mod support.
