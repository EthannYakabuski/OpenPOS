# OpenPOS project guidance

This repository implements the project brief preserved in `docs/project-brief.md`. Future work must continue to honor its acceptance criteria unless the user explicitly changes them.

## Product and stack

- Windows 10 x64 or newer; Electron, TypeScript, React, Webpack, Yarn Classic, NSIS.
- Android is a Capacitor connected client in the same repository (`apps/android`, `src/android`), reusing the React interface and shared contracts. Preserve the Windows application and its build; avoid separate business-rule implementations.
- Android tablets support daily ordering; phones use responsive owner and staff screens. The Windows master remains required. Do not imply standalone Android operation, offline writes or internet/cloud access.
- Prioritize quick, legible daily work on mouse and touch screens. Use Material Design Icons and keep the app independent of remote assets.
- Keep a wide menu pane and a narrower current-order pane. Support pizza variants and ordinary retail units equally.
- Use JSON for business data, NDJSON for events, and a narrow context-isolated preload API. Do not expose Node or arbitrary filesystem operations to the renderer.

## Data invariants

- Money is integer cents; tax is a percentage. The backend is the source of truth for prices, recipes, totals and validation.
- Saved order lines retain historical prices and ingredient recipes. Completion applies inventory once; editing a completed order applies the difference; cancellation reverses consumed inventory.
- Keep changes serialized, recoverable and revision checked. Never replace malformed existing data with demo data.
- The master owns shared state. Clients submit authenticated commands and do not write offline or merge their demo stores into a master.
- Keep Android connection secrets in the native secure-storage boundary; do not expose the stored shared key through renderer snapshots or logs. Keep Android network requests restricted to the configured private-LAN master and preserve authentication, replay and revision checks.
- Staff may take, edit and complete orders. Protect reports, menu maintenance, stock maintenance and configuration at the trusted service boundary.
- Development uses `.dev-data`; packaged/default launches use the current Windows user's `.openpos`. Tests use isolated temporary data. Do not modify a user's real business data for development or testing.

## Verification and documentation

- Use Node 22.12+ or 24 LTS (below 25) and Yarn 1.22.22. `yarn typecheck`, `yarn test`, `yarn build`, and `yarn test:e2e` form the verification sequence; `yarn dist` builds the installer.
- For Android, build shared assets with `yarn build:android` and synchronize with `yarn android:sync`; use JDK 21 and the pinned native Gradle/SDK configuration. `yarn android:apk` builds a debug APK; `yarn android:bundle` builds an unsigned AAB. Device/printing/Play release checks must be reported separately from desktop verification.
- Keep upload keystores, passwords and Google service credentials out of the repository. Signing uses external environment values; public pull-request CI must remain unsigned and must not publish. Confirm `org.openpos.mobile` before first publication and preserve the published application ID thereafter.
- Add meaningful unit/integration tests for new business behavior and cover representative desktop workflows. Avoid tests that merely restate implementation details.
- Update the business handbook (`docs/help.html`), architecture (`docs/architecture.html`), implementation decisions (`docs/implementation.html`), acceptance map and README when behavior changes.
- Bundle only the business handbook and its local stylesheet. Keep developer diagrams, implementation notes, sales collateral and original prompts in the source repository.
- Document assumptions and resolve routine choices autonomously. Be explicit about untested hardware, unsigned distribution, payment integration boundaries and deployment limits.
- Preserve the Apache 2.0 license and unrelated user changes.
