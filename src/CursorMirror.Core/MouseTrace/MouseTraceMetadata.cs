using System.Runtime.Serialization;

namespace CursorMirror.MouseTrace
{
    [DataContract]
    public sealed class MouseTraceMetadata
    {
        [DataMember(Order = 1)]
        public string ProductName { get; set; }

        [DataMember(Order = 2)]
        public string ProductVersion { get; set; }

        [DataMember(Order = 3)]
        public string CreatedUtc { get; set; }

        [DataMember(Order = 4)]
        public int SampleCount { get; set; }

        [DataMember(Order = 5)]
        public long DurationMicroseconds { get; set; }

        [DataMember(Order = 6)]
        public string StopwatchFrequency { get; set; }
    }
}
