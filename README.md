<div align="center">

<img width="760" alt="Pixel Fox Embracing Telegram Orb" src="https://github.com/user-attachments/assets/b2406c96-87a7-40e8-87c6-89641b3fd72c" />

# TeleFox

### The Chromium browser built around Telegram SOCKS5 proxies.

Import `tg://socks` proxies, browse through them directly, and automatically fail over when a proxy becomes unavailable.

<br>

<a href="https://github.com/ThaRealSolomon/TeleFox/releases/latest">
  <img src="https://img.shields.io/badge/⬇%20Download-TeleFox%20for%20Windows-000000?style=for-the-badge" alt="Download TeleFox">
</a>
<a href="https://github.com/ThaRealSolomon/TeleFox">
  <img src="https://img.shields.io/badge/★%20Star-GitHub-52057B?style=for-the-badge" alt="Star TeleFox">
</a>
<a href="https://t.me/YourTeleFox">
  <img src="https://img.shields.io/badge/✈%20Telegram-Community-892CDC?style=for-the-badge" alt="TeleFox Telegram">
</a>
<a href="https://github.com/ThaRealSolomon/TeleFox/issues">
  <img src="https://img.shields.io/badge/⚠%20Issues-GitHub-BC6FF1?style=for-the-badge" alt="GitHub Issues">
</a>

<br><br>

<img src="https://img.shields.io/github/v/release/ThaRealSolomon/TeleFox?style=flat-square&label=release" alt="Latest Release">
<img src="https://img.shields.io/github/stars/ThaRealSolomon/TeleFox?style=flat-square&label=stars" alt="GitHub Stars">
<img src="https://img.shields.io/github/last-commit/ThaRealSolomon/TeleFox?style=flat-square&label=updated" alt="Last Commit">

</div>

---

## ⚡ See TeleFox in Action

<div align="center">

<img width="1280" alt="TeleFox animated demo" src="https://github.com/user-attachments/assets/cc143331-1867-42df-961a-baeb0ed8dafd" />

</div>

---

## 🦊 What is TeleFox?

**TeleFox** is an open-source **Electron/Chromium browser** designed specifically around **Telegram SOCKS5 proxies**.

Instead of changing your system proxy or relying on browser extensions, TeleFox provides its own proxy-routing layer so browser traffic can be sent through your selected Telegram SOCKS5 proxy.

### Built for

| | Capability |
|---|---|
| 🔗 | Import Telegram `tg://socks` links |
| 🔐 | Support SOCKS5 username/password authentication |
| 🌐 | Route Chromium browser traffic through the selected proxy |
| ♻️ | Detect failures and perform proxy failover |
| 🗂️ | Manage multiple proxy configurations |
| 🔒 | Protect stored secrets with Electron `safeStorage` |
| 🧩 | Keep proxy credentials out of the renderer |
| 📡 | Store and identify `tg://proxy` MTProto links |

---

## 🚀 Why TeleFox?

### Telegram-first proxy workflow

Paste a Telegram SOCKS5 link and use it as a browser proxy without manually configuring Windows or Chromium.

### Automatic failover

When an upstream proxy becomes unavailable, TeleFox can detect the failure and use its proxy-selection/failover logic to keep browsing moving.

### Native browser routing

Proxy routing happens through Chromium's browser session rather than through a conventional browser extension.

### Credential protection

Sensitive proxy credentials are encrypted using Electron's `safeStorage` and are not exposed to the renderer process.

---

## 🔐 How the SOCKS5 Bridge Works

Chromium does not provide the SOCKS5 username/password authentication workflow required by TeleFox.

TeleFox solves this with a local **loopback SOCKS5 bridge**:

```text
┌──────────────────────┐
│      Chromium        │
│                      │
│   session.setProxy() │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  127.0.0.1:<random>  │
│    Local SOCKS5      │
│       Bridge         │
└──────────┬───────────┘
           │
           │ authenticated
           ▼
┌──────────────────────┐
│ Telegram SOCKS5      │
│       Proxy          │
└──────────┬───────────┘
           │
           ▼
        Internet
```

The local bridge:

- listens on `127.0.0.1`
- uses a randomly selected local port
- requires no local authentication
- authenticates against the configured upstream SOCKS5 proxy
- forwards browser traffic to the upstream server

Because Chromium connections pass through this bridge, connection failures can also be observed as part of TeleFox's failover mechanism.

---

## 📡 Telegram Proxy Support

### ✅ Browser-capable — SOCKS5

```text
tg://socks?server=example.com&port=1080&user=username&pass=password
```

These proxies can be imported, connected, and used for Chromium browser traffic.

### ℹ️ Telegram-only — MTProto

```text
tg://proxy?server=example.com&port=443&secret=...
```

MTProto links are stored and labelled:

> **Telegram-only / MTProto**

They are intentionally prevented from being used as browser proxies because MTProto is not a SOCKS5 browser-proxy protocol.

---

## 🛡️ Security

TeleFox is designed so that sensitive proxy credentials stay outside the renderer process.

Passwords and other secrets are protected using:

```text
Electron safeStorage
```

The browser communicates with the local SOCKS5 bridge, while the bridge handles authentication with the upstream proxy.

This keeps the browser-facing layer separate from upstream proxy credentials.

---

## 📦 Installation

### Requirements

- Windows
- Node.js
- npm

### Clone

```bash
git clone https://github.com/ThaRealSolomon/TeleFox.git
cd TeleFox
```

### Install dependencies

```bash
npm install
```

### Development

Launch TeleFox with DevTools available through `F12`:

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

Release artifacts are generated in:

```text
release/
```

### Tests

Run parser, selection, and failover tests:

```bash
npm test
```

---

## 🧱 Technology

<div align="center">

| Technology | Role |
|---|---|
| **Electron** | Desktop application runtime |
| **Chromium** | Browser engine |
| **TypeScript** | Application code |
| **SOCKS5 Bridge** | Authenticated upstream proxy routing |
| **safeStorage** | Local secret protection |
| **session.setProxy** | Chromium proxy configuration |

</div>

---

## 🗺️ Project Architecture

```text
TeleFox
│
├── Electron Main Process
│   ├── Proxy management
│   ├── SOCKS5 bridge
│   ├── Authentication
│   └── Secure storage
│
├── Chromium Renderer
│   └── Browser UI / pages
│
└── Proxy Layer
    ├── Telegram SOCKS5
    ├── Authentication
    ├── Failure detection
    └── Failover
```

---

## 📥 Download

<div align="center">

### Windows x64

<a href="https://github.com/ThaRealSolomon/TeleFox/releases/latest">
  <img src="https://img.shields.io/badge/Download%20Latest%20Release-000000?style=for-the-badge&logo=github&logoColor=white" alt="Download Latest Release">
</a>

<br><br>

**Portable and installer builds are available from the latest release.**

</div>

---

## 💬 Community & Support

<div align="center">

<a href="https://t.me/YourTeleFox">
  <img src="https://img.shields.io/badge/Telegram-YourTeleFox-229ED9?style=for-the-badge&logo=telegram&logoColor=white" alt="TeleFox Telegram">
</a>
<a href="https://github.com/ThaRealSolomon/TeleFox/issues">
  <img src="https://img.shields.io/badge/Bug%20Reports-GitHub%20Issues-000000?style=for-the-badge&logo=github&logoColor=white" alt="GitHub Issues">
</a>

</div>

---

## 🤝 Contributing

Bug reports, technical feedback, improvements, and pull requests are welcome.

For bugs and feature requests:

**https://github.com/ThaRealSolomon/TeleFox/issues**

---

## ⭐ Support the Project

TeleFox is **free and open source**.

If you find it useful, consider giving the repository a ⭐ on GitHub. It helps more developers discover the project.

<div align="center">

<a href="https://github.com/ThaRealSolomon/TeleFox">
  <img src="https://img.shields.io/badge/⭐%20Star%20TeleFox%20on%20GitHub-52057B?style=for-the-badge" alt="Star TeleFox">
</a>

<br><br>

**TeleFox** · Open Source · Electron · Chromium · Telegram SOCKS5

</div>
