# Third-Party Notices

Harness Desktop is an independent community project.

## DeepSeek Harness

Source: `deepseek-ai/deepseek-harness`
License: MIT
Copyright (c) 2026 DeepSeek

The application launches and redistributes the pinned `@deepseek-ai/dsh` runtime. The upstream copyright and license notices must be retained where required.

## DeepSeek brand assets

The whale marks in `renderer/assets/deepseek-icon.svg` and `build/icon.png` are derived from the official DeepSeek GitHub logo asset. Brand and trademark rights are separate from open-source software copyright. This community project must not imply official DeepSeek endorsement and distributors are responsible for following the current brand policy.

## Electron

Electron is licensed under the MIT License. See the Electron project for its complete notices.

## electron-builder

electron-builder is licensed under the MIT License. See its upstream project for complete notices.

## cross-spawn

`cross-spawn` is licensed under the MIT License. Harness Desktop uses it to launch the bundled Harness command consistently across supported platforms without routing arguments through a shell.

## Bundled Git for Windows, Git Credential Manager and Git LFS

Windows builds bundle the pinned **MinGit 2.53.0.2** distribution from Git for Windows. Git is licensed under **GPL-2.0-only**; the distribution also contains components under their respective compatible licenses. The original license files remain inside `resources/third_party/mingit`, and the corresponding source for the exact Git for Windows release is available at https://github.com/git-for-windows/git/tree/v2.53.0.windows.2 and from the release's source archives. Harness Desktop does not modify MinGit.

Windows builds also bundle **Git Credential Manager 2.7.0**, licensed under the MIT License. Its original license file remains in the bundled GCM directory. Source: https://github.com/git-ecosystem/git-credential-manager/tree/v2.7.0

Windows builds additionally bundle **Git LFS 3.7.1**, licensed under the MIT License, so repository LFS hooks remain enforceable without a machine-wide installation. The official Windows AMD64 archive is pinned by size and SHA-256, and its original license remains beside `git-lfs.exe`. Source: https://github.com/git-lfs/git-lfs/tree/v3.7.1

Git Credential Manager stores authorized credentials through the operating system's credential store. Harness Desktop never displays or returns passwords, access tokens, browser cookies, one-time codes, or SSH private keys. Windows OpenSSH and `ssh-agent` are detected as operating-system components and are not redistributed by this project.

## Phone sync dependencies

- `http-proxy` is licensed under the MIT License and is used by the desktop phone-sync gateway to forward authenticated HTTP and WebSocket traffic to the loopback Harness runtime.
- `qrcode` is licensed under the MIT License and is used to render one-time local pairing QR codes.
- ZXing and ZXing Android Embedded are licensed under the Apache License 2.0 and are used by the Android companion application to scan pairing QR codes.
- AndroidX libraries are licensed under the Apache License 2.0 and provide the Android application compatibility and refresh UI layers.
- `io.github.webrtc-sdk:android:144.7559.14` packages the WebRTC native SDK under the BSD 3-Clause License. Harness Mobile uses only its peer-connection/DataChannel APIs for application-internal P2P transport and adds no media-capture permission for WebRTC. The app's existing CAMERA permission is limited to QR scanning, and RECORD_AUDIO is not declared. The complete notice is packaged at `assets/licenses/webrtc-BSD-3-Clause-LICENSE.txt`.
- EasyTier is licensed under the Apache License 2.0. Harness Desktop downloads its pinned Windows core on demand, and Harness Mobile bundles the matching Android JNI libraries to preserve the optional legacy remote-sync path.

## DSH Plugin Marketplace

`dsh-plugin-marketplace` version 1.5.5 is licensed under the MIT License and is maintained by bradeGithub. Harness Desktop bundles upstream commit `dfe32cb8620658b55441787725f7f03e0491d15e` and installs it into the user's DSH Web profile so the official Harness settings can display, install, and update community plugins.

Source: https://github.com/bradeGithub/DSH-Plugins-Marketplace

Copyright (c) 2026 bradeGithub

The marketplace lists and can execute installation code from independent third-party repositories. Those repositories retain their own licenses and are not endorsed by Harness Desktop, DeepSeek, or the marketplace author. Users must review and trust a plugin before installing it.

## OpenAI agent skills

Harness Desktop adapts the `imagegen` and `openai-docs` agent skills from `openai/skills` commit `49f948faa9258a0c61caceaf225e179651397431` under the Apache License 2.0.

Source: https://github.com/openai/skills/tree/49f948faa9258a0c61caceaf225e179651397431/skills/.system

The Harness versions are modified to use native Harness tools and security boundaries instead of Codex-specific services. Each redistributed skill retains its complete `LICENSE.txt` and a prominent modification notice. Browser, Computer Use, Visualize, templates, research, plugin-management, office-artifact, and Sites compatibility skills are independent clean-room Harness implementations and do not incorporate OpenAI proprietary plugin payloads or service connectors.

## Integrated terminal dependencies

- `node-pty` is licensed under the MIT License. Harness Desktop uses it to provide the local integrated terminal PTY backend. Its native binary is rebuilt for Electron and unpacked from ASAR.
- `@xterm/xterm` is licensed under the MIT License and renders the integrated terminal in the desktop shell.
- `@xterm/addon-fit` is licensed under the MIT License and keeps the terminal grid synchronized with the desktop panel size.

## dashi-taskboard

Harness Desktop adapts the task-board presentation from `chuspeeism/dashi-taskboard` at commit `f12f473c0049757bd0090be418f9d969a1d91194`.

Source: https://github.com/chuspeeism/dashi-taskboard/tree/f12f473c0049757bd0090be418f9d969a1d91194

License: Apache License 2.0

The Harness Desktop version is modified and limited to an adapted task-board presentation inside the existing Agent Teams workbench. It does not incorporate the upstream server, task database, automation runtime, or application shell. The complete upstream license is retained in `third_party/licenses/dashi-taskboard-Apache-2.0-LICENSE.txt`.

## Built-in open-source theme palettes

Harness Desktop adapts color values from the following open-source themes to the DeepSeek Harness design-token surface. It does not bundle their editor implementations.

- Catppuccin (`catppuccin/palette`) — MIT License; copyright Catppuccin contributors.
- Nord (`nordtheme/nord`) — MIT License; copyright Sven Greb and Nord contributors.
- Dracula (`dracula/dracula-theme`) — MIT License; copyright Dracula Theme contributors.
- Gruvbox (`morhetz/gruvbox`) — MIT/X11 License; copyright Pavel Pertsev and Gruvbox contributors.
- Solarized (`altercation/solarized`) — MIT License; copyright Ethan Schoonover.
- Tokyo Night (`tokyo-night/tokyo-night-vscode-theme`) — MIT License; copyright Tokyo Night contributors.
- Rosé Pine (`rose-pine/rose-pine-theme`) — MIT License; copyright Rosé Pine contributors.

The original repositories remain the authoritative source for their license texts and project notices.

## Deep Whale: Maid Atelier skin

The optional bundled `maid-atelier` artwork is adapted from `Small-tailqwq/dsh-deep-whale` and remains separately licensed under **CC BY-NC-SA 4.0**. It is not relicensed under Harness Desktop's MIT license and must not be used commercially.

The optional desktop pet includes AI-assisted complete-frame animation sequences derived for this project from the attributed `maid-atelier` character design. The generated source poses and resulting character animation remain under the same **CC BY-NC-SA 4.0** terms. No third-party Shimeji character pack or QQ Pet artwork is bundled.

Desktop edge movement and click-through behavior were informed by the MIT-licensed `Sunwood-ai-labs/desktop-pet-mitarashi` project; Harness Desktop does not bundle that project's character artwork.

Desktop Pet Mitarashi source: https://github.com/Sunwood-ai-labs/desktop-pet-mitarashi

Attribution chain retained from the upstream NOTICE:

1. 上善 — original whale-girl character design: https://www.pixiv.net/users/62155430
2. zipzip — maid whale-girl redesign with DeepSeek elements, based on 上善's design: https://www.pixiv.net/users/18604994
3. Small-tailqwq — DSH Web skin adaptation distributed by `Small-tailqwq/dsh-deep-whale`

Source: https://github.com/Small-tailqwq/dsh-deep-whale

License: https://creativecommons.org/licenses/by-nc-sa/4.0/

## PGR Q-version character asset collection

The source FBX models and texture images under `third_party/pgr-q` are character assets supplied by the project maintainer from a separately purchased and authorized asset collection. The project maintainer represents that the collection is authorized for inclusion and redistribution in this repository.

These character assets are **not** covered by Harness Desktop's MIT license. Any downstream reuse must follow the separate asset authorization held by the project maintainer. The source assets are retained outside the packaged application until the optimized desktop-pet runtime models and character selector are completed.

Collection inventory: 19 rigged Q-version FBX characters, 78 texture images, and 39–48 embedded animation clips per character. The full game client, server files, account data, and purchased archive are not included.
