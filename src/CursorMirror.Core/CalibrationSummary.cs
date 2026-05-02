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
    }
}
