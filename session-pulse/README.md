# session-pulse

Hermes **desktop** plugin: live statusbar chip + pane showing gateway state,
context usage (tokens + %), and per-model estimated spend.

## Install target

The machine running the **desktop app** (not the gateway):

```
$HERMES_HOME/desktop-plugins/session-pulse/plugin.js
Windows: %LOCALAPPDATA%\hermes\desktop-plugins\session-pulse\
```

The plugin scan is local to the app machine — dropping this into the Linux
gateway's `~/.hermes/desktop-plugins/` does nothing (verified 2026-08-28).

## Deploy from this Linux box (app on 192.168.1.14, gateway on .5)

1. Serve the folder on the LAN:
   `cd ~/hermes-plugins/session-pulse && python3 -m http.server 8931`
2. On the Windows box (PowerShell), fetch + verify:
   `Invoke-WebRequest http://192.168.1.5:8931/plugin.js -OutFile "$env:LOCALAPPDATA\hermes\desktop-plugins\session-pulse\plugin.js" -UseBasicParsing`
3. Check the fetch landed in the server log; the app hot-reloads the file
   (Ctrl+K "Reload desktop plugins" if needed).

## If it stops showing

Check cheapest-first (2026-09-06: cause was #1, file was intact the whole time):

1. Settings → Plugins — "Session Pulse" toggled **off** looks identical to
   missing: no chip, no pane, no error toast. Toggle back on.
2. Error toast on load ("Plugin session-pulse failed to load") — fix
   plugin.js, save, it hot-reloads.
3. Otherwise redeploy per steps above, verify the hash, then Ctrl+K →
   Reload desktop plugins.

## Pricing notes

- z.ai API: flat rates, no peak/off-peak. GLM-5.3-flash 50% promo ends
  2026-09-09 16:00 UTC — the plugin auto-switches to list price after.
- DeepSeek API: peak = Mon–Fri 01:00–04:00 + 06:00–10:00 UTC; off-peak is half.
- Codex models: ChatGPT plan quota (5h windows, shared pool with Codex CLI) —
  shown as "plan", never priced per-token.
- Unknown models: deliberately unpriced (no guessing).

Update rates from the primary sources:
docs.z.ai/guides/overview/pricing and api-docs.deepseek.com/quick_start/pricing.
