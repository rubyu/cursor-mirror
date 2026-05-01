using System;
using System.Runtime.Serialization;

namespace CursorMirror
{
    [DataContract]
    public sealed class DemoSettings
    {
        public const int MinimumDisplayModeIndex = 0;
        public const int MaximumDisplayModeIndex = 3;
        public const int MinimumSpeedIndex = 0;
        public const int MaximumSpeedIndex = 2;

        public DemoSettings()
        {
            ApplyDefaults();
        }

        [DataMember(Order = 1)]
        public string Language { get; set; }

        [DataMember(Order = 2)]
        public int DisplayModeIndex { get; set; }

        [DataMember(Order = 3)]
        public int SpeedIndex { get; set; }

        [DataMember(Order = 4)]
        public bool MirrorCursorEnabled { get; set; }

        [DataMember(Order = 5)]
        public CursorMirrorSettings CursorSettings { get; set; }

        public static DemoSettings Default()
        {
            return new DemoSettings();
        }

        public DemoSettings Clone()
        {
            return new DemoSettings
            {
                Language = Language,
                DisplayModeIndex = DisplayModeIndex,
                SpeedIndex = SpeedIndex,
                MirrorCursorEnabled = MirrorCursorEnabled,
                CursorSettings = CursorSettings == null ? null : CursorSettings.Clone()
            };
        }

        public DemoSettings Normalize()
        {
            return new DemoSettings
            {
                Language = DemoLanguage.Normalize(Language),
                DisplayModeIndex = Clamp(DisplayModeIndex, MinimumDisplayModeIndex, MaximumDisplayModeIndex),
                SpeedIndex = Clamp(SpeedIndex, MinimumSpeedIndex, MaximumSpeedIndex),
                MirrorCursorEnabled = MirrorCursorEnabled,
                CursorSettings = (CursorSettings ?? CursorMirrorSettings.Default()).Normalize()
            };
        }

        [OnDeserializing]
        private void OnDeserializing(StreamingContext context)
        {
            ApplyDefaults();
        }

        private void ApplyDefaults()
        {
            Language = DemoLanguage.Auto;
            DisplayModeIndex = 0;
            SpeedIndex = 0;
            MirrorCursorEnabled = true;
            CursorSettings = CursorMirrorSettings.Default();
        }

        private static int Clamp(int value, int minimum, int maximum)
        {
            return Math.Max(minimum, Math.Min(maximum, value));
        }
    }
}
