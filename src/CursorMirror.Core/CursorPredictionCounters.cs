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

        public long ScheduledDwmTargetUsed { get; set; }

        public long ScheduledDwmTargetAdjustedToNextVBlank { get; set; }

        public long OverlayUpdateCompletedAfterTargetVBlank { get; set; }

        public long OverlayUpdateCompletedNearTargetVBlank { get; set; }

        public long ExperimentalMlpSkippedByRecentSpeed { get; set; }

        public long ExperimentalMlpSkippedByPathSpeed { get; set; }

        public long ExperimentalMlpEvaluated { get; set; }

        public long ExperimentalMlpRejected { get; set; }

        public long ExperimentalMlpApplied { get; set; }

        public CursorPredictionCounters Clone()
        {
            return new CursorPredictionCounters
            {
                InvalidDwmHorizon = InvalidDwmHorizon,
                LateDwmHorizon = LateDwmHorizon,
                HorizonOver125xRefreshPeriod = HorizonOver125xRefreshPeriod,
                FallbackToHold = FallbackToHold,
                PredictionResetDueToInvalidDtOrIdleGap = PredictionResetDueToInvalidDtOrIdleGap,
                StalePollSamples = StalePollSamples,
                ScheduledDwmTargetUsed = ScheduledDwmTargetUsed,
                ScheduledDwmTargetAdjustedToNextVBlank = ScheduledDwmTargetAdjustedToNextVBlank,
                OverlayUpdateCompletedAfterTargetVBlank = OverlayUpdateCompletedAfterTargetVBlank,
                OverlayUpdateCompletedNearTargetVBlank = OverlayUpdateCompletedNearTargetVBlank,
                ExperimentalMlpSkippedByRecentSpeed = ExperimentalMlpSkippedByRecentSpeed,
                ExperimentalMlpSkippedByPathSpeed = ExperimentalMlpSkippedByPathSpeed,
                ExperimentalMlpEvaluated = ExperimentalMlpEvaluated,
                ExperimentalMlpRejected = ExperimentalMlpRejected,
                ExperimentalMlpApplied = ExperimentalMlpApplied
            };
        }

        public void Reset()
        {
            InvalidDwmHorizon = 0;
            LateDwmHorizon = 0;
            HorizonOver125xRefreshPeriod = 0;
            FallbackToHold = 0;
            PredictionResetDueToInvalidDtOrIdleGap = 0;
            StalePollSamples = 0;
            ScheduledDwmTargetUsed = 0;
            ScheduledDwmTargetAdjustedToNextVBlank = 0;
            OverlayUpdateCompletedAfterTargetVBlank = 0;
            OverlayUpdateCompletedNearTargetVBlank = 0;
            ExperimentalMlpSkippedByRecentSpeed = 0;
            ExperimentalMlpSkippedByPathSpeed = 0;
            ExperimentalMlpEvaluated = 0;
            ExperimentalMlpRejected = 0;
            ExperimentalMlpApplied = 0;
        }
    }
}
