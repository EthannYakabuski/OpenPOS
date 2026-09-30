# OpenPOS project guidance

This repository implements the project brief preserved in `docs/project-brief.md`. Future work must continue to honor its acceptance criteria unless the user explicitly changes them.

## Product and stack

- Windows 10 x64 or newer; Electron, TypeScript, React, Webpack, Yarn Classic, NSIS.
- Prioritize quick, legible daily work on mouse and touch screens. Use Material Design Icons and keep the app independent of remote assets.
- Keep a wide menu pane and a narrower current-order pane. Support pizza variants and ordinary retail units equally.
- Use JSON for business data, NDJSON for events, and a narrow context-isolated preload API. Do not expose Node or arbitrary filesystem operations to the renderer.

## Data invariants

- Money is integer cents; tax is a percentage. The backend is the source of truth for prices, recipes, totals and validation.
- Saved order lines retain historical prices and ingredient recipes. Completion applies inventory once; editing a completed order applies the difference; cancellation reverses consumed inventory.
- Keep changes serialized, recoverable and revision checked. Never replace malformed existing data with demo data.
- The master owns shared state. Clients submit authenticated commands and do not write offline or merge their demo stores into a master.
- Staff may take, edit and complete orders. Protect reports, menu maintenance, stock maintenance and configuration at the trusted service boundary.
- Development uses `.dev-data`; packaged/default launches use the current Windows user's `.openpos`. Tests use isolated temporary data. Do not modify a user's real business data for development or testing.

## Verification and documentation

- Use Node 22.12+ or 24 LTS (below 25) and Yarn 1.22.22. `yarn typecheck`, `yarn test`, `yarn build`, and `yarn test:e2e` form the verification sequence; `yarn dist` builds the installer.
- Add meaningful unit/integration tests for new business behavior and cover representative desktop workflows. Avoid tests that merely restate implementation details.
- Update the business handbook (`docs/help.html`), architecture (`docs/architecture.html`), implementation decisions (`docs/implementation.html`), acceptance map and README when behavior changes.
- Bundle only the business handbook and its local stylesheet. Keep developer diagrams, implementation notes, sales collateral and original prompts in the source repository.
- Document assumptions and resolve routine choices autonomously. Be explicit about untested hardware, unsigned distribution, payment integration boundaries and deployment limits.
- Preserve the Apache 2.0 license and unrelated user changes.
