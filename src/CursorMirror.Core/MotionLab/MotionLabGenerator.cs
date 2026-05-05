using System;
using System.Collections.Generic;
using System.Drawing;

namespace CursorMirror.MotionLab
{
    public static class MotionLabGenerator
    {
        public const int MinimumControlPoints = 2;
        public const int MaximumControlPoints = 16;
        public const int MinimumSpeedPoints = 0;
        public const int MaximumSpeedPoints = 32;
        public const int MinimumScenarioCount = 1;
        public const int MaximumScenarioCount = 64;

        public static MotionLabScript Generate(
            int seed,
            Rectangle bounds,
            Point startPoint,
            int controlPointCount,
            int speedPointCount,
            double durationMilliseconds,
            int sampleRateHz)
        {
            return Generate(
                seed,
                bounds,
                startPoint,
                controlPointCount,
                speedPointCount,
                durationMilliseconds,
                sampleRateHz,
                MotionLabGenerationProfile.Balanced);
        }

        public static MotionLabScript Generate(
            int seed,
            Rectangle bounds,
            Point startPoint,
            int controlPointCount,
            int speedPointCount,
            double durationMilliseconds,
            int sampleRateHz,
            string generationProfile)
        {
            Rectangle normalizedBounds = NormalizeBounds(bounds);
            int normalizedControlPointCount = Clamp(controlPointCount, MinimumControlPoints, MaximumControlPoints);
            int normalizedSpeedPointCount = Clamp(speedPointCount, MinimumSpeedPoints, MaximumSpeedPoints);
            string normalizedProfile = NormalizeProfile(generationProfile);
            bool realTraceWeighted = string.Equals(normalizedProfile, MotionLabGenerationProfile.RealTraceWeighted, StringComparison.Ordinal);
            MotionLabRandom random = new MotionLabRandom((ulong)(uint)seed);

            MotionLabPoint start = ClipPoint(startPoint.X, startPoint.Y, normalizedBounds);
            MotionLabPoint end = RandomPoint(random, normalizedBounds);

            MotionLabPoint[] controlPoints = new MotionLabPoint[normalizedControlPointCount];
            controlPoints[0] = start;
            controlPoints[normalizedControlPointCount - 1] = end;
            for (int i = 1; i < normalizedControlPointCount - 1; i++)
            {
                double blend = i / (double)(normalizedControlPointCount - 1);
                double lineX = Lerp(start.X, end.X, blend);
                double lineY = Lerp(start.Y, end.Y, blend);
                double randomX = RandomRange(random, normalizedBounds.Left, normalizedBounds.Right);
                double randomY = RandomRange(random, normalizedBounds.Top, normalizedBounds.Bottom);
                double weight = realTraceWeighted
                    ? 0.08 + (random.NextDouble() * 0.32)
                    : 0.35 + (random.NextDouble() * 0.55);
                controlPoints[i] = ClipPoint(
                    Lerp(lineX, randomX, weight),
                    Lerp(lineY, randomY, weight),
                    normalizedBounds);
            }

            MotionLabSpeedPoint[] speedPoints = new MotionLabSpeedPoint[normalizedSpeedPointCount];
            for (int i = 0; i < speedPoints.Length; i++)
            {
                speedPoints[i] = new MotionLabSpeedPoint
                {
                    Progress = random.NextDouble(),
                    Multiplier = realTraceWeighted ? PickRealTraceWeightedMultiplier(random) : RandomRange(random, 0.35, 2.75),
                    EasingWidth = realTraceWeighted ? RandomRange(random, 0.08, 0.30) : RandomRange(random, 0.04, 0.18),
                    Easing = realTraceWeighted ? PickRealTraceWeightedEasing(random) : PickEasing(random)
                };
            }

            if (realTraceWeighted)
            {
                EnsureVerySlowSpeedPoint(random, speedPoints);
            }

            Array.Sort(speedPoints, CompareSpeedPoints);
            MotionLabHoldSegment[] holdSegments = realTraceWeighted
                ? GenerateHoldSegments(random, Math.Max(1.0, durationMilliseconds))
                : new MotionLabHoldSegment[0];

            MotionLabScript script = new MotionLabScript();
            script.Seed = seed;
            script.GenerationProfile = normalizedProfile;
            script.Bounds = new MotionLabBounds
            {
                X = normalizedBounds.X,
                Y = normalizedBounds.Y,
                Width = normalizedBounds.Width,
                Height = normalizedBounds.Height
            };
            script.DurationMilliseconds = Math.Max(1.0, durationMilliseconds);
            script.SampleRateHz = Math.Max(1, sampleRateHz);
            script.ControlPoints = controlPoints;
            script.SpeedPoints = speedPoints;
            script.HoldSegments = holdSegments;
            return script;
        }

        public static MotionLabScenarioSet GenerateScenarioSet(
            int seed,
            Rectangle bounds,
            Point startPoint,
            int scenarioCount,
            int controlPointCount,
            int speedPointCount,
            double scenarioDurationMilliseconds,
            int sampleRateHz,
            string generationProfile)
        {
            Rectangle normalizedBounds = NormalizeBounds(bounds);
            int normalizedScenarioCount = Clamp(scenarioCount, MinimumScenarioCount, MaximumScenarioCount);
            double scenarioDuration = Math.Max(1.0, scenarioDurationMilliseconds);
            double totalDuration = scenarioDuration * normalizedScenarioCount;
            string normalizedProfile = NormalizeProfile(generationProfile);
            MotionLabScript[] scenarios = new MotionLabScript[normalizedScenarioCount];
            Point currentStart = new Point(
                (int)Math.Round(ClipPoint(startPoint.X, startPoint.Y, normalizedBounds).X),
                (int)Math.Round(ClipPoint(startPoint.X, startPoint.Y, normalizedBounds).Y));

            for (int i = 0; i < scenarios.Length; i++)
            {
                ulong scenarioSeed = MotionLabRandom.DeriveScenarioSeed(seed, i);
                MotionLabScript scenario = Generate(
                    unchecked((int)(scenarioSeed & 0x7FFFFFFF)),
                    normalizedBounds,
                    currentStart,
                    controlPointCount,
                    speedPointCount,
                    scenarioDuration,
                    sampleRateHz,
                    normalizedProfile);
                scenarios[i] = scenario;
                MotionLabPoint[] points = scenario.ControlPoints ?? new MotionLabPoint[0];
                if (points.Length > 0)
                {
                    MotionLabPoint end = points[points.Length - 1];
                    currentStart = new Point((int)Math.Round(end.X), (int)Math.Round(end.Y));
                }
            }

            MotionLabScenarioSet scenarioSet = new MotionLabScenarioSet();
            scenarioSet.Seed = seed;
            scenarioSet.GenerationProfile = normalizedProfile;
            scenarioSet.DurationMilliseconds = totalDuration;
            scenarioSet.ScenarioDurationMilliseconds = scenarioDuration;
            scenarioSet.SampleRateHz = Math.Max(1, sampleRateHz);
            scenarioSet.Scenarios = scenarios;
            return scenarioSet;
        }

        public static Rectangle ToRectangle(MotionLabBounds bounds)
        {
            if (bounds == null)
            {
                return new Rectangle(0, 0, 1, 1);
            }

            return NormalizeBounds(new Rectangle(bounds.X, bounds.Y, bounds.Width, bounds.Height));
        }

        public static MotionLabPoint ClipPoint(double x, double y, Rectangle bounds)
        {
            Rectangle normalized = NormalizeBounds(bounds);
            return new MotionLabPoint(
                Math.Max(normalized.Left, Math.Min(normalized.Right, x)),
                Math.Max(normalized.Top, Math.Min(normalized.Bottom, y)));
        }

        private static Rectangle NormalizeBounds(Rectangle bounds)
        {
            int width = Math.Max(1, bounds.Width);
            int height = Math.Max(1, bounds.Height);
            return new Rectangle(bounds.X, bounds.Y, width, height);
        }

        private static MotionLabPoint RandomPoint(MotionLabRandom random, Rectangle bounds)
        {
            return new MotionLabPoint(
                RandomRange(random, bounds.Left, bounds.Right),
                RandomRange(random, bounds.Top, bounds.Bottom));
        }

        private static double RandomRange(MotionLabRandom random, double minimum, double maximum)
        {
            return minimum + ((maximum - minimum) * random.NextDouble());
        }

        private static double Lerp(double start, double end, double progress)
        {
            return start + ((end - start) * progress);
        }

        private static int CompareSpeedPoints(MotionLabSpeedPoint left, MotionLabSpeedPoint right)
        {
            if (left == null && right == null)
            {
                return 0;
            }

            if (left == null)
            {
                return -1;
            }

            if (right == null)
            {
                return 1;
            }

            return left.Progress.CompareTo(right.Progress);
        }

        private static string PickEasing(MotionLabRandom random)
        {
            int value = random.NextInt(3);
            if (value == 0)
            {
                return "linear";
            }

            if (value == 1)
            {
                return "smoothstep";
            }

            return "sine";
        }

        private static double PickRealTraceWeightedMultiplier(MotionLabRandom random)
        {
            double bucket = random.NextDouble();
            if (bucket < 0.72)
            {
                return RandomRange(random, 0.03, 0.22);
            }

            if (bucket < 0.90)
            {
                return RandomRange(random, 0.22, 0.55);
            }

            if (bucket < 0.98)
            {
                return RandomRange(random, 0.55, 1.10);
            }

            return RandomRange(random, 1.10, 2.25);
        }

        private static string PickRealTraceWeightedEasing(MotionLabRandom random)
        {
            int value = random.NextInt(10);
            if (value < 6)
            {
                return "smoothstep";
            }

            if (value < 9)
            {
                return "sine";
            }

            return "linear";
        }

        private static void EnsureVerySlowSpeedPoint(MotionLabRandom random, MotionLabSpeedPoint[] speedPoints)
        {
            if (speedPoints == null || speedPoints.Length == 0)
            {
                return;
            }

            for (int i = 0; i < speedPoints.Length; i++)
            {
                if (speedPoints[i] != null && speedPoints[i].Multiplier <= 0.22)
                {
                    return;
                }
            }

            speedPoints[0].Multiplier = RandomRange(random, 0.03, 0.18);
            speedPoints[0].Easing = "smoothstep";
            speedPoints[0].EasingWidth = RandomRange(random, 0.12, 0.30);
        }

        private static MotionLabHoldSegment[] GenerateHoldSegments(MotionLabRandom random, double durationMilliseconds)
        {
            int holdCount = PickHoldCount(random, durationMilliseconds);
            if (holdCount <= 0)
            {
                return new MotionLabHoldSegment[0];
            }

            MotionLabHoldSegment[] holds = new MotionLabHoldSegment[holdCount];
            for (int i = 0; i < holds.Length; i++)
            {
                holds[i] = new MotionLabHoldSegment
                {
                    Progress = RandomHoldProgress(random, i, holdCount),
                    DurationMilliseconds = PickHoldDuration(random, durationMilliseconds),
                    ResumeEasingMilliseconds = RandomRange(random, 50, 180)
                };
            }

            Array.Sort(holds, CompareHoldSegments);
            ScaleHoldDurations(holds, Math.Max(1.0, durationMilliseconds * 0.45));
            return holds;
        }

        private static int PickHoldCount(MotionLabRandom random, double durationMilliseconds)
        {
            int baseCount = Math.Max(1, (int)Math.Round(durationMilliseconds / 2500.0));
            double bucket = random.NextDouble();
            if (bucket < 0.20)
            {
                baseCount--;
            }
            else if (bucket > 0.78)
            {
                baseCount++;
            }

            return Clamp(baseCount, 1, 8);
        }

        private static double RandomHoldProgress(MotionLabRandom random, int index, int count)
        {
            double band = 0.88 / Math.Max(1, count);
            double start = 0.06 + (band * index);
            double end = start + band;
            return RandomRange(random, start, Math.Min(0.96, end));
        }

        private static double PickHoldDuration(MotionLabRandom random, double scenarioDurationMilliseconds)
        {
            double bucket = random.NextDouble();
            double duration;
            if (bucket < 0.62)
            {
                duration = RandomRange(random, 80, 260);
            }
            else if (bucket < 0.90)
            {
                duration = RandomRange(random, 260, 850);
            }
            else
            {
                duration = RandomRange(random, 850, 2200);
            }

            return Math.Min(duration, Math.Max(80.0, scenarioDurationMilliseconds * 0.20));
        }

        private static void ScaleHoldDurations(MotionLabHoldSegment[] holds, double maximumTotalDuration)
        {
            double total = 0;
            for (int i = 0; i < holds.Length; i++)
            {
                total += Math.Max(0.0, holds[i].DurationMilliseconds);
            }

            if (total <= maximumTotalDuration || total <= 0)
            {
                return;
            }

            double scale = maximumTotalDuration / total;
            for (int i = 0; i < holds.Length; i++)
            {
                holds[i].DurationMilliseconds = Math.Max(40.0, holds[i].DurationMilliseconds * scale);
                holds[i].ResumeEasingMilliseconds = Math.Min(holds[i].ResumeEasingMilliseconds, holds[i].DurationMilliseconds);
            }
        }

        private static int CompareHoldSegments(MotionLabHoldSegment left, MotionLabHoldSegment right)
        {
            if (left == null && right == null)
            {
                return 0;
            }

            if (left == null)
            {
                return -1;
            }

            if (right == null)
            {
                return 1;
            }

            return left.Progress.CompareTo(right.Progress);
        }

        private static string NormalizeProfile(string generationProfile)
        {
            if (string.Equals(generationProfile, MotionLabGenerationProfile.RealTraceWeighted, StringComparison.OrdinalIgnoreCase))
            {
                return MotionLabGenerationProfile.RealTraceWeighted;
            }

            return MotionLabGenerationProfile.Balanced;
        }

        private static int Clamp(int value, int minimum, int maximum)
        {
            return Math.Max(minimum, Math.Min(maximum, value));
        }
    }
}
