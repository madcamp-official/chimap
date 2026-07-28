# CHIMap mobile branding assets

The repository-root `app_icon.png` is the canonical user-provided source and must not be overwritten. The generated Android assets are:

- `app-icon.png`: opaque 1024×1024 regular icon on white.
- `app-icon-foreground.png`: transparent 1024×1024 adaptive foreground, with the symbol constrained to the central safe zone.
- `app-icon-monochrome.png`: alpha-preserving monochrome silhouette for themed icons.
- `splash-icon.png`: opaque 1024×1024 white splash artwork with the symbol and CHIMap wordmark.

ImageGen source prompts preserved the orange pin/footprints and green leaf, removed the original tile/corners for adaptive use, and created the white symbol-plus-wordmark splash. The foreground was extracted from the clean white splash master, then centered at a maximum 614×614 symbol bound. Circle, squircle, rounded-square, and monochrome themed previews were checked before commit.
