using System;
using System.Runtime.Serialization;

namespace CursorMirror
{
    [DataContract]
    public sealed class CursorMirrorSettings
    {
        public const int CurrentSettingsSchemaVersion = 1;
        public const bool DefaultMovementTranslucencyEnabled = true;
        public const bool DefaultPredictionEnabled = true;
        public const bool DefaultIdleFadeEnabled = true;
        public const int DefaultMovingOpacityPercent = 20;
        public const int DefaultFadeDurationMilliseconds = 100;
        public const int DefaultIdleDelayMilliseconds = 100;
        public const int DefaultIdleFadeDurationMilliseconds = 300;
        public const int DefaultIdleFadeDelayMilliseconds = 3000;
        public const int DefaultIdleOpacityPercent = 10;
        public const int DefaultPredictionHorizonMilliseconds = 8;
        public const int DefaultPredictionIdleResetMilliseconds = 100;
        public const int DefaultPredictionGainPercent = 100;
        public const int DefaultDwmPredictionHorizonCapMilliseconds = 10;
        public const bool DefaultDwmAdaptiveGainEnabled = false;
        public const int DefaultDwmAdaptiveGainPercent = 100;
        public const int DefaultDwmAdaptiveMinimumSpeedPixelsPerSecond = 1500;
        public const int DefaultDwmAdaptiveMaximumAccelerationPixelsPerSecondSquared = 40000;
        public const int DefaultDwmAdaptiveReversalCooldownSamples = 0;
        public const int DefaultDwmAdaptiveStableDirectionSamples = 0;
        public const int DefaultDwmAdaptiveOscillationWindowSamples = 0;
        public const int DefaultDwmAdaptiveOscillationMinimumReversals = 2;
        public const int DefaultDwmAdaptiveOscillationMaximumSpanPixels = 450;
        public const int DefaultDwmAdaptiveOscillationMaximumEfficiencyPercent = 55;
        public const int DefaultDwmAdaptiveOscillationLatchMilliseconds = 0;
        public const int DwmPredictionModelConstantVelocity = 0;
        public const int DefaultDwmPredictionModel = DwmPredictionModelConstantVelocity;
        public const int DwmPredictionTargetOffsetDisplayOriginMilliseconds = 8;
        public const int DefaultDwmPredictionTargetOffsetDisplayMilliseconds = 0;
        public const int DefaultDwmPredictionTargetOffsetMilliseconds =
            DwmPredictionTargetOffsetDisplayOriginMilliseconds + DefaultDwmPredictionTargetOffsetDisplayMilliseconds;
        public const bool DefaultRuntimeSetWaitableTimerExEnabled = true;
        public const int DefaultRuntimeFineWaitAdvanceMicroseconds = 2000;
        public const int DefaultRuntimeFineWaitYieldThresholdMicroseconds = 100;
        public const bool DefaultRuntimeMessageDeferralEnabled = true;
        public const int DefaultRuntimeMessageDeferralMicroseconds = 100;
        public const bool DefaultRuntimeThreadLatencyProfileEnabled = true;

        public const int MinimumMovingOpacityPercent = 1;
        public const int MaximumMovingOpacityPercent = 100;
        public const int MinimumFadeDurationMilliseconds = 0;
        public const int MaximumFadeDurationMilliseconds = 300;
        public const int MinimumIdleDelayMilliseconds = 50;
        public const int MaximumIdleDelayMilliseconds = 500;
        public const int MinimumIdleFadeDurationMilliseconds = MinimumFadeDurationMilliseconds;
        public const int MaximumIdleFadeDurationMilliseconds = MaximumFadeDurationMilliseconds;
        public const int MinimumIdleFadeDelayMilliseconds = 0;
        public const int MaximumIdleFadeDelayMilliseconds = 60000;
        public const int MinimumIdleOpacityPercent = 0;
        public const int MaximumIdleOpacityPercent = 99;
        public const int MinimumPredictionHorizonMilliseconds = 0;
        public const int MaximumPredictionHorizonMilliseconds = 16;
        public const int MinimumPredictionIdleResetMilliseconds = 1;
        public const int MaximumPredictionIdleResetMilliseconds = 1000;
        public const int MinimumPredictionGainPercent = 50;
        public const int MaximumPredictionGainPercent = 150;
        public const int MinimumDwmPredictionHorizonCapMilliseconds = 0;
        public const int MaximumDwmPredictionHorizonCapMilliseconds = 16;
        public const int MinimumDwmAdaptiveGainPercent = 50;
        public const int MaximumDwmAdaptiveGainPercent = 150;
        public const int MinimumDwmAdaptiveMinimumSpeedPixelsPerSecond = 0;
        public const int MaximumDwmAdaptiveMinimumSpeedPixelsPerSecond = 10000;
        public const int MinimumDwmAdaptiveMaximumAccelerationPixelsPerSecondSquared = 0;
        public const int MaximumDwmAdaptiveMaximumAccelerationPixelsPerSecondSquared = 1000000;
        public const int MinimumDwmAdaptiveReversalCooldownSamples = 0;
        public const int MaximumDwmAdaptiveReversalCooldownSamples = 30;
        public const int MinimumDwmAdaptiveStableDirectionSamples = 0;
        public const int MaximumDwmAdaptiveStableDirectionSamples = 10;
        public const int MinimumDwmAdaptiveOscillationWindowSamples = 0;
        public const int MaximumDwmAdaptiveOscillationWindowSamples = 32;
        public const int MinimumDwmAdaptiveOscillationMinimumReversals = 1;
        public const int MaximumDwmAdaptiveOscillationMinimumReversals = 10;
        public const int MinimumDwmAdaptiveOscillationMaximumSpanPixels = 1;
        public const int MaximumDwmAdaptiveOscillationMaximumSpanPixels = 10000;
        public const int MinimumDwmAdaptiveOscillationMaximumEfficiencyPercent = 0;
        public const int MaximumDwmAdaptiveOscillationMaximumEfficiencyPercent = 100;
        public const int MinimumDwmAdaptiveOscillationLatchMilliseconds = 0;
        public const int MaximumDwmAdaptiveOscillationLatchMilliseconds = 1000;
        public const int MinimumDwmPredictionTargetOffsetDisplayMilliseconds = -32;
        public const int MaximumDwmPredictionTargetOffsetDisplayMilliseconds = 32;
        public const int MinimumDwmPredictionTargetOffsetMilliseconds =
            DwmPredictionTargetOffsetDisplayOriginMilliseconds + MinimumDwmPredictionTargetOffsetDisplayMilliseconds;
        public const int MaximumDwmPredictionTargetOffsetMilliseconds =
            DwmPredictionTargetOffsetDisplayOriginMilliseconds + MaximumDwmPredictionTargetOffsetDisplayMilliseconds;
        public const int MinimumRuntimeFineWaitAdvanceMicroseconds = 0;
        public const int MaximumRuntimeFineWaitAdvanceMicroseconds = 5000;
        public const int MinimumRuntimeFineWaitYieldThresholdMicroseconds = 0;
        public const int MaximumRuntimeFineWaitYieldThresholdMicroseconds = 5000;
        public const int MinimumRuntimeMessageDeferralMicroseconds = 0;
        public const int MaximumRuntimeMessageDeferralMicroseconds = 5000;

        public CursorMirrorSettings()
        {
            ApplyDefaults();
        }

        [DataMember(Order = 0)]
        public int SettingsSchemaVersion { get; set; }

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

        [DataMember(Order = 8)]
        public bool IdleFadeEnabled { get; set; }

        [DataMember(Order = 9)]
        public int IdleFadeDelayMilliseconds { get; set; }

        [DataMember(Order = 10)]
        public int IdleOpacityPercent { get; set; }

        [DataMember(Order = 11)]
        public int PredictionGainPercent { get; set; }

        [DataMember(Order = 12)]
        public int DwmPredictionHorizonCapMilliseconds { get; set; }

        [DataMember(Order = 13)]
        public bool DwmAdaptiveGainEnabled { get; set; }

        [DataMember(Order = 14)]
        public int DwmAdaptiveGainPercent { get; set; }

        [DataMember(Order = 15)]
        public int DwmAdaptiveMinimumSpeedPixelsPerSecond { get; set; }

        [DataMember(Order = 16)]
        public int DwmAdaptiveMaximumAccelerationPixelsPerSecondSquared { get; set; }

        [DataMember(Order = 17)]
        public int DwmAdaptiveReversalCooldownSamples { get; set; }

        [DataMember(Order = 18)]
        public int DwmAdaptiveStableDirectionSamples { get; set; }

        [DataMember(Order = 19)]
        public int DwmAdaptiveOscillationWindowSamples { get; set; }

        [DataMember(Order = 20)]
        public int DwmAdaptiveOscillationMinimumReversals { get; set; }

        [DataMember(Order = 21)]
        public int DwmAdaptiveOscillationMaximumSpanPixels { get; set; }

        [DataMember(Order = 22)]
        public int DwmAdaptiveOscillationMaximumEfficiencyPercent { get; set; }

        [DataMember(Order = 23)]
        public int DwmAdaptiveOscillationLatchMilliseconds { get; set; }

        [DataMember(Order = 24)]
        public int DwmPredictionModel { get; set; }

        [DataMember(Order = 25)]
        public int DwmPredictionTargetOffsetMilliseconds { get; set; }

        [DataMember(Order = 27)]
        public bool RuntimeSetWaitableTimerExEnabled { get; set; }

        [DataMember(Order = 28)]
        public int RuntimeFineWaitAdvanceMicroseconds { get; set; }

        [DataMember(Order = 29)]
        public int RuntimeFineWaitYieldThresholdMicroseconds { get; set; }

        [DataMember(Order = 30)]
        public bool RuntimeMessageDeferralEnabled { get; set; }

        [DataMember(Order = 31)]
        public int RuntimeMessageDeferralMicroseconds { get; set; }

        [DataMember(Order = 32)]
        public bool RuntimeThreadLatencyProfileEnabled { get; set; }

        [DataMember(Order = 33)]
        public int IdleFadeDurationMilliseconds { get; set; }

        public static CursorMirrorSettings Default()
        {
            return new CursorMirrorSettings();
        }

        public CursorMirrorSettings Clone()
        {
            return new CursorMirrorSettings
            {
                SettingsSchemaVersion = SettingsSchemaVersion,
                MovementTranslucencyEnabled = MovementTranslucencyEnabled,
                PredictionEnabled = PredictionEnabled,
                MovingOpacityPercent = MovingOpacityPercent,
                FadeDurationMilliseconds = FadeDurationMilliseconds,
                IdleDelayMilliseconds = IdleDelayMilliseconds,
                PredictionHorizonMilliseconds = PredictionHorizonMilliseconds,
                PredictionIdleResetMilliseconds = PredictionIdleResetMilliseconds,
                IdleFadeEnabled = IdleFadeEnabled,
                IdleFadeDurationMilliseconds = IdleFadeDurationMilliseconds,
                IdleFadeDelayMilliseconds = IdleFadeDelayMilliseconds,
                IdleOpacityPercent = IdleOpacityPercent,
                PredictionGainPercent = PredictionGainPercent,
                DwmPredictionHorizonCapMilliseconds = DwmPredictionHorizonCapMilliseconds,
                DwmAdaptiveGainEnabled = DwmAdaptiveGainEnabled,
                DwmAdaptiveGainPercent = DwmAdaptiveGainPercent,
                DwmAdaptiveMinimumSpeedPixelsPerSecond = DwmAdaptiveMinimumSpeedPixelsPerSecond,
                DwmAdaptiveMaximumAccelerationPixelsPerSecondSquared = DwmAdaptiveMaximumAccelerationPixelsPerSecondSquared,
                DwmAdaptiveReversalCooldownSamples = DwmAdaptiveReversalCooldownSamples,
                DwmAdaptiveStableDirectionSamples = DwmAdaptiveStableDirectionSamples,
                DwmAdaptiveOscillationWindowSamples = DwmAdaptiveOscillationWindowSamples,
                DwmAdaptiveOscillationMinimumReversals = DwmAdaptiveOscillationMinimumReversals,
                DwmAdaptiveOscillationMaximumSpanPixels = DwmAdaptiveOscillationMaximumSpanPixels,
                DwmAdaptiveOscillationMaximumEfficiencyPercent = DwmAdaptiveOscillationMaximumEfficiencyPercent,
                DwmAdaptiveOscillationLatchMilliseconds = DwmAdaptiveOscillationLatchMilliseconds,
                DwmPredictionModel = DwmPredictionModel,
                DwmPredictionTargetOffsetMilliseconds = DwmPredictionTargetOffsetMilliseconds,
                RuntimeSetWaitableTimerExEnabled = RuntimeSetWaitableTimerExEnabled,
                RuntimeFineWaitAdvanceMicroseconds = RuntimeFineWaitAdvanceMicroseconds,
                RuntimeFineWaitYieldThresholdMicroseconds = RuntimeFineWaitYieldThresholdMicroseconds,
                RuntimeMessageDeferralEnabled = RuntimeMessageDeferralEnabled,
                RuntimeMessageDeferralMicroseconds = RuntimeMessageDeferralMicroseconds,
                RuntimeThreadLatencyProfileEnabled = RuntimeThreadLatencyProfileEnabled
            };
        }

        public CursorMirrorSettings Normalize()
        {
            return new CursorMirrorSettings
            {
                SettingsSchemaVersion = CurrentSettingsSchemaVersion,
                MovementTranslucencyEnabled = MovementTranslucencyEnabled,
                PredictionEnabled = PredictionEnabled,
                MovingOpacityPercent = CursorMirrorSettingRanges.MovingOpacity.Clamp(MovingOpacityPercent),
                FadeDurationMilliseconds = CursorMirrorSettingRanges.FadeDuration.Clamp(FadeDurationMilliseconds),
                IdleDelayMilliseconds = CursorMirrorSettingRanges.IdleDelay.Clamp(IdleDelayMilliseconds),
                PredictionHorizonMilliseconds = CursorMirrorSettingRanges.PredictionHorizon.Clamp(PredictionHorizonMilliseconds),
                PredictionIdleResetMilliseconds = CursorMirrorSettingRanges.PredictionIdleReset.Clamp(PredictionIdleResetMilliseconds),
                IdleFadeEnabled = IdleFadeEnabled,
                IdleFadeDurationMilliseconds = CursorMirrorSettingRanges.IdleFadeDuration.Clamp(IdleFadeDurationMilliseconds),
                IdleFadeDelayMilliseconds = CursorMirrorSettingRanges.IdleFadeDelay.Clamp(IdleFadeDelayMilliseconds),
                IdleOpacityPercent = CursorMirrorSettingRanges.IdleOpacity.Clamp(IdleOpacityPercent),
                PredictionGainPercent = CursorMirrorSettingRanges.PredictionGain.Clamp(PredictionGainPercent),
                DwmPredictionHorizonCapMilliseconds = CursorMirrorSettingRanges.DwmPredictionHorizonCap.Clamp(DwmPredictionHorizonCapMilliseconds),
                DwmAdaptiveGainEnabled = DwmAdaptiveGainEnabled,
                DwmAdaptiveGainPercent = CursorMirrorSettingRanges.DwmAdaptiveGain.Clamp(DwmAdaptiveGainPercent),
                DwmAdaptiveMinimumSpeedPixelsPerSecond = CursorMirrorSettingRanges.DwmAdaptiveMinimumSpeed.Clamp(DwmAdaptiveMinimumSpeedPixelsPerSecond),
                DwmAdaptiveMaximumAccelerationPixelsPerSecondSquared = CursorMirrorSettingRanges.DwmAdaptiveMaximumAcceleration.Clamp(DwmAdaptiveMaximumAccelerationPixelsPerSecondSquared),
                DwmAdaptiveReversalCooldownSamples = CursorMirrorSettingRanges.DwmAdaptiveReversalCooldown.Clamp(DwmAdaptiveReversalCooldownSamples),
                DwmAdaptiveStableDirectionSamples = CursorMirrorSettingRanges.DwmAdaptiveStableDirection.Clamp(DwmAdaptiveStableDirectionSamples),
                DwmAdaptiveOscillationWindowSamples = CursorMirrorSettingRanges.DwmAdaptiveOscillationWindow.Clamp(DwmAdaptiveOscillationWindowSamples),
                DwmAdaptiveOscillationMinimumReversals = CursorMirrorSettingRanges.DwmAdaptiveOscillationMinimumReversals.Clamp(DwmAdaptiveOscillationMinimumReversals),
                DwmAdaptiveOscillationMaximumSpanPixels = CursorMirrorSettingRanges.DwmAdaptiveOscillationMaximumSpan.Clamp(DwmAdaptiveOscillationMaximumSpanPixels),
                DwmAdaptiveOscillationMaximumEfficiencyPercent = CursorMirrorSettingRanges.DwmAdaptiveOscillationMaximumEfficiency.Clamp(DwmAdaptiveOscillationMaximumEfficiencyPercent),
                DwmAdaptiveOscillationLatchMilliseconds = CursorMirrorSettingRanges.DwmAdaptiveOscillationLatch.Clamp(DwmAdaptiveOscillationLatchMilliseconds),
                DwmPredictionModel = NormalizeDwmPredictionModel(DwmPredictionModel),
                DwmPredictionTargetOffsetMilliseconds = CursorMirrorSettingRanges.DwmPredictionTargetOffset.Clamp(DwmPredictionTargetOffsetMilliseconds),
                RuntimeSetWaitableTimerExEnabled = RuntimeSetWaitableTimerExEnabled,
                RuntimeFineWaitAdvanceMicroseconds = CursorMirrorSettingRanges.RuntimeFineWaitAdvance.Clamp(RuntimeFineWaitAdvanceMicroseconds),
                RuntimeFineWaitYieldThresholdMicroseconds = CursorMirrorSettingRanges.ClampRuntimeFineWaitYieldThreshold(RuntimeFineWaitYieldThresholdMicroseconds, RuntimeFineWaitAdvanceMicroseconds),
                RuntimeMessageDeferralEnabled = RuntimeMessageDeferralEnabled,
                RuntimeMessageDeferralMicroseconds = CursorMirrorSettingRanges.RuntimeMessageDeferral.Clamp(RuntimeMessageDeferralMicroseconds),
                RuntimeThreadLatencyProfileEnabled = RuntimeThreadLatencyProfileEnabled
            };
        }

        public static int NormalizeDwmPredictionModel(int predictionModel)
        {
            return DefaultDwmPredictionModel;
        }

        public static int DwmPredictionTargetOffsetToDisplayMilliseconds(int targetOffsetMilliseconds)
        {
            return CursorMirrorSettingRanges.DwmPredictionTargetOffsetDisplay.Clamp(
                targetOffsetMilliseconds - DwmPredictionTargetOffsetDisplayOriginMilliseconds);
        }

        public static int DwmPredictionTargetOffsetFromDisplayMilliseconds(int displayOffsetMilliseconds)
        {
            return DwmPredictionTargetOffsetDisplayOriginMilliseconds +
                CursorMirrorSettingRanges.DwmPredictionTargetOffsetDisplay.Clamp(displayOffsetMilliseconds);
        }

        [OnDeserializing]
        private void OnDeserializing(StreamingContext context)
        {
            ApplyDefaults(0);
        }

        [OnDeserialized]
        private void OnDeserialized(StreamingContext context)
        {
            if (SettingsSchemaVersion < CurrentSettingsSchemaVersion)
            {
                RuntimeThreadLatencyProfileEnabled = DefaultRuntimeThreadLatencyProfileEnabled;
            }

            SettingsSchemaVersion = CurrentSettingsSchemaVersion;
        }

        private void ApplyDefaults()
        {
            ApplyDefaults(CurrentSettingsSchemaVersion);
        }

        private void ApplyDefaults(int settingsSchemaVersion)
        {
            SettingsSchemaVersion = settingsSchemaVersion;
            MovementTranslucencyEnabled = DefaultMovementTranslucencyEnabled;
            PredictionEnabled = DefaultPredictionEnabled;
            MovingOpacityPercent = DefaultMovingOpacityPercent;
            FadeDurationMilliseconds = DefaultFadeDurationMilliseconds;
            IdleDelayMilliseconds = DefaultIdleDelayMilliseconds;
            PredictionHorizonMilliseconds = DefaultPredictionHorizonMilliseconds;
            PredictionIdleResetMilliseconds = DefaultPredictionIdleResetMilliseconds;
            IdleFadeEnabled = DefaultIdleFadeEnabled;
            IdleFadeDurationMilliseconds = DefaultIdleFadeDurationMilliseconds;
            IdleFadeDelayMilliseconds = DefaultIdleFadeDelayMilliseconds;
            IdleOpacityPercent = DefaultIdleOpacityPercent;
            PredictionGainPercent = DefaultPredictionGainPercent;
            DwmPredictionHorizonCapMilliseconds = DefaultDwmPredictionHorizonCapMilliseconds;
            DwmAdaptiveGainEnabled = DefaultDwmAdaptiveGainEnabled;
            DwmAdaptiveGainPercent = DefaultDwmAdaptiveGainPercent;
            DwmAdaptiveMinimumSpeedPixelsPerSecond = DefaultDwmAdaptiveMinimumSpeedPixelsPerSecond;
            DwmAdaptiveMaximumAccelerationPixelsPerSecondSquared = DefaultDwmAdaptiveMaximumAccelerationPixelsPerSecondSquared;
            DwmAdaptiveReversalCooldownSamples = DefaultDwmAdaptiveReversalCooldownSamples;
            DwmAdaptiveStableDirectionSamples = DefaultDwmAdaptiveStableDirectionSamples;
            DwmAdaptiveOscillationWindowSamples = DefaultDwmAdaptiveOscillationWindowSamples;
            DwmAdaptiveOscillationMinimumReversals = DefaultDwmAdaptiveOscillationMinimumReversals;
            DwmAdaptiveOscillationMaximumSpanPixels = DefaultDwmAdaptiveOscillationMaximumSpanPixels;
            DwmAdaptiveOscillationMaximumEfficiencyPercent = DefaultDwmAdaptiveOscillationMaximumEfficiencyPercent;
            DwmAdaptiveOscillationLatchMilliseconds = DefaultDwmAdaptiveOscillationLatchMilliseconds;
            DwmPredictionModel = DefaultDwmPredictionModel;
            DwmPredictionTargetOffsetMilliseconds = DefaultDwmPredictionTargetOffsetMilliseconds;
            RuntimeSetWaitableTimerExEnabled = DefaultRuntimeSetWaitableTimerExEnabled;
            RuntimeFineWaitAdvanceMicroseconds = DefaultRuntimeFineWaitAdvanceMicroseconds;
            RuntimeFineWaitYieldThresholdMicroseconds = DefaultRuntimeFineWaitYieldThresholdMicroseconds;
            RuntimeMessageDeferralEnabled = DefaultRuntimeMessageDeferralEnabled;
            RuntimeMessageDeferralMicroseconds = DefaultRuntimeMessageDeferralMicroseconds;
            RuntimeThreadLatencyProfileEnabled = DefaultRuntimeThreadLatencyProfileEnabled;
        }

    }
}
