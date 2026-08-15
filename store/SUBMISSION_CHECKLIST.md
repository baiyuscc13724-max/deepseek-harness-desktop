# Microsoft Store submission checklist

## Already prepared in this repository

- [x] Separate x64 MSIX build flow based on Microsoft's WinApp CLI
- [x] Unsigned Store-ingestion package path; Microsoft Store applies the final signature
- [x] Store-managed desktop update behavior
- [x] Original Store icon and generated Windows tile assets
- [x] Noncommercial Maid Atelier theme and related pet assets excluded from the Store build
- [x] Privacy policy and in-app policy links
- [x] Generative-AI disclosure and reporting route
- [x] Plugin content rules and reporting route
- [x] Chinese and English listing drafts
- [x] Certification test notes

## Complete after Partner Center registration

- [ ] Reserve the product name in Partner Center
- [ ] Copy the exact Package/Identity/Name, Publisher, and Publisher display name into `store/store-identity.json`
- [ ] Run `npm run store:check`
- [ ] Run `npm run store:msix`
- [ ] Install a development-signed build and complete the certification-notes test flow
- [ ] Capture Store screenshots listed in `store/listing/assets/README.md`
- [ ] Publish `docs/PRIVACY.md` at the URL used in the Store listing
- [ ] Fill the age rating accurately, disclosing live generative AI and unrestricted internet access
- [ ] Paste reviewer-only credentials into Partner Center secure certification notes if Microsoft requests them
- [ ] Upload `dist-store/Harness-Desktop-<version>-store-x64.msix`

Never commit `store/store-identity.json`, certificate files, API keys, reviewer credentials, or Partner Center recovery codes.
