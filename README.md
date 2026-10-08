# TeleFox
Electron/Chromium browser that imports and uses Telegram `tg://socks` proxies.

    npm install
    npm run dev        # development with DevTools (F12)
    npm run build      # compile main + renderer
    npm run package    # Windows installer + portable exe in release/
    npm test           # parser / selection / failover tests

Chromium cannot do SOCKS5 username/password auth, so TeleFox runs a loopback SOCKS5 bridge (127.0.0.1, random port, no auth)
that authenticates upstream; tabs use it via `session.setProxy`. Every tab connection passes through the bridge, which is also how failures are counted for failover.
`tg://proxy` (MTProto) links are stored and labelled "Telegram-only / MTProto" and can never be connected for browsing.
Passwords/secrets are encrypted with Electron `safeStorage` and never sent to the renderer.
