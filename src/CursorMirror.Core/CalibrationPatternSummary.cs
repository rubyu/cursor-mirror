using System.Runtime.Serialization;

namespace CursorMirror
{
    [DataContract]
    public sealed class CalibrationPatternSummary
    {
        [DataMember(Order = 1)]
        public string PatternName { get; set; }

        [DataMember(Order = 2)]
        public int FrameCount { get; set; }

        [DataMember(Order = 3)]
        public int DarkFrameCount { get; set; }

        [DataMember(Order = 4)]
        public double AverageEstimatedSeparationPixels { get; set; }

        [DataMember(Order = 5)]
        public double P95EstimatedSeparationPixels { get; set; }

        [DataMember(Order = 6)]
        public double MaximumEstimatedSeparationPixels { get; set; }
    }
}
