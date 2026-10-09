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

a two-line band appears above the prompt: the **attentionfarm** wordmark and **sign up or log in**, then "earning isn't live yet. sign up to hold your spot." one email code signs you up or logs you in; there is no password. the cli ticker repeats **watch ad, get tokens | attentionfarm |**. ads and token earning aren't live yet.

## log in or sign up

click **sign up** (or run `/attentionfarm signup`), type your email and press enter, then type or paste the 6-digit code from the email. that's it. returning users click **log in**; it is the same flow. `/attentionfarm account` shows your account, log out, log out everywhere and delete account; `/attentionfarm logout` logs out, even offline.

login works in the claude code terminal on macos. your session key is kept in your macos login keychain (item `attentionfarm-mod`) and removed when you log out. your email and code are typed into the mod's own fields, never into the prompt, so they do not reach the conversation. privacy: https://attentionfarm.com/privacy

`/attentionfarm ticker off` hides the ticker; `on`, `pause` and `resume` control it. the scrolling status line is a cli surface; desktop display remains unverified.

## uninstall

```sh
claude plugin uninstall attentionfarm@attentionfarm
```

exit and restart with `claude`.

## verification

fresh public marketplace add and installation passed, along with native label/click, ticker/wrap, pause/resume, cleanup and noninteractive tests. real cli rendering was observed. a real browser click and desktop installation remain unverified. the opener supports macos; other platforms are not verified.

for 0.2.0, sign up, log in, the account view, log out and delete account were exercised in a real claude code 2.1.290 terminal against a local attentionfarm worker, with the keychain item written over stdin and removed on logout. desktop, linux and windows login are not supported.

claude’s installer manages its own plugin files. the mod does not write files or change claude settings. it performs no automatic website navigation, network polling or compute routing. it contacts attentionfarm only when you log in, sign up, log out or delete your account, and once at session start to confirm a saved login; logged out, it sends nothing.
