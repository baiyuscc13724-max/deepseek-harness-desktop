# WinGet submission

The ready-to-submit manifest set is under:

`winget/manifests/b/Baiyuscc13724Max/HarnessDesktop/1.0.13`

The installer is published in the immutable binary archive:

`https://github.com/baiyuscc13724-max/deepseek-harness-desktop-releases`

The installer SHA-256 is taken from the locally audited `v1.0.13` release artifact. Before submission, publish those exact bytes and `SHA256SUMS.txt` to the immutable binary archive. WinGet requires the hash to match the bytes downloaded from `InstallerUrl` exactly.

## Validate locally

```powershell
winget validate .\winget\manifests\b\Baiyuscc13724Max\HarnessDesktop\1.0.13
```

## Submit after approval

Install Microsoft's manifest tool once:

```powershell
winget install --id Microsoft.WingetCreate --exact --source winget
```

Then submit the version directory:

```powershell
wingetcreate submit .\winget\manifests\b\Baiyuscc13724Max\HarnessDesktop\1.0.13
```

The submit command opens or updates a public pull request in `microsoft/winget-pkgs` and may prompt for GitHub authorization. Do not submit until the publisher approves the public metadata and package identifier.

For future versions, publish a new semantic-versioned release in `deepseek-harness-desktop-releases`; never replace or delete a published asset. Copy the manifest version directory, update `PackageVersion`, release URLs, release notes, and the SHA-256 from the new release's published checksum file, then validate again.
