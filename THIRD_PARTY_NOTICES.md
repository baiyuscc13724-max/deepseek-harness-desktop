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

## node-pty

`node-pty` is licensed under the MIT License. Harness Desktop does not implement a separate native terminal, but the bundled official DeepSeek Harness dependency graph uses `node-pty` for its own local subprocess support. Its native binary is rebuilt for Electron and unpacked from ASAR.
