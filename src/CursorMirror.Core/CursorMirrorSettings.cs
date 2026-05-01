using System;
using System.Runtime.Serialization;

namespace CursorMirror
{
    [DataContract]
    public sealed class CursorMirrorSettings
    {
        public const bool DefaultMovementTranslucencyEnabled = true;
        public const bool DefaultPredictionEnabled = true;
        public const int DefaultMovingOpacityPercent = 70;
        public const int DefaultFadeDurationMilliseconds = 80;
        public const int DefaultIdleDelayMilliseconds = 120;
        public const int DefaultPredictionHorizonMilliseconds = 8;
        public const int DefaultPredictionIdleResetMilliseconds = 100;

        public const int MinimumMovingOpacityPercent = 1;
        public const int MaximumMovingOpacityPercent = 100;
        public const int MinimumFadeDurationMilliseconds = 0;
        public const int MaximumFadeDurationMilliseconds = 300;
        public const int MinimumIdleDelayMilliseconds = 50;
        public const int MaximumIdleDelayMilliseconds = 500;
        public const int MinimumPredictionHorizonMilliseconds = 0;
        public const int MaximumPredictionHorizonMilliseconds = 16;
        public const int MinimumPredictionIdleResetMilliseconds = 1;
        public const int MaximumPredictionIdleResetMilliseconds = 1000;

        public CursorMirrorSettings()
        {
            ApplyDefaults();
        }

        [DataMember(Order = 1)]
        public bool MovementTranslucencyEnabled { get; set; }

        [DataMember(Order = 2)]
        public bool PredictionEnabled { get; set; }

        [DataMember(Order = 3)]
        public int MovingOpacityPercent { get; set; }

        [DataMember(Order = 4)]
        public int FadeDurationMilliseconds { get; set; }

        [DataMember(Order = 5)]
        public int IdleDelayMilliseconds { get; set; }

        [DataMember(Order = 6)]
        public int PredictionHorizonMilliseconds { get; set; }

        [DataMember(Order = 7)]
        public int PredictionIdleResetMilliseconds { get; set; }

        public static CursorMirrorSettings Default()
        {
            return new CursorMirrorSettings();
        }

        public CursorMirrorSettings Clone()
        {
            return new CursorMirrorSettings
            {
                MovementTranslucencyEnabled = MovementTranslucencyEnabled,
                PredictionEnabled = PredictionEnabled,
                MovingOpacityPercent = MovingOpacityPercent,
                FadeDurationMilliseconds = FadeDurationMilliseconds,
                IdleDelayMilliseconds = IdleDelayMilliseconds,
                PredictionHorizonMilliseconds = PredictionHorizonMilliseconds,
                PredictionIdleResetMilliseconds = PredictionIdleResetMilliseconds
            };
        }

        public CursorMirrorSettings Normalize()
        {
            return new CursorMirrorSettings
            {
                MovementTranslucencyEnabled = MovementTranslucencyEnabled,
                PredictionEnabled = PredictionEnabled,
                MovingOpacityPercent = Clamp(MovingOpacityPercent, MinimumMovingOpacityPercent, MaximumMovingOpacityPercent),
                FadeDurationMilliseconds = Clamp(FadeDurationMilliseconds, MinimumFadeDurationMilliseconds, MaximumFadeDurationMilliseconds),
                IdleDelayMilliseconds = Clamp(IdleDelayMilliseconds, MinimumIdleDelayMilliseconds, MaximumIdleDelayMilliseconds),
                PredictionHorizonMilliseconds = Clamp(PredictionHorizonMilliseconds, MinimumPredictionHorizonMilliseconds, MaximumPredictionHorizonMilliseconds),
                PredictionIdleResetMilliseconds = Clamp(PredictionIdleResetMilliseconds, MinimumPredictionIdleResetMilliseconds, MaximumPredictionIdleResetMilliseconds)
            };
        }

        [OnDeserializing]
        private void OnDeserializing(StreamingContext context)
        {
            ApplyDefaults();
        }

        private void ApplyDefaults()
        {
            MovementTranslucencyEnabled = DefaultMovementTranslucencyEnabled;
            PredictionEnabled = DefaultPredictionEnabled;
            MovingOpacityPercent = DefaultMovingOpacityPercent;
            FadeDurationMilliseconds = DefaultFadeDurationMilliseconds;
            IdleDelayMilliseconds = DefaultIdleDelayMilliseconds;
            PredictionHorizonMilliseconds = DefaultPredictionHorizonMilliseconds;
            PredictionIdleResetMilliseconds = DefaultPredictionIdleResetMilliseconds;
        }

        private static int Clamp(int value, int minimum, int maximum)
        {
            return Math.Max(minimum, Math.Min(maximum, value));
        }
    }
}
