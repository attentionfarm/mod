# try the mod

requires macos and a claude code build with native mod support. the website has the [download](https://attentionfarm.com/downloads/attentionfarm-mod-v0.1.4.zip).

## cli preview

```sh
unzip ~/Downloads/attentionfarm-mod-v0.1.4.zip -d ~/Downloads/attentionfarm-mod
claude --plugin-dir ~/Downloads/attentionfarm-mod
```

exit and start claude without the flag to stop loading the preview. keep only one attentionfarm variant enabled.

## local code app

with an account that has code access, open a local code session. choose + → add plugins → add plugin → upload plugin. select the zip without unzipping it. use the local session upload rather than an account-level upload.

the label should appear above the prompt. the scrolling status line is a cli surface; desktop display remains unverified. use the plugin menu to disable or remove an installed mod.

## what to expect

**powered by attentionfarm** stays visible without a url beside it. clicking it deliberately invokes the macos browser opener with the fixed waitlist url. the cli ticker repeats **watch ad, get tokens | attentionfarm |**. ads and token earning are coming soon.

`/attentionfarm ticker off` hides the ticker; `on`, `pause` and `resume` control it.

## verification

native label/click, ticker/wrap, pause/resume, cleanup and noninteractive tests passed. real cli rendering was observed. a real browser click and desktop installation remain unverified. the opener supports macos; other platforms are not verified.

claude’s installer manages its own plugin files. the mod does not write files or change claude settings. it performs no automatic website navigation, network polling, login or compute routing.
