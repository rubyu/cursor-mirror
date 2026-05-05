using System;

namespace CursorMirror
{
    public static class CursorMirrorSettingRanges
    {
        public static readonly IntSettingRange MovingOpacity = new IntSettingRange(
            CursorMirrorSettings.MinimumMovingOpacityPercent,
            CursorMirrorSettings.MaximumMovingOpacityPercent);

        public static readonly IntSettingRange FadeDuration = new IntSettingRange(
            CursorMirrorSettings.MinimumFadeDurationMilliseconds,
            CursorMirrorSettings.MaximumFadeDurationMilliseconds);

        public static readonly IntSettingRange IdleDelay = new IntSettingRange(
            CursorMirrorSettings.MinimumIdleDelayMilliseconds,
            CursorMirrorSettings.MaximumIdleDelayMilliseconds);

        public static readonly IntSettingRange IdleFadeDuration = new IntSettingRange(
            CursorMirrorSettings.MinimumIdleFadeDurationMilliseconds,
            CursorMirrorSettings.MaximumIdleFadeDurationMilliseconds);

        public static readonly IntSettingRange IdleFadeDelay = new IntSettingRange(
            CursorMirrorSettings.MinimumIdleFadeDelayMilliseconds,
            CursorMirrorSettings.MaximumIdleFadeDelayMilliseconds);

        public static readonly IntSettingRange IdleOpacity = new IntSettingRange(
            CursorMirrorSettings.MinimumIdleOpacityPercent,
            CursorMirrorSettings.MaximumIdleOpacityPercent);

        public static readonly IntSettingRange PredictionHorizon = new IntSettingRange(
            CursorMirrorSettings.MinimumPredictionHorizonMilliseconds,
            CursorMirrorSettings.MaximumPredictionHorizonMilliseconds);

        public static readonly IntSettingRange PredictionIdleReset = new IntSettingRange(
            CursorMirrorSettings.MinimumPredictionIdleResetMilliseconds,
            CursorMirrorSettings.MaximumPredictionIdleResetMilliseconds);

        public static readonly IntSettingRange PredictionGain = new IntSettingRange(
            CursorMirrorSettings.MinimumPredictionGainPercent,
            CursorMirrorSettings.MaximumPredictionGainPercent);

        public static readonly IntSettingRange DwmPredictionHorizonCap = new IntSettingRange(
            CursorMirrorSettings.MinimumDwmPredictionHorizonCapMilliseconds,
            CursorMirrorSettings.MaximumDwmPredictionHorizonCapMilliseconds);

        public static readonly IntSettingRange DwmAdaptiveGain = new IntSettingRange(
            CursorMirrorSettings.MinimumDwmAdaptiveGainPercent,
            CursorMirrorSettings.MaximumDwmAdaptiveGainPercent);

        public static readonly IntSettingRange DwmAdaptiveMinimumSpeed = new IntSettingRange(
            CursorMirrorSettings.MinimumDwmAdaptiveMinimumSpeedPixelsPerSecond,
            CursorMirrorSettings.MaximumDwmAdaptiveMinimumSpeedPixelsPerSecond);

        public static readonly IntSettingRange DwmAdaptiveMaximumAcceleration = new IntSettingRange(
            CursorMirrorSettings.MinimumDwmAdaptiveMaximumAccelerationPixelsPerSecondSquared,
            CursorMirrorSettings.MaximumDwmAdaptiveMaximumAccelerationPixelsPerSecondSquared);

        public static readonly IntSettingRange DwmAdaptiveReversalCooldown = new IntSettingRange(
            CursorMirrorSettings.MinimumDwmAdaptiveReversalCooldownSamples,
            CursorMirrorSettings.MaximumDwmAdaptiveReversalCooldownSamples);

        public static readonly IntSettingRange DwmAdaptiveStableDirection = new IntSettingRange(
            CursorMirrorSettings.MinimumDwmAdaptiveStableDirectionSamples,
            CursorMirrorSettings.MaximumDwmAdaptiveStableDirectionSamples);

        public static readonly IntSettingRange DwmAdaptiveOscillationWindow = new IntSettingRange(
            CursorMirrorSettings.MinimumDwmAdaptiveOscillationWindowSamples,
            CursorMirrorSettings.MaximumDwmAdaptiveOscillationWindowSamples);

        public static readonly IntSettingRange DwmAdaptiveOscillationMinimumReversals = new IntSettingRange(
            CursorMirrorSettings.MinimumDwmAdaptiveOscillationMinimumReversals,
            CursorMirrorSettings.MaximumDwmAdaptiveOscillationMinimumReversals);

        public static readonly IntSettingRange DwmAdaptiveOscillationMaximumSpan = new IntSettingRange(
            CursorMirrorSettings.MinimumDwmAdaptiveOscillationMaximumSpanPixels,
            CursorMirrorSettings.MaximumDwmAdaptiveOscillationMaximumSpanPixels);

        public static readonly IntSettingRange DwmAdaptiveOscillationMaximumEfficiency = new IntSettingRange(
            CursorMirrorSettings.MinimumDwmAdaptiveOscillationMaximumEfficiencyPercent,
            CursorMirrorSettings.MaximumDwmAdaptiveOscillationMaximumEfficiencyPercent);

        public static readonly IntSettingRange DwmAdaptiveOscillationLatch = new IntSettingRange(
            CursorMirrorSettings.MinimumDwmAdaptiveOscillationLatchMilliseconds,
            CursorMirrorSettings.MaximumDwmAdaptiveOscillationLatchMilliseconds);

        public static readonly IntSettingRange DwmPredictionTargetOffsetDisplay = new IntSettingRange(
            CursorMirrorSettings.MinimumDwmPredictionTargetOffsetDisplayMilliseconds,
            CursorMirrorSettings.MaximumDwmPredictionTargetOffsetDisplayMilliseconds);

        public static readonly IntSettingRange DwmPredictionTargetOffset = new IntSettingRange(
            CursorMirrorSettings.MinimumDwmPredictionTargetOffsetMilliseconds,
            CursorMirrorSettings.MaximumDwmPredictionTargetOffsetMilliseconds);

        public static readonly IntSettingRange RuntimeFineWaitAdvance = new IntSettingRange(
            CursorMirrorSettings.MinimumRuntimeFineWaitAdvanceMicroseconds,
            CursorMirrorSettings.MaximumRuntimeFineWaitAdvanceMicroseconds);

        public static readonly IntSettingRange RuntimeFineWaitYieldThreshold = new IntSettingRange(
            CursorMirrorSettings.MinimumRuntimeFineWaitYieldThresholdMicroseconds,
            CursorMirrorSettings.MaximumRuntimeFineWaitYieldThresholdMicroseconds);

        public static readonly IntSettingRange RuntimeMessageDeferral = new IntSettingRange(
            CursorMirrorSettings.MinimumRuntimeMessageDeferralMicroseconds,
            CursorMirrorSettings.MaximumRuntimeMessageDeferralMicroseconds);

        public static int ClampRuntimeFineWaitYieldThreshold(int thresholdMicroseconds, int fineWaitAdvanceMicroseconds)
        {
            int normalizedFineWait = RuntimeFineWaitAdvance.Clamp(fineWaitAdvanceMicroseconds);
            int maximum = Math.Min(RuntimeFineWaitYieldThreshold.Maximum, normalizedFineWait);
            return Math.Max(RuntimeFineWaitYieldThreshold.Minimum, Math.Min(maximum, thresholdMicroseconds));
        }
    }
}
