# Yachiyo VTube Studio Control Audit

Generated: 2026-05-29T15:09:33.126Z

## VTS Control Contract

VTube Studio separates controllable inputs from Live2D model outputs:

- `InjectParameterDataRequest` writes VTS input parameters.
- `ParameterCreationRequest` creates plugin-owned custom input parameters.
- `.vtube.json` `ParameterSettings` maps each input parameter to one `OutputLive2D` parameter.
- Expression files and `ExpressionActivationRequest` should own expression-only parameters.

For this model, the app creates custom input parameters with the same names as selected Live2D outputs. The installer writes one-to-one mappings from those custom inputs to the model outputs, so the runtime bridge can drive upper-body, accessories, mouth detail, and eye detail without relying on opaque VTS tracking presets. `ParamExpression_*`, `ParamHide_*`, and direct eye-open outputs are intentionally excluded to avoid expression overlap bugs.

## Local Model Files

- CDI: `E:\visualstudio\yachiyo-live2d-studio\models\tsukimi-yachiyo\tsukimi-yachiyo.cdi3.json`
- VTube: `E:\visualstudio\yachiyo-live2d-studio\models\tsukimi-yachiyo\tsukimi-yachiyo.vtube.json`
- CDI parameters: 796
- VTS ParameterSettings: 122
- Desired Yachiyo direct mappings: 98
- Installed Yachiyo mappings: 98

## Desired Control Domains

| Domain | Count | Examples |
| --- | --- | --- |
| body-depth | 1 | ParamPosition_Z |
| body-input | 5 | ParamBodyInput_BodyX, ParamBodyInput_BodyY, ParamBodyInput_BodyZ, ParamBodyInput_ChestZ, ParamBodyInput_HipZ |
| body-output | 6 | ParamOutput_BodyX, ParamOutput_BodyY, ParamOutput_BodyZ, ParamOutput_ChestZ, ParamOutput_HipZ |
| body-switch | 5 | ParamSwitchCtrl_BodyX, ParamSwitchCtrl_BodyY, ParamSwitchCtrl_BodyZ, ParamSwitchCtrl_ChestZ, ParamSwitchCtrl_HipZ |
| cheongsam-physics | 5 | ParamCheongsamPhysics_X1, ParamCheongsamPhysics_X2, ParamCheongsamPhysics_X3, ParamCheongsamPhysics_X4, ParamCheongsamPhysics_X5 |
| doll-ear-physics | 8 | ParamDollEarPhysics_L1, ParamDollEarPhysics_L2, ParamDollEarPhysics_L3, ParamDollEarPhysics_L4, ParamDollEarPhysics_R1 |
| ear-physics | 12 | ParamEarPhysics_L1, ParamEarPhysics_L2, ParamEarPhysics_L3, ParamEarPhysics_L4, ParamEarPhysics_R1 |
| ear-shape | 6 | ParamEarShape_L1, ParamEarShape_L2, ParamEarShape_L3, ParamEarShape_R1, ParamEarShape_R2 |
| eye-detail | 4 | ParamEyeBallX2, ParamEyeBallY2, ParamEyeBallX3, ParamEyeBallY3 |
| hat-ear | 6 | ParamHatEar_L1, ParamHatEar_L2, ParamHatEar_L3, ParamHatEar_R1, ParamHatEar_R2 |
| hat-physics | 8 | ParamHatPhysics_X1, ParamHatPhysics_X2, ParamHatPhysics_X3, ParamHatPhysics_X4, ParamHatPhysics_Y1 |
| mouth-detail | 3 | ParamMouthX2, ParamMouthShape, ParamCheekPuff2 |
| secondary-physics | 3 | ParamHairFront, ParamHairSide, ParamHairBack |
| tongue | 1 | ParamTongueOut_BS |
| tongue-physics | 4 | ParamTonguePhysics_X1, ParamTonguePhysics_X2, ParamTonguePhysics_Y1, ParamTonguePhysics_Y2 |
| upper-body | 13 | ParamAngle_BodyX, ParamAngle_BodyX2, ParamAngle_BodyX3, ParamAngle_BodyY, ParamAngle_BodyY2 |
| wing-physics | 8 | ParamWingPhysics_L1, ParamWingPhysics_L2, ParamWingPhysics_L3, ParamWingPhysics_L4, ParamWingPhysics_R1 |

## Missing From Local VTube Mapping

_None._

## Missing From CDI

_None._

## Stale Yachiyo Mappings

_None._

## Safety Checks

- Direct expression/eye-open mappings in registry: 0
- Expression files should remain the owner of ParamExpression_* and eye-hide parameters to avoid overlapping eyes.
- Direct registry focuses on upper-body, secondary eye/mouth detail, accessories, and physics helpers.

## Live VTS Probe

- Current model: 八千代辉夜姬
- VTS input parameters visible: 225
- VTS Live2D parameters visible: 796

### Desired Input Owner Groups

| Owner | Count |
| --- | --- |
| Yachiyo Live2D Studio | 58 |
| Yachiyo Live2D Studio Audit | 40 |

### Missing Live2D Outputs In Running VTS

_None._

### Missing VTS Input Parameters In Running VTS

_None._

## Recommended Fix Flow

1. Run `npm run install:yachiyo-vts-parameters -- <path-to-model.vtube.json>` for the exact model loaded in VTS.
2. Restart or reload the model in VTube Studio.
3. Start this app with VTS output enabled so the bridge creates custom inputs through `ParameterCreationRequest`.
4. Re-run this audit with `--probe` and confirm missing mapping/input counts are zero or intentionally ignored.

