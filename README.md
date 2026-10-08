<p align="center">
  <img width="700" alt="Pixel Fox Embracing Telegram Orb" src="https://github.com/user-attachments/assets/b2406c96-87a7-40e8-87c6-89641b3fd72c" />
</p>

<h1 align="center">TeleFox</h1>

<p align="center">
  An Electron/Chromium browser built around Telegram SOCKS5 proxies.
</p>

<p align="center">
  <a href="https://github.com/ThaRealSolomon/TeleFox/releases/latest">
    <strong>Download</strong>
  </a>
  ·
  <a href="https://github.com/ThaRealSolomon/TeleFox/issues">
    Report an Issue
  </a>
  ·
  <a href="https://t.me/YourTeleFox">
    Telegram
  </a>
</p>

---

## Overview

**TeleFox** is an open-source Electron/Chromium browser designed to use **Telegram SOCKS5 proxies** directly for browser traffic.

It is built around Telegram's `tg://socks` proxy links and provides a dedicated proxy-routing layer between Chromium and the upstream Telegram SOCKS5 server.

### Core capabilities

- Import and use Telegram `tg://socks` proxies
- Support upstream SOCKS5 authentication
- Route Chromium browser traffic through the selected proxy
- Detect connection failures for proxy failover
- Support multiple proxy configurations
- Store `tg://proxy` MTProto links separately as **Telegram-only / MTProto**
- Keep MTProto proxies from being used as browser proxies
- Encrypt stored passwords and secrets with Electron `safeStorage`
- Keep proxy credentials out of the renderer process

---

## How TeleFox Handles SOCKS5 Authentication

Chromium does not provide the SOCKS5 username/password authentication workflow required by TeleFox.

To solve this, TeleFox uses a **local loopback SOCKS5 bridge**:

```text
Chromium
    │
    │ session.setProxy()
    ▼
127.0.0.1:<random-port>
    │
    │ SOCKS5 bridge
    ▼
Telegram SOCKS5 Proxy
    │
    ▼
Internet

<img width="1280" height="720" alt="ScreenRecording2026-10-08175048-ezgif com-video-to-gif-converter" src="https://github.com/user-attachments/assets/9d69b00a-6fc5-4e72-b351-17b7ab13aea3" />


```

The local bridge listens on `127.0.0.1` using a randomly selected port and does not require local authentication.

It authenticates against the configured upstream SOCKS5 proxy before forwarding browser traffic.

Because browser connections pass through this bridge, TeleFox can also use connection failures as part of its proxy failover logic.

---

## Telegram Proxy Support

### Browser-capable

TeleFox supports Telegram SOCKS5 links such as:

```text
tg://socks?server=example.com&port=1080&user=username&pass=password
```

These proxies can be imported, connected, and used for Chromium browser traffic.

### Telegram-only / MTProto

TeleFox can also store and identify:

```text
tg://proxy?server=example.com&port=443&secret=...
```

MTProto links are labelled:

**Telegram-only / MTProto**

They are intentionally prevented from being used as browser proxies because MTProto is not a SOCKS5 browser proxy protocol.

---

## Security

TeleFox is designed to keep sensitive proxy credentials away from the renderer.

Passwords and other secrets are protected using Electron's:

```text
safeStorage
```

Credentials are not sent to the renderer process.

The browser communicates with the local SOCKS5 bridge, while the bridge handles authentication with the upstream proxy.

---

## Installation

Clone the repository and install dependencies:

```bash
npm install
```

### Development

Run TeleFox in development mode with DevTools available through `F12`:

```bash
npm run dev
```

### Build

Compile the main and renderer processes:

```bash
npm run build
```

### Package for Windows

Create the Windows installer and portable executable:

```bash
npm run package
```

Generated release artifacts are placed in:

```text
release/
```

### Tests

Run the parser, proxy selection, and failover test suite:

```bash
npm test
```

---

## Project Goals

TeleFox is focused on providing a straightforward desktop browsing experience for users who already work with Telegram SOCKS5 proxies.

The project aims to keep proxy handling inside the browser rather than relying on manual system-wide proxy changes or browser extensions.

---

## Technology

- **Electron**
- **Chromium**
- **TypeScript**
- Local SOCKS5 bridge
- Electron `safeStorage`
- Chromium `session.setProxy`

---

## Open Source

TeleFox is open source and available on GitHub.

**Repository:**  
https://github.com/ThaRealSolomon/TeleFox

**Latest Release:**  
https://github.com/ThaRealSolomon/TeleFox/releases/latest

---

## Community

Follow the project and get updates on Telegram:

**https://t.me/YourTeleFox**

---

## Contributing

Bug reports, technical feedback, improvements, and pull requests are welcome.

For bugs or feature requests, please use the project's GitHub Issues:

https://github.com/ThaRealSolomon/TeleFox/issues
