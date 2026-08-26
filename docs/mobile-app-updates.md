# Independent mobile app updates

Android and iOS/iPadOS releases are checked independently from Harness Desktop and from Desktop component updates. The clients accept one small HTTPS JSON manifest using the contract in `mobile/mobile-app-update.example.json`. Android uses the repository-owned `mobile/mobile-app-update.json` channel by default; it starts at version `0.0.0` (no update) and is advanced only after a separately approved, signed mobile release exists.

## Independent mobile release gate

- `mobile/android/app/version.properties` binds every Android build to the current three-part Desktop integration version. Android may add one numeric revision component (for example `1.0.46.1`) for a standalone signed hotfix; the shared monotonic encoder keeps both full and standalone `versionCode` values upgrade-safe.
- A three-part full product release keeps Android, Desktop and iOS/iPadOS on one visible version and publishes the APK/checksum inside the immutable `v<version>` release. iOS/iPadOS keeps an Apple-compatible build code and remains simulator-validated.
- Only a four-part standalone Android revision uses its own immutable `android-v<version>` tag and exactly one signed APK plus its checksum, with `make_latest=false` so the Desktop `releases/latest` identity remains unchanged. The dedicated workflow must verify the long-lived release certificate fingerprint; a debug or unsigned APK never qualifies. The user has chosen not to join Apple Developer Program, so no IPA is claimed.

## Desktop QR routing without an Apple membership

- The same Desktop QR remains OS-neutral. Android system cameras are redirected to the verified signed APK, while the installed Android app consumes the pairing payload directly.
- iPhone/iPad system cameras receive a local setup page that never redirects to an APK. With no App Store/TestFlight release, the primary action pairs and opens the official workbench in Safari and explains “Add to Home Screen”; an already installed native client can still consume the same payload.
- The Safari workbench provides live WebSocket synchronization while the page is foregrounded on the same LAN. iOS may suspend it in the background, and it does not claim the native app's encrypted WSS/443 remote fallback.
- A future reviewed App Store/TestFlight URL can be enabled without ever distributing an unsigned IPA. A desktop-style helper cannot replace Apple code signing or the App Store/TestFlight installation rules, so the current no-membership path remains Safari + “Add to Home Screen” rather than a misleading sideload installer.

## Platform routing and installation

- Android reads only `platforms.android`, requires a newer numeric version, an HTTPS `.apk` URL without embedded credentials, and a 64-character SHA-256 value. The app downloads that Android asset into private cache, verifies the manifest SHA-256 and that the APK package/signing identity matches the installed app, then hands the verified file to Android's package installer. The installer still requires user confirmation. It never sends an IPA to Android and never silently installs an APK.
- iPhone and iPad read only `platforms.ios`. The URL must be on `apps.apple.com` or `testflight.apple.com`. The app opens Apple’s installer UI and never downloads or installs an IPA itself.
- A required update can make the prompt non-dismissible, but it still cannot bypass Android installation confirmation or Apple’s App Store/TestFlight rules.

## Build-time configuration

Android:

```text
./gradlew assembleRelease -PHARNESS_MOBILE_UPDATE_MANIFEST_URL=https://updates.example/mobile-app-update.json
```

iOS/iPadOS: set `HarnessMobileUpdateManifestURL` in the generated Info.plist through the reviewed release configuration. Keep it empty for local/private builds that must not contact a production feed.

Publishing the manifest, APK, App Store build, TestFlight build, push notification, or public Release is a separate release action and is not performed by the private validation workflow.
