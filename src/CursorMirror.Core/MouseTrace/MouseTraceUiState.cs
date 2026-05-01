namespace CursorMirror.MouseTrace
{
    public sealed class MouseTraceUiState
    {
        private MouseTraceUiState(bool startEnabled, bool stopEnabled, bool saveEnabled, bool exitEnabled)
        {
            StartEnabled = startEnabled;
            StopEnabled = stopEnabled;
            SaveEnabled = saveEnabled;
            ExitEnabled = exitEnabled;
        }

        public bool StartEnabled { get; private set; }

        public bool StopEnabled { get; private set; }

        public bool SaveEnabled { get; private set; }

        public bool ExitEnabled { get; private set; }

        public static MouseTraceUiState FromState(MouseTraceState state)
        {
            switch (state)
            {
                case MouseTraceState.Recording:
                    return new MouseTraceUiState(false, true, false, true);
                case MouseTraceState.StoppedWithSamples:
                    return new MouseTraceUiState(true, false, true, true);
                case MouseTraceState.Saved:
                    return new MouseTraceUiState(true, false, false, true);
                default:
                    return new MouseTraceUiState(true, false, false, true);
            }
        }
    }
}
