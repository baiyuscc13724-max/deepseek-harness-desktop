# Notes for Microsoft certification

Harness Desktop is a packaged Win32/Electron application with the `runFullTrust` restricted capability. It starts a local DeepSeek Harness web runtime and renders only that loopback workbench inside the application webview.

The application does not require a Harness Desktop account. Generative AI responses require a model provider configured by the reviewer. If certification requires a reviewer-specific provider credential, provide it only through the secure Partner Center certification-notes field; never commit it to this repository.

Suggested test flow:

1. Launch Harness Desktop and wait for the single-line logo animation to finish when the local workbench is ready.
2. Open Settings and configure a supported AI provider and model.
3. Create or select a project, start a session, and submit a short prompt.
4. Open Settings > General. Confirm that the desktop app line says updates are managed by Microsoft Store.
5. Confirm that the Privacy Policy, AI content report, and plugin-content policy links open in the default browser.
6. Confirm that the noncommercial Maid Atelier theme and its desktop pet do not appear in the Microsoft Store package.

Network access is used for the AI provider selected by the reviewer, public package/update metadata, and optional plugin repositories chosen by the user. Local tools and installed plugins can access files with the user's Windows permissions.

This is an independent community client. The Store branding is original and does not use the DeepSeek logo. DeepSeek is named only to identify the compatible open-source runtime.

Reviewer credential placeholder (fill only in Partner Center if requested):

- Provider: __REVIEW_PROVIDER__
- Model: __REVIEW_MODEL__
- Credential delivery: Partner Center secure certification notes only
