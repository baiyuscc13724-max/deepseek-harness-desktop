# Guest Bridge

`guest-bridge` is a small, dependency-free protocol and policy layer for a separately delivered guest-side adapter. It intentionally contains **no VM, system image, SDK, accessibility runtime, credential helper, or permission-bypass code**, and it is not included in the desktop application's packaging allowlist.

Security properties:

- pairing is peer-fingerprint-bound, short-lived, rate-limited, and confirmed with a code shown only on a trusted local surface;
- every operation requires an expiring, peer-bound, least-privilege capability token;
- files are read-only and confined to explicit absolute roots; adapters must reject symbolic-link traversal (`followSymlinks: false`);
- process access exposes bounded listing and `SIGINT`/`SIGTERM` only—no shell or arbitrary spawn;
- logs are bounded and redacted;
- UI access accepts structured element identities only and refuses raw coordinates, scripts, key injection, and sensitive fields;
- Windows UI Automation, Linux AT-SPI/Wayland portal, and macOS Accessibility availability is reported explicitly. Missing system consent degrades to unavailable and is never bypassed.

The embedding host is responsible for displaying the local pairing code, obtaining explicit user authorization, implementing the small adapter interfaces, and preserving the operating system's authorization checks.
