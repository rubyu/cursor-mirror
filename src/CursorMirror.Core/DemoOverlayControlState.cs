namespace CursorMirror
{
    public sealed class DemoOverlayControlState
    {
        private DemoOverlayControlState(
            bool overlaySettingsEnabled,
            bool predictionModelEnabled,
            bool predictionGainEnabled,
            bool movementTranslucencyInputsEnabled,
            bool idleFadeInputsEnabled)
        {
            OverlaySettingsEnabled = overlaySettingsEnabled;
            PredictionModelEnabled = predictionModelEnabled;
            PredictionGainEnabled = predictionGainEnabled;
            MovementTranslucencyInputsEnabled = movementTranslucencyInputsEnabled;
            IdleFadeInputsEnabled = idleFadeInputsEnabled;
        }

        public bool OverlaySettingsEnabled { get; private set; }
        public bool PredictionModelEnabled { get; private set; }
        public bool PredictionGainEnabled { get; private set; }
        public bool MovementTranslucencyInputsEnabled { get; private set; }
        public bool IdleFadeInputsEnabled { get; private set; }

        public static DemoOverlayControlState From(
            bool mirrorCursorEnabled,
            bool predictionEnabled,
            bool movementTranslucencyEnabled,
            bool idleFadeEnabled)
        {
            bool predictionInputsEnabled = mirrorCursorEnabled && predictionEnabled;
            return new DemoOverlayControlState(
                mirrorCursorEnabled,
                predictionInputsEnabled,
                predictionInputsEnabled,
                mirrorCursorEnabled && movementTranslucencyEnabled,
                mirrorCursorEnabled && idleFadeEnabled);
        }
    }
}
