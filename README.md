<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./branding/png/sphinx-symbol-white-1024.png" />
  <img src="./branding/png/sphinx-symbol-1024.png" width="144" alt="Sphinx Launcher" />
</picture>

  <h1 align="center">Sphinx Launcher</h1>

  <p align="center">
    <strong>Sphinx Launcher is an open-source desktop launcher for managing your game library and downloading games. It is written in Rust (Tauri) and Node.js (a React/TypeScript sidecar), with libtorrent providing the torrent engine.</strong>
  </p>

[![build](https://img.shields.io/github/actions/workflow/status/Raka-Mahendra/sphinx/build.yml)](https://github.com/Raka-Mahendra/sphinx/actions)
[![release](https://img.shields.io/github/package-json/v/Raka-Mahendra/sphinx)](https://github.com/Raka-Mahendra/sphinx/releases)

![Sphinx Launcher](./docs/screenshot.png)

</div>

## Features

- Add games that you own to your library
- Browse a catalogue with a powerful suggestion algorithm
- Download games with a built-in torrent engine
- Keep your saves in the cloud with Cloud Save (Google Drive)
- Unlock achievements
- Discover new games that you haven't played before

## Build from source and contributing

Project notes live in [`docs/`](./docs). Start with
[`docs/baseline-behavior.md`](./docs/baseline-behavior.md) for what the app does,
and [`docs/MIGRATION_LOG.md`](./docs/MIGRATION_LOG.md) for the migration history.

### Local development requirements

- Node.js + Yarn
- Rust toolchain (for `hydra-native`)
- Git and a C++ toolchain (Visual Studio C++ Build Tools on Windows, GCC/Clang on Linux, Xcode command-line tools on macOS). The native build obtains CMake and CTest automatically through vcpkg.

After installing dependencies, `postinstall` builds the Rust native addon automatically (`hydra-native/hydra-native.node`).

The native build includes a Rust wrapper around pinned libtorrent. Development and packaged torrenting no longer require Python.

On Windows x64 and Linux x64, the libtorrent bridge comes prebuilt from `native/torrent-bridge/prebuilt`, so installs skip compiling libtorrent through vcpkg. Other platforms build it from source. When a branch push changes `native/torrent-bridge` or `scripts/build-torrent-bridge.cjs`, the "Torrent bridge prebuilts" workflow rebuilds the binaries and commits them to that branch; until then, installs build the bridge from source. Set `HYDRA_TORRENT_BRIDGE_FROM_SOURCE=1` to always build it from source.

### Brand

The logo, icon set and usage rules are in [`branding/`](./branding/README.md).

### Windows SmartScreen and code signing

Unsigned releases downloaded from GitHub show **"Windows protected your PC"**
(SmartScreen) on the browser download. That is expected for every new,
un-signed publisher and is not a defect — click **More info → Run anyway** to
install. The in-app self-updater normally does **not** trigger SmartScreen
because the installer is launched by the already-running app, not the browser.

To remove the warning entirely you need an Authenticode certificate (OV/EV).
Signing is opt-in and off by default: the release workflow only signs when the
`WINDOWS_CERTIFICATE` repository secret is present, so forks and local builds
produce a working unsigned installer with no extra setup. The updater key
(minisign) and the Authenticode certificate are **different** credentials — see
[`docs/release.md`](./docs/release.md) §1, §6 and §8 for the full picture,
the manual test plan on clean machines, and how to back the keys up.

## License

Sphinx Launcher is an independent fork of Hydra Launcher. It is not affiliated
with, endorsed by, sponsored by, or otherwise connected to Hydra Launcher or
Los Broxas.

Sphinx Launcher is licensed under the [Apache License 2.0](LICENSE),
Copyright 2026 Raka Mahendra. Hydra Launcher was distributed under the MIT
License; its complete original license text is preserved verbatim at
[LICENSES/MIT-hydra.txt](LICENSES/MIT-hydra.txt). See [NOTICE](NOTICE) for the
required attribution.
