# Game Broadcast UI Design QA

## Evidence

- Source visual truth: `C:\Users\lenovo\AppData\Local\Temp\yachiyo-game-ui-qa\chat-reference-1280x720.jpg`
- Implementation screenshot: `C:\Users\lenovo\AppData\Local\Temp\yachiyo-game-ui-qa\game-implementation-1280x720.jpg`
- Side-by-side comparison: `C:\Users\lenovo\AppData\Local\Temp\yachiyo-game-ui-qa\scene-comparison-2560x720.jpg`
- Viewport: 1280 x 720 CSS pixels, desktop 16:9.
- Pixel normalization: each source capture is 1280 x 720 pixels at the same browser viewport and density; the comparison is a lossless side-by-side placement at 2560 x 720 with no scaling.
- State: chat scene idle versus game scene idle before a game window is selected.

## Findings

- No remaining P0, P1, or P2 findings.
- Fonts and typography: the scene switcher, capture instructions, and status controls inherit the existing studio font stack and optical weights. Hierarchy and truncation remain consistent with the chat scene.
- Spacing and layout rhythm: the existing navigation rail and control console keep their dimensions. The game stage remains the dominant region, while the Live2D model, caption, and empty-state instructions occupy separate safe zones.
- Colors and visual tokens: new controls reuse the existing cyan active state, dark panels, border opacity, corner radii, and elevation treatment. Contrast remains readable against both the empty canvas and future game video.
- Image quality and asset fidelity: the Live2D canvas is reused without raster substitution. Game content is rendered from the native display-capture video stream. All new interface icons come from the existing icon library.
- Copy and content: scene names, capture instructions, audio behavior, fit modes, replacement, and stop actions are explicit and concise.

## Focused Region Comparison

The stage header, empty game-capture state, Live2D主播位, and caption safe area were inspected at full resolution. Additional crops were unnecessary because all new text and controls were readable in the 1280 x 720 capture.

## Comparison History

1. Initial P2: the Live2D model overlapped the centered empty-state instructions in game mode.
2. Fix: shifted empty-state content into the left safe zone, reduced its maximum copy width, and reduced the game-mode model footprint to `min(21vw, 350px)` by `min(62vh, 610px)`.
3. Post-fix evidence: the final 1280 x 720 comparison shows clear separation between instructions, Live2D主播位, caption, and control console.

## Interaction Verification

- Chat and game scene buttons update their pressed states.
- The game-capture component remains mounted while hidden in chat mode, so an active stream is not discarded by scene switching.
- The selected scene survives a page reload.
- Game capture lifecycle, 60fps target constraints, muted preview, track-ended handling, and cleanup pass automated tests.
- The actual system window picker was not opened during automated visual QA because it requires the user's explicit window selection.
- Browser console errors checked: none.

## Follow-up Polish

- P3: after the user supplies a representative game window, the model scale and caption width can be tuned per game HUD if desired.

final result: passed
