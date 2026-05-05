using System;
using System.IO;
using CursorMirror;

namespace CursorMirror.Tests
{
    internal static class SettingsTests
    {
        public static void AddTo(TestSuite suite)
        {
            suite.Add("COT-MSU-1", SettingsDefaults);
            suite.Add("COT-MSU-2", MovingOpacityValidation);
            suite.Add("COT-MSU-3", TimingValidation);
            suite.Add("COT-MSU-4", SettingsSerializationRoundTrip);
            suite.Add("COT-MSU-5", MissingSettingsFallback);
            suite.Add("COT-MSU-6", CorruptSettingsFallback);
            suite.Add("COT-MSU-7", SettingsReset);
            suite.Add("COT-MSU-8", ImmediateSettingsApplication);
            suite.Add("COT-MSU-9", PredictionSettingPersistence);
            suite.Add("COT-MSU-10", DurableSettingsSaveValidation);
            suite.Add("COT-MSU-11", SettingsBackupRetention);
            suite.Add("COT-MSU-12", FailedStagedSavePreservesActiveSettings);
        }

        // Settings defaults [COT-MSU-1]
        private static void SettingsDefaults()
        {
            CursorMirrorSettings settings = CursorMirrorSettings.Default();

            TestAssert.Equal(CursorMirrorSettings.CurrentSettingsSchemaVersion, settings.SettingsSchemaVersion, "default settings schema version");
            TestAssert.True(settings.MovementTranslucencyEnabled, "default enabled");
            TestAssert.True(settings.PredictionEnabled, "prediction default enabled");
            TestAssert.Equal(20, settings.MovingOpacityPercent, "default moving opacity");
            TestAssert.Equal(100, settings.FadeDurationMilliseconds, "default fade duration");
            TestAssert.Equal(100, settings.IdleDelayMilliseconds, "default idle delay");
            TestAssert.True(settings.IdleFadeEnabled, "default idle fade enabled");
            TestAssert.Equal(300, settings.IdleFadeDurationMilliseconds, "default idle fade duration");
            TestAssert.Equal(3000, settings.IdleFadeDelayMilliseconds, "default idle fade delay");
            TestAssert.Equal(10, settings.IdleOpacityPercent, "default idle opacity");
            TestAssert.Equal(8, settings.PredictionHorizonMilliseconds, "default prediction horizon");
            TestAssert.Equal(100, settings.PredictionIdleResetMilliseconds, "default prediction idle reset");
            TestAssert.Equal(100, settings.PredictionGainPercent, "default prediction gain");
            TestAssert.Equal(10, settings.DwmPredictionHorizonCapMilliseconds, "default DWM prediction horizon cap");
            TestAssert.False(settings.DwmAdaptiveGainEnabled, "default DWM adaptive gain disabled");
            TestAssert.Equal(100, settings.DwmAdaptiveGainPercent, "default DWM adaptive gain");
            TestAssert.Equal(1500, settings.DwmAdaptiveMinimumSpeedPixelsPerSecond, "default DWM adaptive minimum speed");
            TestAssert.Equal(40000, settings.DwmAdaptiveMaximumAccelerationPixelsPerSecondSquared, "default DWM adaptive maximum acceleration");
            TestAssert.Equal(0, settings.DwmAdaptiveReversalCooldownSamples, "default DWM adaptive reversal cooldown");
            TestAssert.Equal(0, settings.DwmAdaptiveStableDirectionSamples, "default DWM adaptive stable direction samples");
            TestAssert.Equal(0, settings.DwmAdaptiveOscillationWindowSamples, "default DWM adaptive oscillation window");
            TestAssert.Equal(2, settings.DwmAdaptiveOscillationMinimumReversals, "default DWM adaptive oscillation reversals");
            TestAssert.Equal(450, settings.DwmAdaptiveOscillationMaximumSpanPixels, "default DWM adaptive oscillation span");
            TestAssert.Equal(55, settings.DwmAdaptiveOscillationMaximumEfficiencyPercent, "default DWM adaptive oscillation efficiency");
            TestAssert.Equal(0, settings.DwmAdaptiveOscillationLatchMilliseconds, "default DWM adaptive oscillation latch");
            TestAssert.Equal(CursorMirrorSettings.DwmPredictionModelConstantVelocity, settings.DwmPredictionModel, "default DWM prediction model");
            TestAssert.Equal(8, settings.DwmPredictionTargetOffsetMilliseconds, "default DWM prediction target offset");
            TestAssert.Equal(0, CursorMirrorSettings.DwmPredictionTargetOffsetToDisplayMilliseconds(settings.DwmPredictionTargetOffsetMilliseconds), "default DWM prediction target offset display");
            TestAssert.True(settings.RuntimeSetWaitableTimerExEnabled, "default runtime set waitable timer ex enabled");
            TestAssert.Equal(2000, settings.RuntimeFineWaitAdvanceMicroseconds, "default runtime fine wait");
            TestAssert.Equal(100, settings.RuntimeFineWaitYieldThresholdMicroseconds, "default runtime spin threshold");
            TestAssert.True(settings.RuntimeMessageDeferralEnabled, "default runtime message deferral enabled");
            TestAssert.Equal(100, settings.RuntimeMessageDeferralMicroseconds, "default runtime message deferral window");
            TestAssert.True(settings.RuntimeThreadLatencyProfileEnabled, "default runtime thread latency profile enabled");
        }

        // Moving opacity validation [COT-MSU-2]
        private static void MovingOpacityValidation()
        {
            CursorMirrorSettings low = CursorMirrorSettings.Default();
            low.MovingOpacityPercent = 1;
            CursorMirrorSettings high = CursorMirrorSettings.Default();
            high.MovingOpacityPercent = 999;

            TestAssert.Equal(1, low.Normalize().MovingOpacityPercent, "moving opacity lower clamp");
            TestAssert.Equal(100, high.Normalize().MovingOpacityPercent, "moving opacity upper clamp");
        }

        // Timing validation [COT-MSU-3]
        private static void TimingValidation()
        {
            CursorMirrorSettings settings = CursorMirrorSettings.Default();
            settings.FadeDurationMilliseconds = -10;
            settings.IdleDelayMilliseconds = 5;
            settings.IdleFadeDurationMilliseconds = -10;
            settings.IdleFadeDelayMilliseconds = -1;
            settings.IdleOpacityPercent = -1;
            settings.PredictionHorizonMilliseconds = -1;
            settings.PredictionIdleResetMilliseconds = 0;
            settings.PredictionGainPercent = 1;
            settings.DwmPredictionHorizonCapMilliseconds = -1;
            settings.DwmAdaptiveGainPercent = 1;
            settings.DwmAdaptiveMinimumSpeedPixelsPerSecond = -1;
            settings.DwmAdaptiveMaximumAccelerationPixelsPerSecondSquared = -1;
            settings.DwmAdaptiveReversalCooldownSamples = -1;
            settings.DwmAdaptiveStableDirectionSamples = -1;
            settings.DwmAdaptiveOscillationWindowSamples = -1;
            settings.DwmAdaptiveOscillationMinimumReversals = -1;
            settings.DwmAdaptiveOscillationMaximumSpanPixels = -1;
            settings.DwmAdaptiveOscillationMaximumEfficiencyPercent = -1;
            settings.DwmAdaptiveOscillationLatchMilliseconds = -1;
            settings.DwmPredictionModel = -1;
            settings.DwmPredictionTargetOffsetMilliseconds = -999;
            settings.RuntimeFineWaitAdvanceMicroseconds = -1;
            settings.RuntimeFineWaitYieldThresholdMicroseconds = -1;
            settings.RuntimeMessageDeferralMicroseconds = -1;
            CursorMirrorSettings low = settings.Normalize();

            settings.FadeDurationMilliseconds = 999;
            settings.IdleDelayMilliseconds = 999;
            settings.IdleFadeDurationMilliseconds = 999;
            settings.IdleFadeDelayMilliseconds = 999999;
            settings.IdleOpacityPercent = 999;
            settings.PredictionHorizonMilliseconds = 999;
            settings.PredictionIdleResetMilliseconds = 9999;
            settings.PredictionGainPercent = 999;
            settings.DwmPredictionHorizonCapMilliseconds = 999;
            settings.DwmAdaptiveGainPercent = 999;
            settings.DwmAdaptiveMinimumSpeedPixelsPerSecond = 999999;
            settings.DwmAdaptiveMaximumAccelerationPixelsPerSecondSquared = 9999999;
            settings.DwmAdaptiveReversalCooldownSamples = 999;
            settings.DwmAdaptiveStableDirectionSamples = 999;
            settings.DwmAdaptiveOscillationWindowSamples = 999;
            settings.DwmAdaptiveOscillationMinimumReversals = 999;
            settings.DwmAdaptiveOscillationMaximumSpanPixels = 999999;
            settings.DwmAdaptiveOscillationMaximumEfficiencyPercent = 999;
            settings.DwmAdaptiveOscillationLatchMilliseconds = 999999;
            settings.DwmPredictionModel = 999;
            settings.DwmPredictionTargetOffsetMilliseconds = 999;
            settings.RuntimeFineWaitAdvanceMicroseconds = 99999;
            settings.RuntimeFineWaitYieldThresholdMicroseconds = 99999;
            settings.RuntimeMessageDeferralMicroseconds = 99999;
            CursorMirrorSettings high = settings.Normalize();

            TestAssert.Equal(0, low.FadeDurationMilliseconds, "fade duration lower clamp");
            TestAssert.Equal(50, low.IdleDelayMilliseconds, "idle delay lower clamp");
            TestAssert.Equal(0, low.IdleFadeDurationMilliseconds, "idle fade duration lower clamp");
            TestAssert.Equal(0, low.IdleFadeDelayMilliseconds, "idle fade delay lower clamp");
            TestAssert.Equal(0, low.IdleOpacityPercent, "idle opacity lower clamp");
            TestAssert.Equal(0, low.PredictionHorizonMilliseconds, "prediction horizon lower clamp");
            TestAssert.Equal(1, low.PredictionIdleResetMilliseconds, "prediction idle reset lower clamp");
            TestAssert.Equal(50, low.PredictionGainPercent, "prediction gain lower clamp");
            TestAssert.Equal(0, low.DwmPredictionHorizonCapMilliseconds, "DWM prediction horizon cap lower clamp");
            TestAssert.Equal(50, low.DwmAdaptiveGainPercent, "DWM adaptive gain lower clamp");
            TestAssert.Equal(0, low.DwmAdaptiveMinimumSpeedPixelsPerSecond, "DWM adaptive minimum speed lower clamp");
            TestAssert.Equal(0, low.DwmAdaptiveMaximumAccelerationPixelsPerSecondSquared, "DWM adaptive maximum acceleration lower clamp");
            TestAssert.Equal(0, low.DwmAdaptiveReversalCooldownSamples, "DWM adaptive reversal cooldown lower clamp");
            TestAssert.Equal(0, low.DwmAdaptiveStableDirectionSamples, "DWM adaptive stable direction lower clamp");
            TestAssert.Equal(0, low.DwmAdaptiveOscillationWindowSamples, "DWM adaptive oscillation window lower clamp");
            TestAssert.Equal(1, low.DwmAdaptiveOscillationMinimumReversals, "DWM adaptive oscillation reversals lower clamp");
            TestAssert.Equal(1, low.DwmAdaptiveOscillationMaximumSpanPixels, "DWM adaptive oscillation span lower clamp");
            TestAssert.Equal(0, low.DwmAdaptiveOscillationMaximumEfficiencyPercent, "DWM adaptive oscillation efficiency lower clamp");
            TestAssert.Equal(0, low.DwmAdaptiveOscillationLatchMilliseconds, "DWM adaptive oscillation latch lower clamp");
            TestAssert.Equal(0, low.DwmPredictionModel, "DWM prediction model lower clamp");
            TestAssert.Equal(-24, low.DwmPredictionTargetOffsetMilliseconds, "DWM prediction target offset lower clamp");
            TestAssert.Equal(0, low.RuntimeFineWaitAdvanceMicroseconds, "runtime fine wait lower clamp");
            TestAssert.Equal(0, low.RuntimeFineWaitYieldThresholdMicroseconds, "runtime spin threshold lower clamp");
            TestAssert.Equal(0, low.RuntimeMessageDeferralMicroseconds, "runtime message deferral lower clamp");
            TestAssert.Equal(300, high.FadeDurationMilliseconds, "fade duration upper clamp");
            TestAssert.Equal(500, high.IdleDelayMilliseconds, "idle delay upper clamp");
            TestAssert.Equal(300, high.IdleFadeDurationMilliseconds, "idle fade duration upper clamp");
            TestAssert.Equal(60000, high.IdleFadeDelayMilliseconds, "idle fade delay upper clamp");
            TestAssert.Equal(99, high.IdleOpacityPercent, "idle opacity upper clamp");
            TestAssert.Equal(16, high.PredictionHorizonMilliseconds, "prediction horizon upper clamp");
            TestAssert.Equal(1000, high.PredictionIdleResetMilliseconds, "prediction idle reset upper clamp");
            TestAssert.Equal(150, high.PredictionGainPercent, "prediction gain upper clamp");
            TestAssert.Equal(16, high.DwmPredictionHorizonCapMilliseconds, "DWM prediction horizon cap upper clamp");
            TestAssert.Equal(150, high.DwmAdaptiveGainPercent, "DWM adaptive gain upper clamp");
            TestAssert.Equal(10000, high.DwmAdaptiveMinimumSpeedPixelsPerSecond, "DWM adaptive minimum speed upper clamp");
            TestAssert.Equal(1000000, high.DwmAdaptiveMaximumAccelerationPixelsPerSecondSquared, "DWM adaptive maximum acceleration upper clamp");
            TestAssert.Equal(30, high.DwmAdaptiveReversalCooldownSamples, "DWM adaptive reversal cooldown upper clamp");
            TestAssert.Equal(10, high.DwmAdaptiveStableDirectionSamples, "DWM adaptive stable direction upper clamp");
            TestAssert.Equal(32, high.DwmAdaptiveOscillationWindowSamples, "DWM adaptive oscillation window upper clamp");
            TestAssert.Equal(10, high.DwmAdaptiveOscillationMinimumReversals, "DWM adaptive oscillation reversals upper clamp");
            TestAssert.Equal(10000, high.DwmAdaptiveOscillationMaximumSpanPixels, "DWM adaptive oscillation span upper clamp");
            TestAssert.Equal(100, high.DwmAdaptiveOscillationMaximumEfficiencyPercent, "DWM adaptive oscillation efficiency upper clamp");
            TestAssert.Equal(1000, high.DwmAdaptiveOscillationLatchMilliseconds, "DWM adaptive oscillation latch upper clamp");
            TestAssert.Equal(CursorMirrorSettings.DwmPredictionModelConstantVelocity, high.DwmPredictionModel, "unknown DWM prediction model fallback");
            TestAssert.Equal(40, high.DwmPredictionTargetOffsetMilliseconds, "DWM prediction target offset upper clamp");
            TestAssert.Equal(5000, high.RuntimeFineWaitAdvanceMicroseconds, "runtime fine wait upper clamp");
            TestAssert.Equal(5000, high.RuntimeFineWaitYieldThresholdMicroseconds, "runtime spin threshold upper clamp");
            TestAssert.Equal(5000, high.RuntimeMessageDeferralMicroseconds, "runtime message deferral upper clamp");

            CursorMirrorSettings oldExperimentalModel = CursorMirrorSettings.Default();
            oldExperimentalModel.DwmPredictionModel = 2;
            CursorMirrorSettings oldDistilledModel = CursorMirrorSettings.Default();
            oldDistilledModel.DwmPredictionModel = 3;
            CursorMirrorSettings removedSmoothPredictor = CursorMirrorSettings.Default();
            removedSmoothPredictor.DwmPredictionModel = 4;
            CursorMirrorSettings removedHighSpeedSwitch = CursorMirrorSettings.Default();
            removedHighSpeedSwitch.DwmPredictionModel = 5;
            CursorMirrorSettings removedTwoRegimeSmoothPredictor = CursorMirrorSettings.Default();
            removedTwoRegimeSmoothPredictor.DwmPredictionModel = 6;
            TestAssert.Equal(CursorMirrorSettings.DwmPredictionModelConstantVelocity, oldExperimentalModel.Normalize().DwmPredictionModel, "obsolete experimental model migrates to constant velocity");
            TestAssert.Equal(CursorMirrorSettings.DwmPredictionModelConstantVelocity, oldDistilledModel.Normalize().DwmPredictionModel, "obsolete distilled model migrates to constant velocity");
            TestAssert.Equal(CursorMirrorSettings.DwmPredictionModelConstantVelocity, removedSmoothPredictor.Normalize().DwmPredictionModel, "removed smooth predictor model migrates to constant velocity");
            TestAssert.Equal(CursorMirrorSettings.DwmPredictionModelConstantVelocity, removedHighSpeedSwitch.Normalize().DwmPredictionModel, "removed high-speed switch model migrates to constant velocity");
            TestAssert.Equal(CursorMirrorSettings.DwmPredictionModelConstantVelocity, removedTwoRegimeSmoothPredictor.Normalize().DwmPredictionModel, "removed two-regime model migrates to constant velocity");
        }

        // Settings serialization round trip [COT-MSU-4]
        private static void SettingsSerializationRoundTrip()
        {
            string directory = NewTestDirectory();
            try
            {
                string path = Path.Combine(directory, "settings.json");
                SettingsStore store = new SettingsStore(path);
                CursorMirrorSettings settings = CursorMirrorSettings.Default();
                settings.MovementTranslucencyEnabled = false;
                settings.PredictionEnabled = false;
                settings.MovingOpacityPercent = 88;
                settings.FadeDurationMilliseconds = 240;
                settings.IdleDelayMilliseconds = 450;
                settings.PredictionHorizonMilliseconds = 12;
                settings.PredictionIdleResetMilliseconds = 250;
                settings.PredictionGainPercent = 85;
                settings.DwmPredictionHorizonCapMilliseconds = 7;
                settings.DwmAdaptiveGainEnabled = true;
                settings.DwmAdaptiveGainPercent = 75;
                settings.DwmAdaptiveMinimumSpeedPixelsPerSecond = 1200;
                settings.DwmAdaptiveMaximumAccelerationPixelsPerSecondSquared = 30000;
                settings.DwmAdaptiveReversalCooldownSamples = 8;
                settings.DwmAdaptiveStableDirectionSamples = 3;
                settings.DwmAdaptiveOscillationWindowSamples = 24;
                settings.DwmAdaptiveOscillationMinimumReversals = 2;
                settings.DwmAdaptiveOscillationMaximumSpanPixels = 450;
                settings.DwmAdaptiveOscillationMaximumEfficiencyPercent = 55;
                settings.DwmAdaptiveOscillationLatchMilliseconds = 300;
                settings.DwmPredictionModel = CursorMirrorSettings.DwmPredictionModelConstantVelocity;
                settings.DwmPredictionTargetOffsetMilliseconds = 3;
                settings.RuntimeSetWaitableTimerExEnabled = false;
                settings.RuntimeFineWaitAdvanceMicroseconds = 1800;
                settings.RuntimeFineWaitYieldThresholdMicroseconds = 400;
                settings.RuntimeMessageDeferralEnabled = true;
                settings.RuntimeMessageDeferralMicroseconds = 900;
                settings.RuntimeThreadLatencyProfileEnabled = true;
                settings.IdleFadeEnabled = false;
                settings.IdleFadeDurationMilliseconds = 140;
                settings.IdleFadeDelayMilliseconds = 4000;
                settings.IdleOpacityPercent = 12;

                store.Save(settings);
                CursorMirrorSettings loaded = store.Load();

                TestAssert.Equal(CursorMirrorSettings.CurrentSettingsSchemaVersion, loaded.SettingsSchemaVersion, "loaded settings schema version");
                TestAssert.False(loaded.MovementTranslucencyEnabled, "loaded enabled flag");
                TestAssert.False(loaded.PredictionEnabled, "loaded prediction enabled flag");
                TestAssert.Equal(88, loaded.MovingOpacityPercent, "loaded opacity");
                TestAssert.Equal(240, loaded.FadeDurationMilliseconds, "loaded fade duration");
                TestAssert.Equal(450, loaded.IdleDelayMilliseconds, "loaded idle delay");
                TestAssert.Equal(12, loaded.PredictionHorizonMilliseconds, "loaded prediction horizon");
                TestAssert.Equal(250, loaded.PredictionIdleResetMilliseconds, "loaded prediction idle reset");
                TestAssert.Equal(85, loaded.PredictionGainPercent, "loaded prediction gain");
                TestAssert.Equal(7, loaded.DwmPredictionHorizonCapMilliseconds, "loaded DWM prediction horizon cap");
                TestAssert.True(loaded.DwmAdaptiveGainEnabled, "loaded DWM adaptive gain enabled");
                TestAssert.Equal(75, loaded.DwmAdaptiveGainPercent, "loaded DWM adaptive gain");
                TestAssert.Equal(1200, loaded.DwmAdaptiveMinimumSpeedPixelsPerSecond, "loaded DWM adaptive minimum speed");
                TestAssert.Equal(30000, loaded.DwmAdaptiveMaximumAccelerationPixelsPerSecondSquared, "loaded DWM adaptive maximum acceleration");
                TestAssert.Equal(8, loaded.DwmAdaptiveReversalCooldownSamples, "loaded DWM adaptive reversal cooldown");
                TestAssert.Equal(3, loaded.DwmAdaptiveStableDirectionSamples, "loaded DWM adaptive stable direction samples");
                TestAssert.Equal(24, loaded.DwmAdaptiveOscillationWindowSamples, "loaded DWM adaptive oscillation window");
                TestAssert.Equal(2, loaded.DwmAdaptiveOscillationMinimumReversals, "loaded DWM adaptive oscillation reversals");
                TestAssert.Equal(450, loaded.DwmAdaptiveOscillationMaximumSpanPixels, "loaded DWM adaptive oscillation span");
                TestAssert.Equal(55, loaded.DwmAdaptiveOscillationMaximumEfficiencyPercent, "loaded DWM adaptive oscillation efficiency");
                TestAssert.Equal(300, loaded.DwmAdaptiveOscillationLatchMilliseconds, "loaded DWM adaptive oscillation latch");
                TestAssert.Equal(CursorMirrorSettings.DwmPredictionModelConstantVelocity, loaded.DwmPredictionModel, "loaded DWM prediction model");
                TestAssert.Equal(3, loaded.DwmPredictionTargetOffsetMilliseconds, "loaded DWM prediction target offset");
                TestAssert.False(loaded.RuntimeSetWaitableTimerExEnabled, "loaded runtime set waitable timer ex");
                TestAssert.Equal(1800, loaded.RuntimeFineWaitAdvanceMicroseconds, "loaded runtime fine wait");
                TestAssert.Equal(400, loaded.RuntimeFineWaitYieldThresholdMicroseconds, "loaded runtime spin threshold");
                TestAssert.True(loaded.RuntimeMessageDeferralEnabled, "loaded runtime message deferral");
                TestAssert.Equal(900, loaded.RuntimeMessageDeferralMicroseconds, "loaded runtime message deferral window");
                TestAssert.True(loaded.RuntimeThreadLatencyProfileEnabled, "loaded runtime thread latency profile");
                TestAssert.False(loaded.IdleFadeEnabled, "loaded idle fade flag");
                TestAssert.Equal(140, loaded.IdleFadeDurationMilliseconds, "loaded idle fade duration");
                TestAssert.Equal(4000, loaded.IdleFadeDelayMilliseconds, "loaded idle fade delay");
                TestAssert.Equal(12, loaded.IdleOpacityPercent, "loaded idle opacity");
            }
            finally
            {
                DeleteDirectory(directory);
            }
        }

        // Missing settings fallback [COT-MSU-5]
        private static void MissingSettingsFallback()
        {
            string directory = NewTestDirectory();
            try
            {
                SettingsStore store = new SettingsStore(Path.Combine(directory, "missing.json"));
                string restoreFailureMessage;
                CursorMirrorSettings settings = store.Load(out restoreFailureMessage);

                TestAssert.Equal(20, settings.MovingOpacityPercent, "missing settings default");
                TestAssert.True(settings.PredictionEnabled, "missing settings prediction default");
                TestAssert.Equal(null, restoreFailureMessage, "missing settings is not restore failure");
            }
            finally
            {
                DeleteDirectory(directory);
            }
        }

        // Corrupt settings fallback [COT-MSU-6]
        private static void CorruptSettingsFallback()
        {
            string directory = NewTestDirectory();
            try
            {
                string path = Path.Combine(directory, "settings.json");
                File.WriteAllText(path, "{ this is not valid json", System.Text.Encoding.UTF8);
                SettingsStore store = new SettingsStore(path);
                string restoreFailureMessage;
                CursorMirrorSettings settings = store.Load(out restoreFailureMessage);

                TestAssert.Equal(20, settings.MovingOpacityPercent, "corrupt settings default");
                TestAssert.True(settings.PredictionEnabled, "corrupt settings prediction default");
                TestAssert.True(!string.IsNullOrWhiteSpace(restoreFailureMessage), "corrupt settings restore failure message");
            }
            finally
            {
                DeleteDirectory(directory);
            }
        }

        // Settings reset [COT-MSU-7]
        private static void SettingsReset()
        {
            string directory = NewTestDirectory();
            try
            {
                int applyCount = 0;
                CursorMirrorSettings applied = null;
                SettingsController controller = new SettingsController(
                    new SettingsStore(Path.Combine(directory, "settings.json")),
                    ChangedSettings(),
                    delegate(CursorMirrorSettings settings)
                    {
                        applyCount++;
                        applied = settings;
                    },
                    delegate { });

                controller.ResetToDefaults();

                TestAssert.Equal(2, applyCount, "reset apply count");
                TestAssert.Equal(20, controller.CurrentSettings.MovingOpacityPercent, "reset current opacity");
                TestAssert.True(controller.CurrentSettings.PredictionEnabled, "reset current prediction");
                TestAssert.Equal(20, applied.MovingOpacityPercent, "reset applied opacity");
                TestAssert.True(applied.PredictionEnabled, "reset applied prediction");
            }
            finally
            {
                DeleteDirectory(directory);
            }
        }

        // Immediate settings application [COT-MSU-8]
        private static void ImmediateSettingsApplication()
        {
            string directory = NewTestDirectory();
            try
            {
                int applyCount = 0;
                CursorMirrorSettings applied = null;
                SettingsController controller = new SettingsController(
                    new SettingsStore(Path.Combine(directory, "settings.json")),
                    CursorMirrorSettings.Default(),
                    delegate(CursorMirrorSettings settings)
                    {
                        applyCount++;
                        applied = settings;
                    },
                    delegate { });

                CursorMirrorSettings changed = ChangedSettings();
                controller.UpdateSettings(changed);

                TestAssert.Equal(2, applyCount, "settings apply count");
                TestAssert.Equal(90, applied.MovingOpacityPercent, "applied updated opacity");
                TestAssert.False(applied.PredictionEnabled, "applied updated prediction");
                TestAssert.Equal(85, applied.PredictionGainPercent, "applied updated prediction gain");
                TestAssert.Equal(90, controller.CurrentSettings.MovingOpacityPercent, "current updated opacity");
                TestAssert.False(controller.CurrentSettings.PredictionEnabled, "current updated prediction");
                TestAssert.Equal(85, controller.CurrentSettings.PredictionGainPercent, "current updated prediction gain");
            }
            finally
            {
                DeleteDirectory(directory);
            }
        }

        // Prediction setting persistence [COT-MSU-9]
        private static void PredictionSettingPersistence()
        {
            string directory = NewTestDirectory();
            try
            {
                string path = Path.Combine(directory, "settings.json");
                SettingsStore store = new SettingsStore(path);
                CursorMirrorSettings settings = CursorMirrorSettings.Default();
                settings.PredictionEnabled = false;

                store.Save(settings);
                CursorMirrorSettings loaded = store.Load();

                TestAssert.False(loaded.PredictionEnabled, "disabled prediction must persist");

                File.WriteAllText(
                    path,
                    "{\"MovementTranslucencyEnabled\":false,\"MovingOpacityPercent\":80,\"FadeDurationMilliseconds\":90,\"IdleDelayMilliseconds\":100}",
                    System.Text.Encoding.UTF8);
                CursorMirrorSettings oldFormat = store.Load();

                TestAssert.True(oldFormat.PredictionEnabled, "old settings must use prediction default");
                TestAssert.Equal(100, oldFormat.PredictionGainPercent, "old settings must use prediction gain default");
                TestAssert.Equal(10, oldFormat.DwmPredictionHorizonCapMilliseconds, "old settings must use DWM horizon cap default");
                TestAssert.False(oldFormat.DwmAdaptiveGainEnabled, "old settings must use DWM adaptive gain default");
                TestAssert.Equal(0, oldFormat.DwmAdaptiveReversalCooldownSamples, "old settings must use DWM adaptive reversal cooldown default");
                TestAssert.Equal(0, oldFormat.DwmAdaptiveOscillationWindowSamples, "old settings must use DWM adaptive oscillation window default");
                TestAssert.Equal(CursorMirrorSettings.DwmPredictionModelConstantVelocity, oldFormat.DwmPredictionModel, "old settings must use DWM prediction model default");
                TestAssert.Equal(8, oldFormat.DwmPredictionTargetOffsetMilliseconds, "old settings must use DWM prediction target offset default");
                TestAssert.Equal(300, oldFormat.IdleFadeDurationMilliseconds, "old settings must use idle fade duration default");
                TestAssert.True(oldFormat.RuntimeSetWaitableTimerExEnabled, "old settings must use runtime set waitable timer ex default");
                TestAssert.Equal(2000, oldFormat.RuntimeFineWaitAdvanceMicroseconds, "old settings must use runtime fine wait default");
                TestAssert.Equal(100, oldFormat.RuntimeFineWaitYieldThresholdMicroseconds, "old settings must use runtime spin threshold default");
                TestAssert.True(oldFormat.RuntimeMessageDeferralEnabled, "old settings must use runtime message deferral default");
                TestAssert.Equal(100, oldFormat.RuntimeMessageDeferralMicroseconds, "old settings must use runtime message deferral window default");
                TestAssert.True(oldFormat.RuntimeThreadLatencyProfileEnabled, "old settings must use runtime thread latency profile default");
                TestAssert.Equal(CursorMirrorSettings.CurrentSettingsSchemaVersion, oldFormat.SettingsSchemaVersion, "old settings must be migrated to current schema version");

                File.WriteAllText(
                    path,
                    "{\"RuntimeThreadLatencyProfileEnabled\":false}",
                    System.Text.Encoding.UTF8);
                CursorMirrorSettings oldRuntimeProfileDefault = store.Load();
                TestAssert.True(oldRuntimeProfileDefault.RuntimeThreadLatencyProfileEnabled, "old settings migrate runtime latency profile to new default");
                TestAssert.Equal(CursorMirrorSettings.CurrentSettingsSchemaVersion, oldRuntimeProfileDefault.SettingsSchemaVersion, "old runtime profile setting schema migration");

                SettingsController controller = new SettingsController(store, loaded, delegate { }, delegate { });
                controller.ResetToDefaults();

                TestAssert.True(controller.CurrentSettings.PredictionEnabled, "reset restores prediction default");
            }
            finally
            {
                DeleteDirectory(directory);
            }
        }

        // Durable settings save validation [COT-MSU-10]
        private static void DurableSettingsSaveValidation()
        {
            string directory = NewTestDirectory();
            try
            {
                string path = Path.Combine(directory, "settings.json");
                SettingsStore store = new SettingsStore(path);
                CursorMirrorSettings first = CursorMirrorSettings.Default();
                first.MovingOpacityPercent = 41;
                CursorMirrorSettings second = CursorMirrorSettings.Default();
                second.MovingOpacityPercent = 82;

                store.Save(first);
                store.Save(second);

                CursorMirrorSettings loaded = store.Load();
                TestAssert.Equal(82, loaded.MovingOpacityPercent, "active settings replaced after validation");

                string[] backups = Directory.GetFiles(directory, "settings.json.bak.*");
                TestAssert.Equal(1, backups.Length, "one backup after replacing existing settings");
                CursorMirrorSettings backup = new SettingsStore(backups[0]).Load();
                TestAssert.Equal(41, backup.MovingOpacityPercent, "backup contains previous settings");

                string[] temporaryFiles = Directory.GetFiles(directory, "settings.json.tmp.*");
                TestAssert.Equal(0, temporaryFiles.Length, "temporary files are cleaned after save");
            }
            finally
            {
                DeleteDirectory(directory);
            }
        }

        // Settings backup retention [COT-MSU-11]
        private static void SettingsBackupRetention()
        {
            string directory = NewTestDirectory();
            try
            {
                string path = Path.Combine(directory, "settings.json");
                SettingsStore store = new SettingsStore(path);

                for (int i = 0; i < 8; i++)
                {
                    CursorMirrorSettings settings = CursorMirrorSettings.Default();
                    settings.MovingOpacityPercent = 20 + i;
                    store.Save(settings);
                }

                string[] backups = Directory.GetFiles(directory, "settings.json.bak.*");
                TestAssert.Equal(DurableJsonSettingsFile.DefaultBackupRetention, backups.Length, "backup retention count");
                TestAssert.Equal(27, store.Load().MovingOpacityPercent, "active settings are latest");
            }
            finally
            {
                DeleteDirectory(directory);
            }
        }

        // Failed staged save preserves active settings [COT-MSU-12]
        private static void FailedStagedSavePreservesActiveSettings()
        {
            string directory = NewTestDirectory();
            try
            {
                string path = Path.Combine(directory, "settings.json");
                SettingsStore store = new SettingsStore(path);
                CursorMirrorSettings active = CursorMirrorSettings.Default();
                active.MovingOpacityPercent = 55;
                store.Save(active);

                bool failed = false;
                try
                {
                    DurableJsonSettingsFile.Save(
                        path,
                        System.Text.Encoding.UTF8.GetBytes("{ this is not valid json"),
                        delegate
                        {
                            throw new InvalidDataException("validation failed");
                        });
                }
                catch (InvalidDataException)
                {
                    failed = true;
                }

                TestAssert.True(failed, "staged save validation failed");
                TestAssert.Equal(55, store.Load().MovingOpacityPercent, "active settings preserved after failed staged save");
                TestAssert.Equal(0, Directory.GetFiles(directory, "settings.json.tmp.*").Length, "failed staged save cleans temp file");
            }
            finally
            {
                DeleteDirectory(directory);
            }
        }

        private static CursorMirrorSettings ChangedSettings()
        {
            CursorMirrorSettings settings = CursorMirrorSettings.Default();
            settings.PredictionEnabled = false;
            settings.PredictionGainPercent = 85;
            settings.MovingOpacityPercent = 90;
            settings.FadeDurationMilliseconds = 160;
            settings.IdleDelayMilliseconds = 300;
            settings.IdleOpacityPercent = 20;
            settings.IdleFadeDurationMilliseconds = 170;
            settings.IdleFadeDelayMilliseconds = 5000;
            settings.RuntimeSetWaitableTimerExEnabled = false;
            settings.RuntimeFineWaitAdvanceMicroseconds = 1500;
            settings.RuntimeFineWaitYieldThresholdMicroseconds = 300;
            settings.RuntimeMessageDeferralEnabled = true;
            settings.RuntimeMessageDeferralMicroseconds = 700;
            settings.RuntimeThreadLatencyProfileEnabled = true;
            return settings;
        }

        private static string NewTestDirectory()
        {
            string directory = Path.Combine(Environment.CurrentDirectory, "artifacts", "test-settings", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(directory);
            return directory;
        }

        private static void DeleteDirectory(string directory)
        {
            if (Directory.Exists(directory))
            {
                Directory.Delete(directory, true);
            }
        }
    }
}
