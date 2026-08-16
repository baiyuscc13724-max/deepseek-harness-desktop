# PGR Q-version desktop-pet source assets

This directory contains the source assets selected for the multi-character desktop-pet pipeline:

- 19 rigged Q-version FBX character models;
- 78 matching PNG textures;
- 39–48 embedded animation clips per character;
- common pet-ready actions including stand, walk, touch, click, bed, chair, sofa, talk, tired, gift, hug and reward sequences.

The files were supplied by the project maintainer from a separately purchased and authorized asset collection. They are not covered by the repository's MIT license; see `ASSET_NOTICE.md` and the root `THIRD_PARTY_NOTICES.md`.

`catalog.json` records the stable application id, original source path and audited rig metadata for every character. The original names are preserved so textures continue to resolve correctly.

These source FBX files are intentionally outside `renderer/` and are not included in current installers. The desktop-pet build pipeline should convert selected characters to optimized runtime models and copy only those outputs into the packaged renderer assets.
