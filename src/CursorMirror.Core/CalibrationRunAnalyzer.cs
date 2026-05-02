using System;
using System.Collections.Generic;

namespace CursorMirror
{
    public static class CalibrationRunAnalyzer
    {
        public static CalibrationSummary Summarize(IList<CalibrationFrameAnalysis> frames, string captureSource)
        {
            if (frames == null)
            {
                throw new ArgumentNullException("frames");
            }

            List<int> separations = new List<int>();
            Dictionary<string, List<int>> patternSeparations = new Dictionary<string, List<int>>();
            Dictionary<string, int> patternFrameCounts = new Dictionary<string, int>();
            Dictionary<string, int> patternDarkFrameCounts = new Dictionary<string, int>();
            List<string> patternOrder = new List<string>();
            int baselineWidth = 0;
            int baselineHeight = 0;
            int darkFrameCount = 0;

            for (int i = 0; i < frames.Count; i++)
            {
                CalibrationFrameAnalysis frame = frames[i];
                if (frame != null && frame.HasDarkPixels)
                {
                    darkFrameCount++;
                    if (baselineWidth == 0 || frame.DarkBoundsWidth < baselineWidth)
                    {
                        baselineWidth = frame.DarkBoundsWidth;
                    }

                    if (baselineHeight == 0 || frame.DarkBoundsHeight < baselineHeight)
                    {
                        baselineHeight = frame.DarkBoundsHeight;
                    }
                }
            }

            double total = 0;
            for (int i = 0; i < frames.Count; i++)
            {
                CalibrationFrameAnalysis frame = frames[i];
                string patternName = frame == null ? string.Empty : frame.PatternName;
                if (!string.IsNullOrEmpty(patternName))
                {
                    EnsurePattern(patternName, patternOrder, patternSeparations, patternFrameCounts, patternDarkFrameCounts);
                    patternFrameCounts[patternName] = patternFrameCounts[patternName] + 1;
                }

                if (frame != null && frame.HasDarkPixels)
                {
                    int separation = EstimateSeparation(frame, baselineWidth, baselineHeight);
                    separations.Add(separation);
                    total += separation;

                    if (!string.IsNullOrEmpty(patternName))
                    {
                        patternSeparations[patternName].Add(separation);
                        patternDarkFrameCounts[patternName] = patternDarkFrameCounts[patternName] + 1;
                    }
                }
            }

            separations.Sort();

            CalibrationSummary summary = new CalibrationSummary();
            summary.FrameCount = frames.Count;
            summary.DarkFrameCount = darkFrameCount;
            summary.BaselineDarkBoundsWidth = baselineWidth;
            summary.BaselineDarkBoundsHeight = baselineHeight;
            summary.AverageEstimatedSeparationPixels = separations.Count == 0 ? 0 : total / separations.Count;
            summary.P95EstimatedSeparationPixels = Percentile(separations, 0.95);
            summary.MaximumEstimatedSeparationPixels = separations.Count == 0 ? 0 : separations[separations.Count - 1];
            summary.CaptureSource = captureSource ?? string.Empty;
            summary.PatternSummaries = BuildPatternSummaries(patternOrder, patternSeparations, patternFrameCounts, patternDarkFrameCounts);
            return summary;
        }

        private static int EstimateSeparation(CalibrationFrameAnalysis frame, int baselineWidth, int baselineHeight)
        {
            return Math.Max(
                Math.Max(0, frame.DarkBoundsWidth - baselineWidth),
                Math.Max(0, frame.DarkBoundsHeight - baselineHeight));
        }

        private static void EnsurePattern(
            string patternName,
            IList<string> patternOrder,
            IDictionary<string, List<int>> patternSeparations,
            IDictionary<string, int> patternFrameCounts,
            IDictionary<string, int> patternDarkFrameCounts)
        {
            if (patternFrameCounts.ContainsKey(patternName))
            {
                return;
            }

            patternOrder.Add(patternName);
            patternSeparations[patternName] = new List<int>();
            patternFrameCounts[patternName] = 0;
            patternDarkFrameCounts[patternName] = 0;
        }

        private static CalibrationPatternSummary[] BuildPatternSummaries(
            IList<string> patternOrder,
            IDictionary<string, List<int>> patternSeparations,
            IDictionary<string, int> patternFrameCounts,
            IDictionary<string, int> patternDarkFrameCounts)
        {
            CalibrationPatternSummary[] summaries = new CalibrationPatternSummary[patternOrder.Count];
            for (int i = 0; i < patternOrder.Count; i++)
            {
                string patternName = patternOrder[i];
                List<int> separations = patternSeparations[patternName];
                separations.Sort();

                double total = 0;
                for (int j = 0; j < separations.Count; j++)
                {
                    total += separations[j];
                }

                CalibrationPatternSummary summary = new CalibrationPatternSummary();
                summary.PatternName = patternName;
                summary.FrameCount = patternFrameCounts[patternName];
                summary.DarkFrameCount = patternDarkFrameCounts[patternName];
                summary.AverageEstimatedSeparationPixels = separations.Count == 0 ? 0 : total / separations.Count;
                summary.P95EstimatedSeparationPixels = Percentile(separations, 0.95);
                summary.MaximumEstimatedSeparationPixels = separations.Count == 0 ? 0 : separations[separations.Count - 1];
                summaries[i] = summary;
            }

            return summaries;
        }

        private static double Percentile(IList<int> sortedValues, double percentile)
        {
            if (sortedValues == null || sortedValues.Count == 0)
            {
                return 0;
            }

            double safePercentile = Math.Max(0, Math.Min(1, percentile));
            int index = (int)Math.Ceiling(sortedValues.Count * safePercentile) - 1;
            index = Math.Max(0, Math.Min(sortedValues.Count - 1, index));
            return sortedValues[index];
        }
    }
}
