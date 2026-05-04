using System;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Runtime.Serialization.Json;
using System.Text;
using CursorMirror.MotionLab;

namespace CursorMirror
{
    public sealed class MotionLabCalibrationMotionSource : ICalibrationMotionSource
    {
        private readonly MotionLabScenarioSet _scenarioSet;
        private readonly MotionLabScenarioSetSampler _sampler;

        public MotionLabCalibrationMotionSource(MotionLabScenarioSet scenarioSet)
        {
            if (scenarioSet == null)
            {
                throw new ArgumentNullException("scenarioSet");
            }

            _scenarioSet = NormalizeScenarioSet(scenarioSet);
            _sampler = new MotionLabScenarioSetSampler(_scenarioSet);
        }

        public string SourceName
        {
            get { return "motion-lab"; }
        }

        public string GenerationProfile
        {
            get { return _scenarioSet.GenerationProfile ?? string.Empty; }
        }

        public int ScenarioCount
        {
            get { return _sampler.ScenarioCount; }
        }

        public double TotalDurationMilliseconds
        {
            get { return _sampler.TotalDurationMilliseconds; }
        }

        public static MotionLabCalibrationMotionSource LoadPackage(string path)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                throw new ArgumentException("Motion package path must not be empty.", "path");
            }

            using (FileStream file = File.OpenRead(path))
            using (ZipArchive archive = new ZipArchive(file, ZipArchiveMode.Read))
            {
                ZipArchiveEntry entry = archive.GetEntry("motion-script.json");
                if (entry == null)
                {
                    throw new InvalidDataException("The motion package does not contain motion-script.json.");
                }

                string json;
                using (Stream stream = entry.Open())
                using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
                {
                    json = reader.ReadToEnd();
                }

                return new MotionLabCalibrationMotionSource(ReadScenarioSet(json));
            }
        }

        public CalibrationMotionSample GetSample(double elapsedMilliseconds)
        {
            MotionLabScenarioSetSample sample = _sampler.GetSample(elapsedMilliseconds);
            return new CalibrationMotionSample(
                elapsedMilliseconds,
                ScenarioName(sample.ScenarioIndex),
                sample.MovementPhase,
                (int)Math.Round(sample.X),
                (int)Math.Round(sample.Y),
                sample.VelocityPixelsPerSecond,
                SourceName,
                GenerationProfile,
                sample.ScenarioIndex,
                sample.ScenarioElapsedMilliseconds,
                sample.Progress,
                sample.HoldIndex,
                sample.PhaseElapsedMilliseconds);
        }

        private static MotionLabScenarioSet ReadScenarioSet(string json)
        {
            if (json == null)
            {
                throw new InvalidDataException("The motion package contains an empty motion script.");
            }

            if (json.IndexOf("cursor-mirror-motion-scenarios", StringComparison.OrdinalIgnoreCase) >= 0 ||
                json.IndexOf("\"Scenarios\"", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return Deserialize<MotionLabScenarioSet>(json);
            }

            MotionLabScript script = Deserialize<MotionLabScript>(json);
            MotionLabScenarioSet scenarioSet = new MotionLabScenarioSet();
            scenarioSet.Seed = script == null ? 0 : script.Seed;
            scenarioSet.GenerationProfile = script == null ? string.Empty : script.GenerationProfile;
            scenarioSet.DurationMilliseconds = script == null ? 0 : script.DurationMilliseconds;
            scenarioSet.ScenarioDurationMilliseconds = script == null ? 0 : script.DurationMilliseconds;
            scenarioSet.SampleRateHz = script == null ? 0 : script.SampleRateHz;
            scenarioSet.Scenarios = new[] { script ?? new MotionLabScript() };
            return scenarioSet;
        }

        private static T Deserialize<T>(string json)
        {
            using (MemoryStream stream = new MemoryStream(Encoding.UTF8.GetBytes(json)))
            {
                DataContractJsonSerializer serializer = new DataContractJsonSerializer(typeof(T));
                return (T)serializer.ReadObject(stream);
            }
        }

        private static MotionLabScenarioSet NormalizeScenarioSet(MotionLabScenarioSet source)
        {
            MotionLabScenarioSet normalized = new MotionLabScenarioSet();
            normalized.Seed = source.Seed;
            normalized.GenerationProfile = string.IsNullOrWhiteSpace(source.GenerationProfile)
                ? MotionLabGenerationProfile.Balanced
                : source.GenerationProfile;
            normalized.DurationMilliseconds = Math.Max(1.0, source.DurationMilliseconds);
            normalized.ScenarioDurationMilliseconds = Math.Max(1.0, source.ScenarioDurationMilliseconds);
            normalized.SampleRateHz = source.SampleRateHz <= 0 ? 60 : source.SampleRateHz;
            normalized.Scenarios = NormalizeScenarios(source.Scenarios);
            return normalized;
        }

        private static MotionLabScript[] NormalizeScenarios(MotionLabScript[] scenarios)
        {
            if (scenarios == null || scenarios.Length == 0)
            {
                return new[] { new MotionLabScript() };
            }

            MotionLabScript[] normalized = new MotionLabScript[scenarios.Length];
            for (int i = 0; i < scenarios.Length; i++)
            {
                normalized[i] = NormalizeScript(scenarios[i]);
            }

            return normalized;
        }

        private static MotionLabScript NormalizeScript(MotionLabScript source)
        {
            MotionLabScript script = source ?? new MotionLabScript();
            if (script.Bounds == null)
            {
                script.Bounds = new MotionLabBounds { X = 0, Y = 0, Width = 1, Height = 1 };
            }

            if (script.DurationMilliseconds <= 0)
            {
                script.DurationMilliseconds = 1;
            }

            if (script.SampleRateHz <= 0)
            {
                script.SampleRateHz = 60;
            }

            if (script.ControlPoints == null || script.ControlPoints.Length == 0)
            {
                Rectangle bounds = MotionLabGenerator.ToRectangle(script.Bounds);
                script.ControlPoints = new[]
                {
                    new MotionLabPoint(bounds.Left, bounds.Top),
                    new MotionLabPoint(bounds.Right, bounds.Bottom)
                };
            }

            if (script.SpeedPoints == null)
            {
                script.SpeedPoints = new MotionLabSpeedPoint[0];
            }

            if (script.HoldSegments == null)
            {
                script.HoldSegments = new MotionLabHoldSegment[0];
            }

            return script;
        }

        private static string ScenarioName(int scenarioIndex)
        {
            if (scenarioIndex < 0)
            {
                return string.Empty;
            }

            return "scenario-" + scenarioIndex.ToString("000", CultureInfo.InvariantCulture);
        }
    }
}
