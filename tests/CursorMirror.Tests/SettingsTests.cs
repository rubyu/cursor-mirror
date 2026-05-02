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

            TestAssert.True(settings.MovementTranslucencyEnabled, "default enabled");
            TestAssert.True(settings.PredictionEnabled, "prediction default enabled");
            TestAssert.Equal(70, settings.MovingOpacityPercent, "default moving opacity");
            TestAssert.Equal(80, settings.FadeDurationMilliseconds, "default fade duration");
            TestAssert.Equal(120, settings.IdleDelayMilliseconds, "default idle delay");
            TestAssert.True(settings.IdleFadeEnabled, "default idle fade enabled");
            TestAssert.Equal(3000, settings.IdleFadeDelayMilliseconds, "default idle fade delay");
            TestAssert.Equal(0, settings.IdleOpacityPercent, "default idle opacity");
            TestAssert.Equal(8, settings.PredictionHorizonMilliseconds, "default prediction horizon");
            TestAssert.Equal(100, settings.PredictionIdleResetMilliseconds, "default prediction idle reset");
            TestAssert.Equal(100, settings.PredictionGainPercent, "default prediction gain");
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
            settings.IdleFadeDelayMilliseconds = -1;
            settings.IdleOpacityPercent = -1;
            settings.PredictionHorizonMilliseconds = -1;
            settings.PredictionIdleResetMilliseconds = 0;
            settings.PredictionGainPercent = 1;
            CursorMirrorSettings low = settings.Normalize();

            settings.FadeDurationMilliseconds = 999;
            settings.IdleDelayMilliseconds = 999;
            settings.IdleFadeDelayMilliseconds = 999999;
            settings.IdleOpacityPercent = 999;
            settings.PredictionHorizonMilliseconds = 999;
            settings.PredictionIdleResetMilliseconds = 9999;
            settings.PredictionGainPercent = 999;
            CursorMirrorSettings high = settings.Normalize();

            TestAssert.Equal(0, low.FadeDurationMilliseconds, "fade duration lower clamp");
            TestAssert.Equal(50, low.IdleDelayMilliseconds, "idle delay lower clamp");
            TestAssert.Equal(0, low.IdleFadeDelayMilliseconds, "idle fade delay lower clamp");
            TestAssert.Equal(0, low.IdleOpacityPercent, "idle opacity lower clamp");
            TestAssert.Equal(0, low.PredictionHorizonMilliseconds, "prediction horizon lower clamp");
            TestAssert.Equal(1, low.PredictionIdleResetMilliseconds, "prediction idle reset lower clamp");
            TestAssert.Equal(50, low.PredictionGainPercent, "prediction gain lower clamp");
            TestAssert.Equal(300, high.FadeDurationMilliseconds, "fade duration upper clamp");
            TestAssert.Equal(500, high.IdleDelayMilliseconds, "idle delay upper clamp");
            TestAssert.Equal(60000, high.IdleFadeDelayMilliseconds, "idle fade delay upper clamp");
            TestAssert.Equal(99, high.IdleOpacityPercent, "idle opacity upper clamp");
            TestAssert.Equal(16, high.PredictionHorizonMilliseconds, "prediction horizon upper clamp");
            TestAssert.Equal(1000, high.PredictionIdleResetMilliseconds, "prediction idle reset upper clamp");
            TestAssert.Equal(150, high.PredictionGainPercent, "prediction gain upper clamp");
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
                settings.IdleFadeEnabled = false;
                settings.IdleFadeDelayMilliseconds = 4000;
                settings.IdleOpacityPercent = 12;

                store.Save(settings);
                CursorMirrorSettings loaded = store.Load();

                TestAssert.False(loaded.MovementTranslucencyEnabled, "loaded enabled flag");
                TestAssert.False(loaded.PredictionEnabled, "loaded prediction enabled flag");
                TestAssert.Equal(88, loaded.MovingOpacityPercent, "loaded opacity");
                TestAssert.Equal(240, loaded.FadeDurationMilliseconds, "loaded fade duration");
                TestAssert.Equal(450, loaded.IdleDelayMilliseconds, "loaded idle delay");
                TestAssert.Equal(12, loaded.PredictionHorizonMilliseconds, "loaded prediction horizon");
                TestAssert.Equal(250, loaded.PredictionIdleResetMilliseconds, "loaded prediction idle reset");
                TestAssert.Equal(85, loaded.PredictionGainPercent, "loaded prediction gain");
                TestAssert.False(loaded.IdleFadeEnabled, "loaded idle fade flag");
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

                TestAssert.Equal(70, settings.MovingOpacityPercent, "missing settings default");
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

                TestAssert.Equal(70, settings.MovingOpacityPercent, "corrupt settings default");
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
                TestAssert.Equal(70, controller.CurrentSettings.MovingOpacityPercent, "reset current opacity");
                TestAssert.True(controller.CurrentSettings.PredictionEnabled, "reset current prediction");
                TestAssert.Equal(70, applied.MovingOpacityPercent, "reset applied opacity");
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
            settings.IdleFadeDelayMilliseconds = 5000;
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
