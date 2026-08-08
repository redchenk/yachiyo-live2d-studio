# External Game Layout Design QA

## Evidence

- Source visual truth: `C:\Users\lenovo\AppData\Local\Temp\yachiyo-game-ui-qa\game-implementation-1280x720.jpg`
- Implementation screenshot: `C:\Users\lenovo\AppData\Local\Temp\yachiyo-game-ui-qa\game-external-layout-normalized-1280x720.png`
- Side-by-side comparison: `C:\Users\lenovo\AppData\Local\Temp\yachiyo-game-ui-qa\external-layout-normalized-comparison-2560x720.png`
- Viewport: 1280 x 720 CSS pixels, desktop 16:9.
- Pixel normalization: source and implementation are both 1280 x 720 pixels at the same browser viewport and density. The comparison places them side by side at 2560 x 720 without scaling.
- State: game scene idle with the same AI host control panel visible. The intended difference is the removal of the built-in capture empty state and controls.

## Findings

- No remaining P0, P1, or P2 findings.
- Fonts and typography: the scene switcher, stage status, caption, and control console are unchanged. Removing capture copy leaves no orphaned or mismatched text.
- Spacing and layout rhythm: navigation, stage, control console, Live2D host position, and caption safe area retain the approved dimensions. The former capture instructions are gone, leaving a clean external-game region to the left of the host.
- Colors and visual tokens: the game canvas keeps the existing dark neutral surface and cyan scene state. No new colors, borders, shadows, or decorative layers were introduced.
- Image quality and asset fidelity: the Live2D canvas remains native and unchanged. No game preview, placeholder asset, video element, or approximate capture illustration is rendered.
- Copy and content: all built-in capture instructions and actions were removed. The remaining scene labels and live status match the existing studio vocabulary.

## Focused Region Comparison

The empty game region, the Live2D host boundary, and the caption/model junction were inspected at full 1280 x 720 resolution. A separate crop was not needed because these three surfaces are large and clearly readable in the normalized side-by-side comparison.

## Comparison History

1. The first capture showed the Settings overlay while the source showed the AI host panel. This was a state mismatch rather than a product defect.
2. The Settings overlay was closed and the implementation was recaptured in the same game-idle state as the source.
3. The normalized comparison shows only the intended change: capture controls are removed and the game region is unobstructed. No P0, P1, or P2 issue was found after normalization.

## Interaction Verification

- Chat and game scene buttons still update their pressed states.
- The selected scene still survives a page reload.
- No game-capture component, video element, or display-capture API remains in the live page.
- The Live2D host, captions, navigation, and AI host console remain mounted in game mode.
- Browser console errors checked: none. One existing Vite browser-compatibility warning about `fs` remains unrelated to this change.

## Follow-up Polish

- P3: the exact external game-source crop can be tuned later for a specific title's HUD after the third-party composition is visible.

final result: passed
