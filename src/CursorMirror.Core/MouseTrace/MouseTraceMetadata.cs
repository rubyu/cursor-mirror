using System.Runtime.Serialization;

namespace CursorMirror.MouseTrace
{
    [DataContract]
    public sealed class MouseTraceMetadata
    {
        [DataMember(Order = 1)]
        public int TraceFormatVersion { get; set; }

        [DataMember(Order = 2)]
        public string ProductName { get; set; }

        [DataMember(Order = 3)]
        public string ProductVersion { get; set; }

        [DataMember(Order = 4)]
        public string CreatedUtc { get; set; }

        [DataMember(Order = 5)]
        public int SampleCount { get; set; }

        [DataMember(Order = 6)]
        public int HookSampleCount { get; set; }

        [DataMember(Order = 7)]
        public int PollSampleCount { get; set; }

        [DataMember(Order = 8)]
        public int DwmTimingSampleCount { get; set; }

        [DataMember(Order = 9)]
        public int PollIntervalMilliseconds { get; set; }

        [DataMember(Order = 10)]
        public long DurationMicroseconds { get; set; }

        [DataMember(Order = 11)]
        public string StopwatchFrequency { get; set; }
    }
}
