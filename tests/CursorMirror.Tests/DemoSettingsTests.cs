using System;
using System.IO;

namespace CursorMirror.Tests
{
    internal static class DemoSettingsTests
    {
        public static void AddTo(TestSuite suite)
        {
            suite.Add("COT-MEU-8", DemoSettingsDefaults);
            suite.Add("COT-MEU-9", DemoSettingsPersistence);
            suite.Add("COT-MEU-10", DurableDemoSettingsSave);
            suite.Add("COT-MEU-12", DemoOverlayControlStateDependencies);
        }

        // Demo settings defaults [COT-MEU-8]
        private static void DemoSettingsDefaults()
        {
            DemoSettings settings = DemoSettings.Default();

            TestAssert.Equal(DemoLanguage.Auto, settings.Language, "default language");
            TestAssert.Equal(0, settings.DisplayModeIndex, "default display mode is VGA");
            TestAssert.Equal(0, settings.SpeedIndex, "default speed is normal");
            TestAssert.True(settings.MirrorCursorEnabled, "default mirror cursor enabled");
            TestAssert.True(settings.CursorSettings.PredictionEnabled, "default prediction enabled");
            TestAssert.Equal(CursorMirrorSettings.DwmPredictionModelConstantVelocity, settings.CursorSettings.DwmPredictionModel, "default prediction model");
            TestAssert.Equal(100, settings.CursorSettings.PredictionGainPercent, "default prediction gain");
            TestAssert.True(settings.CursorSettings.IdleFadeEnabled, "default idle fade enabled");
            TestAssert.Equal(300, settings.CursorSettings.IdleFadeDurationMilliseconds, "default idle fade duration");

            settings.Language = "bad";
            settings.DisplayModeIndex = 99;
            settings.SpeedIndex = 99;
            settings.CursorSettings.MovingOpacityPercent = 999;
            DemoSettings normalized = settings.Normalize();

            TestAssert.Equal(DemoLanguage.Auto, normalized.Language, "invalid language falls back to auto");
            TestAssert.Equal(DemoSettings.MaximumDisplayModeIndex, normalized.DisplayModeIndex, "display mode upper clamp");
            TestAssert.Equal(DemoSettings.MaximumSpeedIndex, normalized.SpeedIndex, "speed upper clamp");
            TestAssert.Equal(CursorMirrorSettings.MaximumMovingOpacityPercent, normalized.CursorSettings.MovingOpacityPercent, "nested cursor settings normalize");
        }

        // Demo settings persistence [COT-MEU-9]
        private static void DemoSettingsPersistence()
        {
            string directory = NewTestDirectory();
            try
            {
                string path = Path.Combine(directory, "demo-settings.json");
                DemoSettingsStore store = new DemoSettingsStore(path);
                DemoSettings settings = DemoSettings.Default();
                settings.Language = DemoLanguage.Japanese;
                settings.DisplayModeIndex = 2;
                settings.SpeedIndex = 2;
                settings.MirrorCursorEnabled = false;
                settings.CursorSettings.PredictionEnabled = false;
                settings.CursorSettings.DwmPredictionModel = CursorMirrorSettings.DwmPredictionModelConstantVelocity;
                settings.CursorSettings.PredictionGainPercent = 90;
                settings.CursorSettings.MovingOpacityPercent = 42;
                settings.CursorSettings.IdleFadeEnabled = false;
                settings.CursorSettings.IdleFadeDurationMilliseconds = 120;
                settings.CursorSettings.IdleFadeDelayMilliseconds = 5000;
                settings.CursorSettings.IdleOpacityPercent = 15;

                store.Save(settings);
                DemoSettings loaded = store.Load();

                TestAssert.Equal(DemoLanguage.Japanese, loaded.Language, "loaded language");
                TestAssert.Equal(2, loaded.DisplayModeIndex, "loaded display mode");
                TestAssert.Equal(2, loaded.SpeedIndex, "loaded speed");
                TestAssert.False(loaded.MirrorCursorEnabled, "loaded mirror cursor flag");
                TestAssert.False(loaded.CursorSettings.PredictionEnabled, "loaded prediction flag");
                TestAssert.Equal(CursorMirrorSettings.DwmPredictionModelConstantVelocity, loaded.CursorSettings.DwmPredictionModel, "loaded prediction model");
                TestAssert.Equal(90, loaded.CursorSettings.PredictionGainPercent, "loaded prediction gain");
                TestAssert.Equal(42, loaded.CursorSettings.MovingOpacityPercent, "loaded moving opacity");
                TestAssert.False(loaded.CursorSettings.IdleFadeEnabled, "loaded idle fade flag");
                TestAssert.Equal(120, loaded.CursorSettings.IdleFadeDurationMilliseconds, "loaded idle fade duration");
                TestAssert.Equal(5000, loaded.CursorSettings.IdleFadeDelayMilliseconds, "loaded idle fade delay");
                TestAssert.Equal(15, loaded.CursorSettings.IdleOpacityPercent, "loaded idle opacity");

                string missingFailureMessage;
                DemoSettings missing = new DemoSettingsStore(Path.Combine(directory, "missing.json")).Load(out missingFailureMessage);
                TestAssert.Equal(0, missing.DisplayModeIndex, "missing settings default display mode");
                TestAssert.Equal(null, missingFailureMessage, "missing demo settings is not restore failure");

                string corruptPath = Path.Combine(directory, "corrupt-demo-settings.json");
                File.WriteAllText(corruptPath, "{ this is not valid json", System.Text.Encoding.UTF8);
                string corruptFailureMessage;
                DemoSettings corrupt = new DemoSettingsStore(corruptPath).Load(out corruptFailureMessage);

                TestAssert.Equal(0, corrupt.DisplayModeIndex, "corrupt settings default display mode");
                TestAssert.True(corrupt.MirrorCursorEnabled, "corrupt settings default mirror flag");
                TestAssert.True(!string.IsNullOrWhiteSpace(corruptFailureMessage), "corrupt demo settings restore failure message");
            }
            finally
            {
                DeleteDirectory(directory);
            }
        }

        // Durable demo settings save [COT-MEU-10]
        private static void DurableDemoSettingsSave()
        {
            string directory = NewTestDirectory();
            try
            {
                string path = Path.Combine(directory, "demo-settings.json");
                DemoSettingsStore store = new DemoSettingsStore(path);
                DemoSettings first = DemoSettings.Default();
                first.DisplayModeIndex = 1;
                DemoSettings second = DemoSettings.Default();
                second.DisplayModeIndex = 2;

                store.Save(first);
                store.Save(second);

                TestAssert.Equal(2, store.Load().DisplayModeIndex, "active demo settings replaced after validation");

                string[] backups = Directory.GetFiles(directory, "demo-settings.json.bak.*");
                TestAssert.Equal(1, backups.Length, "one demo settings backup after replace");
                DemoSettings backup = new DemoSettingsStore(backups[0]).Load();
                TestAssert.Equal(1, backup.DisplayModeIndex, "demo backup contains previous settings");

                string[] temporaryFiles = Directory.GetFiles(directory, "demo-settings.json.tmp.*");
                TestAssert.Equal(0, temporaryFiles.Length, "demo temporary files are cleaned after save");
            }
            finally
            {
                DeleteDirectory(directory);
            }
        }

        // Demo overlay control state dependencies [COT-MEU-12]
        private static void DemoOverlayControlStateDependencies()
        {
            DemoOverlayControlState mirrorDisabled = DemoOverlayControlState.From(false, true, true, true);
            TestAssert.False(mirrorDisabled.OverlaySettingsEnabled, "mirror disabled overlay settings");
            TestAssert.False(mirrorDisabled.PredictionModelEnabled, "mirror disabled prediction model");
            TestAssert.False(mirrorDisabled.PredictionGainEnabled, "mirror disabled prediction gain");
            TestAssert.False(mirrorDisabled.MovementTranslucencyInputsEnabled, "mirror disabled movement inputs");
            TestAssert.False(mirrorDisabled.IdleFadeInputsEnabled, "mirror disabled idle fade inputs");

            DemoOverlayControlState featureDisabled = DemoOverlayControlState.From(true, false, false, false);
            TestAssert.True(featureDisabled.OverlaySettingsEnabled, "mirror enabled overlay settings");
            TestAssert.False(featureDisabled.PredictionModelEnabled, "prediction disabled model");
            TestAssert.False(featureDisabled.PredictionGainEnabled, "prediction disabled gain");
            TestAssert.False(featureDisabled.MovementTranslucencyInputsEnabled, "movement disabled inputs");
            TestAssert.False(featureDisabled.IdleFadeInputsEnabled, "idle fade disabled inputs");

            DemoOverlayControlState featureEnabled = DemoOverlayControlState.From(true, true, true, true);
            TestAssert.True(featureEnabled.PredictionModelEnabled, "prediction enabled model");
            TestAssert.True(featureEnabled.PredictionGainEnabled, "prediction enabled gain");
            TestAssert.True(featureEnabled.MovementTranslucencyInputsEnabled, "movement enabled inputs");
            TestAssert.True(featureEnabled.IdleFadeInputsEnabled, "idle fade enabled inputs");
        }

        private static string NewTestDirectory()
        {
            string directory = Path.Combine(Environment.CurrentDirectory, "artifacts", "test-demo-settings", Guid.NewGuid().ToString("N"));
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
