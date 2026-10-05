# install the mod

requires macos and a claude code build with native mod support.

## install

run these commands in your terminal:

```sh
claude plugin marketplace add attentionfarm/mod
claude plugin install attentionfarm@attentionfarm
```

exit claude, then restart:

```sh
claude
```

keep only one attentionfarm variant enabled.

## update

```sh
claude plugin marketplace update attentionfarm
claude plugin update attentionfarm@attentionfarm
```

exit and restart with `claude` after updating.

## what to expect

**powered by attentionfarm** appears above the prompt without a url beside it. clicking it deliberately invokes the macos browser opener with the fixed waitlist url. the cli ticker repeats **watch ad, get tokens | attentionfarm |**. ads and token earning are coming soon.

`/attentionfarm ticker off` hides the ticker; `on`, `pause` and `resume` control it. the scrolling status line is a cli surface; desktop display remains unverified.

## uninstall

```sh
claude plugin uninstall attentionfarm@attentionfarm
```

exit and restart with `claude`.

## verification

fresh public marketplace add and installation passed, along with native label/click, ticker/wrap, pause/resume, cleanup and noninteractive tests. real cli rendering was observed. a real browser click and desktop installation remain unverified. the opener supports macos; other platforms are not verified.

claude’s installer manages its own plugin files. the mod does not write files or change claude settings. it performs no automatic website navigation, network polling, login or compute routing.
