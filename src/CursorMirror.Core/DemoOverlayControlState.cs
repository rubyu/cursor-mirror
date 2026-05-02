namespace CursorMirror
{
    public sealed class DemoOverlayControlState
    {
        private DemoOverlayControlState(
            bool overlaySettingsEnabled,
            bool predictionGainEnabled,
            bool movementTranslucencyInputsEnabled,
            bool idleFadeInputsEnabled)
        {
            OverlaySettingsEnabled = overlaySettingsEnabled;
            PredictionGainEnabled = predictionGainEnabled;
            MovementTranslucencyInputsEnabled = movementTranslucencyInputsEnabled;
            IdleFadeInputsEnabled = idleFadeInputsEnabled;
        }

        public bool OverlaySettingsEnabled { get; private set; }
        public bool PredictionGainEnabled { get; private set; }
        public bool MovementTranslucencyInputsEnabled { get; private set; }
        public bool IdleFadeInputsEnabled { get; private set; }

        public static DemoOverlayControlState From(
            bool mirrorCursorEnabled,
            bool predictionEnabled,
            bool movementTranslucencyEnabled,
            bool idleFadeEnabled)
        {
            return new DemoOverlayControlState(
                mirrorCursorEnabled,
                mirrorCursorEnabled && predictionEnabled,
                mirrorCursorEnabled && movementTranslucencyEnabled,
                mirrorCursorEnabled && idleFadeEnabled);
        }
    }
}
