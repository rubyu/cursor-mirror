using System.Runtime.Serialization;

namespace CursorMirror
{
    [DataContract]
    public sealed class CalibrationSummary
    {
        [DataMember(Order = 1)]
        public int FrameCount { get; set; }

        [DataMember(Order = 2)]
        public int DarkFrameCount { get; set; }

        [DataMember(Order = 3)]
        public int BaselineDarkBoundsWidth { get; set; }

        [DataMember(Order = 4)]
        public int BaselineDarkBoundsHeight { get; set; }

        [DataMember(Order = 5)]
        public double AverageEstimatedSeparationPixels { get; set; }

        [DataMember(Order = 6)]
        public double P95EstimatedSeparationPixels { get; set; }

        [DataMember(Order = 7)]
        public double MaximumEstimatedSeparationPixels { get; set; }

        [DataMember(Order = 8)]
        public string CaptureSource { get; set; }

        [DataMember(Order = 9)]
        public CalibrationPatternSummary[] PatternSummaries { get; set; }

        [DataMember(Order = 10)]
        public string RuntimeMode { get; set; }

        [DataMember(Order = 11)]
        public long PredictionInvalidDwmHorizon { get; set; }

        [DataMember(Order = 12)]
        public long PredictionLateDwmHorizon { get; set; }

        [DataMember(Order = 13)]
        public long PredictionHorizonOver125xRefreshPeriod { get; set; }

        [DataMember(Order = 14)]
        public long PredictionFallbackToHold { get; set; }

        [DataMember(Order = 15)]
        public long PredictionResetDueToInvalidDtOrIdleGap { get; set; }

        [DataMember(Order = 16)]
        public long PredictionStalePollSamples { get; set; }

        [DataMember(Order = 17)]
        public long PredictionScheduledDwmTargetUsed { get; set; }

        [DataMember(Order = 18)]
        public long PredictionScheduledDwmTargetAdjustedToNextVBlank { get; set; }

        [DataMember(Order = 19)]
        public long PredictionOverlayUpdateCompletedAfterTargetVBlank { get; set; }

        [DataMember(Order = 20)]
        public long PredictionOverlayUpdateCompletedNearTargetVBlank { get; set; }

        [DataMember(Order = 21)]
        public int DwmPredictionTargetOffsetMilliseconds { get; set; }

        [DataMember(Order = 22)]
        public int DwmPredictionHorizonCapMilliseconds { get; set; }

        [DataMember(Order = 23)]
        public int DwmPredictionModel { get; set; }

        [DataMember(Order = 24)]
        public long PredictionExperimentalMlpSkippedByRecentSpeed { get; set; }

        [DataMember(Order = 25)]
        public long PredictionExperimentalMlpSkippedByPathSpeed { get; set; }

        [DataMember(Order = 26)]
        public long PredictionExperimentalMlpEvaluated { get; set; }

        [DataMember(Order = 27)]
        public long PredictionExperimentalMlpRejected { get; set; }

        [DataMember(Order = 28)]
        public long PredictionExperimentalMlpApplied { get; set; }
    }
}
