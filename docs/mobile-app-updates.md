# Independent mobile app updates

Android and iOS/iPadOS releases are checked independently from Harness Desktop and from Desktop component updates. The clients accept one small HTTPS JSON manifest using the contract in `mobile/mobile-app-update.example.json`, but the production endpoint is intentionally empty until a separately approved mobile release exists.

## Synchronized mobile release gate

- Android and iOS/iPadOS source versions are prepared together and must equal the current integration version; `tests/mobile-version-sync.test.cjs` rejects one-platform-only version drift.
- The mobile update manifest must carry both `platforms.android` and `platforms.ios` at the same version before either production endpoint is enabled.
- The 1.0.26 Android release is published only after the dedicated workflow verifies the long-lived release certificate fingerprint; a debug or unsigned APK never qualifies. The user has chosen not to join Apple Developer Program, so iOS/iPadOS source remains simulator-validated without claiming an installable IPA.

## Desktop QR routing without an Apple membership

- The same Desktop QR remains OS-neutral. Android system cameras are redirected to the verified signed APK, while the installed Android app consumes the pairing payload directly.
- iPhone/iPad system cameras receive a local setup page that never redirects to an APK. With no App Store/TestFlight release, the primary action pairs and opens the official workbench in Safari and explains “Add to Home Screen”; an already installed native client can still consume the same payload.
- The Safari workbench provides live WebSocket synchronization while the page is foregrounded on the same LAN. iOS may suspend it in the background, and it does not claim the native app's encrypted WSS/443 remote fallback.
- A future reviewed App Store/TestFlight URL can be enabled without ever distributing an unsigned IPA.

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
