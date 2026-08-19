# Independent mobile app updates

Android and iOS/iPadOS releases are checked independently from Harness Desktop and from Desktop component updates. The clients accept one small HTTPS JSON manifest using the contract in `mobile/mobile-app-update.example.json`, but the production endpoint is intentionally empty until a separately approved mobile release exists.

## Synchronized mobile release gate

- Android and iOS/iPadOS source versions are prepared together and must equal the current integration version; `tests/mobile-version-sync.test.cjs` rejects one-platform-only version drift.
- The mobile update manifest must carry both `platforms.android` and `platforms.ios` at the same version before either production endpoint is enabled.
- The 1.0.24 source preparation does not claim a public mobile release: Android still needs the approved release signing identity, while iOS/iPadOS still needs App Store Connect/TestFlight signing and review.

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
