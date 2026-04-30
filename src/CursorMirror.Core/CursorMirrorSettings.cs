using System;
using System.Runtime.Serialization;

namespace CursorMirror
{
    [DataContract]
    public sealed class CursorMirrorSettings
    {
        public const bool DefaultMovementTranslucencyEnabled = true;
        public const int DefaultMovingOpacityPercent = 70;
        public const int DefaultFadeDurationMilliseconds = 80;
        public const int DefaultIdleDelayMilliseconds = 120;

        public const int MinimumMovingOpacityPercent = 40;
        public const int MaximumMovingOpacityPercent = 100;
        public const int MinimumFadeDurationMilliseconds = 0;
        public const int MaximumFadeDurationMilliseconds = 300;
        public const int MinimumIdleDelayMilliseconds = 50;
        public const int MaximumIdleDelayMilliseconds = 500;

        public CursorMirrorSettings()
        {
            MovementTranslucencyEnabled = DefaultMovementTranslucencyEnabled;
            MovingOpacityPercent = DefaultMovingOpacityPercent;
            FadeDurationMilliseconds = DefaultFadeDurationMilliseconds;
            IdleDelayMilliseconds = DefaultIdleDelayMilliseconds;
        }

        [DataMember(Order = 1)]
        public bool MovementTranslucencyEnabled { get; set; }

        [DataMember(Order = 2)]
        public int MovingOpacityPercent { get; set; }

        [DataMember(Order = 3)]
        public int FadeDurationMilliseconds { get; set; }

        [DataMember(Order = 4)]
        public int IdleDelayMilliseconds { get; set; }

        public static CursorMirrorSettings Default()
        {
            return new CursorMirrorSettings();
        }

        public CursorMirrorSettings Clone()
        {
            return new CursorMirrorSettings
            {
                MovementTranslucencyEnabled = MovementTranslucencyEnabled,
                MovingOpacityPercent = MovingOpacityPercent,
                FadeDurationMilliseconds = FadeDurationMilliseconds,
                IdleDelayMilliseconds = IdleDelayMilliseconds
            };
        }

        public CursorMirrorSettings Normalize()
        {
            return new CursorMirrorSettings
            {
                MovementTranslucencyEnabled = MovementTranslucencyEnabled,
                MovingOpacityPercent = Clamp(MovingOpacityPercent, MinimumMovingOpacityPercent, MaximumMovingOpacityPercent),
                FadeDurationMilliseconds = Clamp(FadeDurationMilliseconds, MinimumFadeDurationMilliseconds, MaximumFadeDurationMilliseconds),
                IdleDelayMilliseconds = Clamp(IdleDelayMilliseconds, MinimumIdleDelayMilliseconds, MaximumIdleDelayMilliseconds)
            };
        }

        private static int Clamp(int value, int minimum, int maximum)
        {
            return Math.Max(minimum, Math.Min(maximum, value));
        }
    }
}
