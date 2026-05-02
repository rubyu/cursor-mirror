namespace CursorMirror
{
    public sealed class CursorPredictionCounters
    {
        public long InvalidDwmHorizon { get; set; }

        public long LateDwmHorizon { get; set; }

        public long HorizonOver125xRefreshPeriod { get; set; }

        public long FallbackToHold { get; set; }

        public long PredictionResetDueToInvalidDtOrIdleGap { get; set; }

        public long StalePollSamples { get; set; }

        public void Reset()
        {
            InvalidDwmHorizon = 0;
            LateDwmHorizon = 0;
            HorizonOver125xRefreshPeriod = 0;
            FallbackToHold = 0;
            PredictionResetDueToInvalidDtOrIdleGap = 0;
            StalePollSamples = 0;
        }
    }
}
