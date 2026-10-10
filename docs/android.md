# Android development and release

OpenPOS uses **Capacitor with the existing React interface**. The Android app is a registered client of a Windows master on the shop's trusted private network. It can take and complete orders, and an owner can unlock menu, inventory, settings and reports. It cannot act as a standalone master or save changes offline. Running a local web bundle inside Capacitor does not require hosting the interface on a website.

## Repository layout

- `src/renderer`: shared interface and responsive phone/tablet layouts.
- `src/shared`: common commands, state and platform contracts.
- `src/android`: TypeScript adapter and entry point.
- `apps/android`: native Android Studio/Gradle project and OpenPOS platform bridge.
- `dist/android`: generated web assets, copied by Capacitor sync; not source.
- `src/main` and `src/core`: existing Windows process and authoritative business engine.

Windows remains in its current source location to keep the refactor focused. This is one repository with two native targets, not two copies of the business logic. A JavaScript interface draft is never the authority for stored prices, inventory or permissions.

## Development prerequisites

Use the same Node and Yarn versions as the root README. Install Android Studio and **JDK 21**; set `JAVA_HOME` to the JDK directory. In Android Studio's SDK Manager install **Android SDK Platform 36**, **Build Tools 36.0.0**, and Platform Tools. Set `ANDROID_HOME` to that SDK directory if it is not in the default location. Accept SDK licenses through Android Studio. The checked-in Gradle wrapper manages the project's Gradle version.

The app targets API 36 and requires API 26 (Android 8.0) or newer. The native wrapper requires Android System WebView 111 or newer; keep it updated on supported devices. This target configuration does not itself establish Google Play policy compliance or device compatibility.

```powershell
yarn install --frozen-lockfile
yarn build:android
yarn android:sync
yarn android:open
```

Select a physical Android device or emulator in Android Studio and run the app. The Windows master must be reachable at its private IPv4 address; the Android client's native transport rejects public addresses, hostnames and arbitrary internet destinations. An emulator's networking needs to be arranged so it can reach an allowed private master address. For representative connectivity checks, use a physical phone/tablet on the shop's test Wi-Fi.

Re-run `yarn android:sync` after changing web source or native plugin dependencies. A native Gradle build alone can package stale web assets; the provided APK/AAB scripts synchronize first. These commands do not change Windows business data or publish an app.

## Build outputs

| Command                      | Result                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| `yarn build:android`         | Android-specific web bundle in `dist/android`                                           |
| `yarn android:sync`          | Builds web assets and copies them into the native project                               |
| `yarn android:open`          | Opens the native project in Android Studio                                              |
| `yarn android:apk`           | Debug APK at `apps/android/app/build/outputs/apk/debug/app-debug.apk`                   |
| `yarn android:bundle`        | Unsigned release AAB at `apps/android/app/build/outputs/bundle/release/app-release.aab` |
| `yarn android:bundle:signed` | Release AAB at the same path, signed with supplied upload credentials                   |
| `yarn test:android`          | Native Android unit checks                                                              |

The APK is for development-device testing. The AAB is a publishing package: Google Play generates the installable app for a customer's device after release. An unsigned AAB is useful as a CI build result but **cannot be submitted as a finished Play release**. A debug APK is not a production distribution artifact. [Android App Bundles](https://developer.android.com/guide/app-bundle)

## Signing without repository secrets

Create and safeguard your own upload keystore through Android Studio's **Generate Signed App Bundle / APK** workflow or the Android signing tools. Store it outside the repository and keep an independent protected backup. Never paste keys or passwords into source, Gradle files, command-line arguments, logs or pull requests.

The signed build requires all four environment variables:

| Environment variable             | Value                                              |
| -------------------------------- | -------------------------------------------------- |
| `OPENPOS_ANDROID_KEYSTORE`       | Path to the upload keystore outside the repository |
| `OPENPOS_ANDROID_STORE_PASSWORD` | Keystore password                                  |
| `OPENPOS_ANDROID_KEY_ALIAS`      | Upload key alias                                   |
| `OPENPOS_ANDROID_KEY_PASSWORD`   | Key password                                       |

Provide these from a local secret manager or a protected release job, then run `yarn android:bundle:signed`. The build fails if required signing inputs are absent; it does not generate a production key. Ordinary `yarn android:bundle` strips these signing variables before launching Gradle and intentionally stays unsigned. Do not upload a signed AAB containing testing-only configuration, or distribute an unsigned artifact as a customer build.

Optional version inputs are `OPENPOS_ANDROID_VERSION_CODE` (a positive integer, increased for each Play release) and `OPENPOS_ANDROID_VERSION_NAME` (the display version). The initial application ID is **`org.openpos.mobile`**. Confirm ownership/naming before your first Play publication; the published application ID identifies the app and must remain stable for updates.

An upload key and a Play-managed app-signing key serve different roles. Configure Play App Signing in your developer account and retain the appropriate upload credentials. [Android signing documentation](https://developer.android.com/studio/publish/app-signing)

## Public-repository CI and Google Play

The Android workflow explicitly sets `android-actions/setup-android@v3` to `packages: platform-tools`, then installs `platforms;android-36` and `build-tools;36.0.0`. The action's default includes the deprecated `tools` package, which can fail with `Failed to find package 'tools'` before the application build starts. Modern command-line tools replace that package and are installed separately by the action. This setup failure does not require a secret or a self-hosted runner. After applying the workflow fix, run CI on the updated commit; rerunning an older failed commit still uses its old workflow. See the [action's package input](https://github.com/android-actions/setup-android/tree/v3#additional-packages) and [Android SDK tools documentation](https://developer.android.com/tools).

Public pull-request builds do not need signing credentials, Google Cloud service accounts or Play access. Keep CI read-only and upload only unsigned build/test artifacts. A future signed-release job must be separate, restricted to reviewed trusted code, with protected secret access. Do not expose release secrets to untrusted pull requests or persistent public self-hosted runners. No automatic Play publication is configured here.

When ready to release, complete these owner-managed steps:

1. Confirm application ID and versioning, generate/protect the upload key, and enable the desired Play App Signing setup.
2. Build a signed AAB and test it through Play's testing tracks on representative phones and tablets.
3. Complete the store listing, support contact, privacy policy, Data safety and other current Play Console declarations based on the actual app and deployment. Local-network business data, Android permissions and any later integrations must be described accurately.
4. Check current target API, testing, account and app review requirements; a successful local bundle build is not Play approval.
5. Validate master pairing, permission enforcement, reconnects, background/resume, touch/keyboard behavior, receipt printing and exports with actual shop hardware before production rollout.

The app does not include Firebase, ads, analytics or a Google login requirement. A Google Cloud service account is not needed to build the local APK/AAB. Adding Play publishing automation or other Google integrations later is a separate project choice. [Capacitor Android deployment guide](https://capacitorjs.com/docs/android/deploying-to-google-play)

## Device and security boundaries

See the bundled [business handbook](help.html#android) for pairing instructions. The saved Android connection key is encrypted behind the native Android Keystore boundary and is not returned in renderer snapshots. Every save of device Connection settings must include the full connection key again, including saves by an unlocked administrator. The native bridge enforces this requirement and never treats its stored secret as authorization to change a connection. Ordinary business settings, menu, inventory and reports still use the master administrator password/session, without requiring key re-entry. Once paired, routine signed requests use the stored key. Connection requests are signed and replay-checked by the existing master. The LAN transport uses HTTP; signatures authenticate requests but do not encrypt customer or business information in transit. Use a trusted private network, protect devices, and do not forward the Windows port to the internet. Secure remote access is not implemented.

The Android wrapper disables Capacitor’s generic HTTP and WebView path-changing bridge capabilities. The WebView is limited to bundled local application resources; raw file/content helper URLs are rejected. The dedicated OpenPOS bridge remains the path for LAN communication, printing and exports. Native bridge logging and release WebView debugging are disabled to avoid exposing connection input in diagnostic logs.

Administrator access uses the master password and locks when the app goes into the background. Help opens the bundled handbook through Android’s external application chooser; a browser or HTML viewer must be available to handle the local document. Android offers native system printing for receipts and sharing for CSV reports; specific printer models and receiving apps still require testing. Backups, data-folder access, manual JSON editing and Start fresh belong on the Windows master. Android retains connection setup, not an independent ledger that can be merged back into the shop.

## Native dependency notices

`apps/android/app/src/main/assets/ANDROID-THIRD-PARTY-NOTICES.txt` is bundled in Android artifacts alongside the web dependency notices. It records the resolved native runtime coordinates, source metadata and included license/notice texts. Review and refresh this inventory whenever native dependencies or versions change; copying the current file forward is not a substitute for checking the updated dependency graph.

## Verification record

Run the shared type checks, business tests and desktop regression checks alongside the Android web/native checks when making cross-platform changes. Consult [verification.html](verification.html) for actual executed results. Physical Android hardware, Play publication and production signing are separate release validations; do not infer them from a successful web build.
