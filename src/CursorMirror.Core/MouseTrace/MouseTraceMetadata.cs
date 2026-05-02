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

        [DataMember(Order = 12)]
        public int ReferencePollSampleCount { get; set; }

        [DataMember(Order = 13)]
        public int ReferencePollIntervalMilliseconds { get; set; }

        [DataMember(Order = 14)]
        public int TimerResolutionMilliseconds { get; set; }

        [DataMember(Order = 15)]
        public bool TimerResolutionSucceeded { get; set; }

        [DataMember(Order = 16)]
        public MouseTraceIntervalStats HookMoveIntervalStats { get; set; }

        [DataMember(Order = 17)]
        public MouseTraceIntervalStats ProductPollIntervalStats { get; set; }

        [DataMember(Order = 18)]
        public MouseTraceIntervalStats ReferencePollIntervalStats { get; set; }

        [DataMember(Order = 19)]
        public double DwmTimingAvailabilityPercent { get; set; }

        [DataMember(Order = 20)]
        public string OperatingSystemVersion { get; set; }

        [DataMember(Order = 21)]
        public bool Is64BitOperatingSystem { get; set; }

        [DataMember(Order = 22)]
        public string RuntimeVersion { get; set; }

        [DataMember(Order = 23)]
        public int ProcessorCount { get; set; }

        [DataMember(Order = 24)]
        public int VirtualScreenX { get; set; }

        [DataMember(Order = 25)]
        public int VirtualScreenY { get; set; }

        [DataMember(Order = 26)]
        public int VirtualScreenWidth { get; set; }

        [DataMember(Order = 27)]
        public int VirtualScreenHeight { get; set; }

        [DataMember(Order = 28)]
        public double SystemDpiX { get; set; }

        [DataMember(Order = 29)]
        public double SystemDpiY { get; set; }

        [DataMember(Order = 30)]
        public MouseTraceMonitorMetadata[] Monitors { get; set; }

        [DataMember(Order = 31)]
        public string[] QualityWarnings { get; set; }

        [DataMember(Order = 32)]
        public int RuntimeSchedulerPollSampleCount { get; set; }

        [DataMember(Order = 33)]
        public int RuntimeSchedulerWakeAdvanceMilliseconds { get; set; }

        [DataMember(Order = 34)]
        public int RuntimeSchedulerFallbackIntervalMilliseconds { get; set; }

        [DataMember(Order = 35)]
        public MouseTraceIntervalStats RuntimeSchedulerPollIntervalStats { get; set; }

        [DataMember(Order = 36)]
        public int RuntimeSchedulerCoalescedTickCount { get; set; }
    }

    [DataContract]
    public sealed class MouseTraceIntervalStats
    {
        [DataMember(Order = 1)]
        public int Count { get; set; }

        [DataMember(Order = 2)]
        public double MeanMilliseconds { get; set; }

        [DataMember(Order = 3)]
        public double P50Milliseconds { get; set; }

        [DataMember(Order = 4)]
        public double P95Milliseconds { get; set; }

        [DataMember(Order = 5)]
        public double MaxMilliseconds { get; set; }
    }

    [DataContract]
    public sealed class MouseTraceMonitorMetadata
    {
        [DataMember(Order = 1)]
        public string DeviceName { get; set; }

        [DataMember(Order = 2)]
        public bool Primary { get; set; }

        [DataMember(Order = 3)]
        public int BitsPerPixel { get; set; }

        [DataMember(Order = 4)]
        public int BoundsX { get; set; }

        [DataMember(Order = 5)]
        public int BoundsY { get; set; }

        [DataMember(Order = 6)]
        public int BoundsWidth { get; set; }

        [DataMember(Order = 7)]
        public int BoundsHeight { get; set; }

        [DataMember(Order = 8)]
        public int WorkingAreaX { get; set; }

        [DataMember(Order = 9)]
        public int WorkingAreaY { get; set; }

        [DataMember(Order = 10)]
        public int WorkingAreaWidth { get; set; }

        [DataMember(Order = 11)]
        public int WorkingAreaHeight { get; set; }
    }
}
