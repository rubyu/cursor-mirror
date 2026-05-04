namespace CursorMirror
{
    public sealed class DemoOverlayControlState
    {
        private DemoOverlayControlState(
            bool overlaySettingsEnabled,
            bool predictionModelEnabled,
            bool predictionGainEnabled,
            bool distilledMlpPostStopBrakeEnabled,
            bool movementTranslucencyInputsEnabled,
            bool idleFadeInputsEnabled)
        {
            OverlaySettingsEnabled = overlaySettingsEnabled;
            PredictionModelEnabled = predictionModelEnabled;
            PredictionGainEnabled = predictionGainEnabled;
            DistilledMlpPostStopBrakeEnabled = distilledMlpPostStopBrakeEnabled;
            MovementTranslucencyInputsEnabled = movementTranslucencyInputsEnabled;
            IdleFadeInputsEnabled = idleFadeInputsEnabled;
        }

        public bool OverlaySettingsEnabled { get; private set; }
        public bool PredictionModelEnabled { get; private set; }
        public bool PredictionGainEnabled { get; private set; }
        public bool DistilledMlpPostStopBrakeEnabled { get; private set; }
        public bool MovementTranslucencyInputsEnabled { get; private set; }
        public bool IdleFadeInputsEnabled { get; private set; }

        public static DemoOverlayControlState From(
            bool mirrorCursorEnabled,
            bool predictionEnabled,
            bool movementTranslucencyEnabled,
            bool idleFadeEnabled)
        {
            return From(
                mirrorCursorEnabled,
                predictionEnabled,
                movementTranslucencyEnabled,
                idleFadeEnabled,
                CursorMirrorSettings.DefaultDwmPredictionModel);
        }

        public static DemoOverlayControlState From(
            bool mirrorCursorEnabled,
            bool predictionEnabled,
            bool movementTranslucencyEnabled,
            bool idleFadeEnabled,
            int predictionModel)
        {
            bool predictionInputsEnabled = mirrorCursorEnabled && predictionEnabled;
            return new DemoOverlayControlState(
                mirrorCursorEnabled,
                predictionInputsEnabled,
                predictionInputsEnabled,
                predictionInputsEnabled && predictionModel == CursorMirrorSettings.DwmPredictionModelDistilledMlp,
                mirrorCursorEnabled && movementTranslucencyEnabled,
                mirrorCursorEnabled && idleFadeEnabled);
        }
    }
}
