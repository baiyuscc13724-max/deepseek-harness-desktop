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

## DSH Plugin Marketplace

`dsh-plugin-marketplace` version 1.2.0 is licensed under the MIT License and is maintained by bradeGithub. Harness Desktop bundles the pinned upstream release and installs it into the user's DSH Web profile so the official Harness settings can display, install, and update community plugins.

Source: https://github.com/bradeGithub/DSH-Plugins-Marketplace

Copyright (c) 2026 bradeGithub

The marketplace lists and can execute installation code from independent third-party repositories. Those repositories retain their own licenses and are not endorsed by Harness Desktop, DeepSeek, or the marketplace author. Users must review and trust a plugin before installing it.

## node-pty

`node-pty` is licensed under the MIT License. Harness Desktop does not implement a separate native terminal, but the bundled official DeepSeek Harness dependency graph uses `node-pty` for its own local subprocess support. Its native binary is rebuilt for Electron and unpacked from ASAR.

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

Attribution chain retained from the upstream NOTICE:

1. 上善 — original whale-girl character design: https://www.pixiv.net/users/62155430
2. zipzip — maid whale-girl redesign with DeepSeek elements, based on 上善's design: https://www.pixiv.net/users/18604994
3. Small-tailqwq — DSH Web skin adaptation distributed by `Small-tailqwq/dsh-deep-whale`

Source: https://github.com/Small-tailqwq/dsh-deep-whale

License: https://creativecommons.org/licenses/by-nc-sa/4.0/
