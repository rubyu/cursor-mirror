using System;
using System.Collections.Generic;
using System.Drawing;

namespace CursorMirror
{
    public sealed class CalibrationMotionPatternSuite : ICalibrationMotionSource
    {
        private readonly Segment[] _segments;
        private readonly double _totalDurationMilliseconds;

        private CalibrationMotionPatternSuite(Segment[] segments)
        {
            _segments = segments;
            _totalDurationMilliseconds = segments.Length == 0 ? 0 : segments[segments.Length - 1].EndMilliseconds;
        }

        public double TotalDurationMilliseconds
        {
            get { return _totalDurationMilliseconds; }
        }

        public string SourceName
        {
            get { return "calibrator-default"; }
        }

        public string GenerationProfile
        {
            get { return "calibrator-default"; }
        }

        public int ScenarioCount
        {
            get { return 0; }
        }

        public static CalibrationMotionPatternSuite CreateDefault(Rectangle pathBounds)
        {
            int left = pathBounds.Left;
            int right = pathBounds.Right;
            int center = pathBounds.Left + (pathBounds.Width / 2);
            int jitterRange = Math.Max(20, pathBounds.Width / 6);
            int jitterLeft = center - (jitterRange / 2);
            int jitterRight = center + (jitterRange / 2);
            int y = pathBounds.Top + (pathBounds.Height / 2);

            List<Segment> segments = new List<Segment>();
            double start = 0;
            Add(segments, ref start, "linear-slow", "constant-speed", 1800, left, right, y, MotionCurve.Linear);
            Add(segments, ref start, "hold-right", "stationary", 250, right, right, y, MotionCurve.Hold);
            Add(segments, ref start, "linear-fast", "constant-speed", 650, right, left, y, MotionCurve.Linear);
            Add(segments, ref start, "hold-left", "stationary", 250, left, left, y, MotionCurve.Hold);
            Add(segments, ref start, "quadratic-ease-in", "accelerating", 1200, left, right, y, MotionCurve.QuadraticIn);
            Add(segments, ref start, "quadratic-ease-out", "decelerating", 1200, right, left, y, MotionCurve.QuadraticOut);
            Add(segments, ref start, "cubic-smoothstep", "ease-in-out", 1400, left, right, y, MotionCurve.CubicSmoothStep);
            Add(segments, ref start, "cubic-in-out", "strong-ease", 1000, right, left, y, MotionCurve.CubicInOut);
            Add(segments, ref start, "rapid-reversal", "bidirectional", 1000, left, right, y, MotionCurve.RapidReversal);
            Add(segments, ref start, "sine-sweep", "oscillating", 1400, left, right, y, MotionCurve.SineSweep);
            Add(segments, ref start, "short-jitter", "small-oscillation", 1000, jitterLeft, jitterRight, y, MotionCurve.Jitter);

            return new CalibrationMotionPatternSuite(segments.ToArray());
        }

        public string[] GetPatternNames()
        {
            List<string> names = new List<string>();
            for (int i = 0; i < _segments.Length; i++)
            {
                if (!names.Contains(_segments[i].PatternName))
                {
                    names.Add(_segments[i].PatternName);
                }
            }

            return names.ToArray();
        }

        public CalibrationMotionSample GetSample(double elapsedMilliseconds)
        {
            if (_segments.Length == 0 || _totalDurationMilliseconds <= 0)
            {
                return new CalibrationMotionSample(0, string.Empty, string.Empty, 0, 0, 0);
            }

            double wrapped = elapsedMilliseconds % _totalDurationMilliseconds;
            if (wrapped < 0)
            {
                wrapped += _totalDurationMilliseconds;
            }

            Segment segment = FindSegment(wrapped);
            double segmentElapsed = Math.Max(0, Math.Min(segment.DurationMilliseconds, wrapped - segment.StartMilliseconds));
            double x = segment.GetX(segmentElapsed);
            double velocity = segment.GetVelocityPixelsPerSecond(segmentElapsed);
            return new CalibrationMotionSample(
                elapsedMilliseconds,
                segment.PatternName,
                segment.PhaseName,
                (int)Math.Round(x),
                segment.Y,
                velocity,
                SourceName,
                GenerationProfile,
                -1,
                segmentElapsed,
                segment.DurationMilliseconds <= 0 ? 0 : segmentElapsed / segment.DurationMilliseconds,
                -1,
                segmentElapsed);
        }

        private Segment FindSegment(double elapsedMilliseconds)
        {
            for (int i = 0; i < _segments.Length; i++)
            {
                if (elapsedMilliseconds < _segments[i].EndMilliseconds)
                {
                    return _segments[i];
                }
            }

            return _segments[_segments.Length - 1];
        }

        private static void Add(
            IList<Segment> segments,
            ref double startMilliseconds,
            string patternName,
            string phaseName,
            double durationMilliseconds,
            int fromX,
            int toX,
            int y,
            MotionCurve curve)
        {
            Segment segment = new Segment(
                patternName,
                phaseName,
                startMilliseconds,
                durationMilliseconds,
                fromX,
                toX,
                y,
                curve);
            segments.Add(segment);
            startMilliseconds += durationMilliseconds;
        }

        private enum MotionCurve
        {
            Hold,
            Linear,
            QuadraticIn,
            QuadraticOut,
            CubicSmoothStep,
            CubicInOut,
            RapidReversal,
            SineSweep,
            Jitter
        }

        private sealed class Segment
        {
            public Segment(
                string patternName,
                string phaseName,
                double startMilliseconds,
                double durationMilliseconds,
                int fromX,
                int toX,
                int y,
                MotionCurve curve)
            {
                PatternName = patternName;
                PhaseName = phaseName;
                StartMilliseconds = startMilliseconds;
                DurationMilliseconds = Math.Max(1, durationMilliseconds);
                EndMilliseconds = StartMilliseconds + DurationMilliseconds;
                FromX = fromX;
                ToX = toX;
                Y = y;
                Curve = curve;
            }

            public string PatternName { get; private set; }
            public string PhaseName { get; private set; }
            public double StartMilliseconds { get; private set; }
            public double DurationMilliseconds { get; private set; }
            public double EndMilliseconds { get; private set; }
            public int FromX { get; private set; }
            public int ToX { get; private set; }
            public int Y { get; private set; }
            public MotionCurve Curve { get; private set; }

            public double GetX(double elapsedMilliseconds)
            {
                double p = Clamp01(elapsedMilliseconds / DurationMilliseconds);
                if (Curve == MotionCurve.Hold)
                {
                    return FromX;
                }

                if (Curve == MotionCurve.RapidReversal)
                {
                    if (p < 0.5)
                    {
                        return Lerp(FromX, ToX, SmoothStep(p / 0.5));
                    }

                    return Lerp(ToX, FromX, SmoothStep((p - 0.5) / 0.5));
                }

                if (Curve == MotionCurve.SineSweep)
                {
                    double wave = (1.0 - Math.Cos(Math.PI * 2.0 * p)) / 2.0;
                    return Lerp(FromX, ToX, wave);
                }

                if (Curve == MotionCurve.Jitter)
                {
                    double center = FromX + ((ToX - FromX) / 2.0);
                    double amplitude = Math.Abs(ToX - FromX) / 2.0;
                    return center + (Math.Sin(Math.PI * 2.0 * 4.0 * p) * amplitude);
                }

                return Lerp(FromX, ToX, ApplyCurve(p, Curve));
            }

            public double GetVelocityPixelsPerSecond(double elapsedMilliseconds)
            {
                double before = Math.Max(0, elapsedMilliseconds - 1.0);
                double after = Math.Min(DurationMilliseconds, elapsedMilliseconds + 1.0);
                if (after <= before)
                {
                    return 0;
                }

                return Math.Abs(GetX(after) - GetX(before)) / (after - before) * 1000.0;
            }

            private static double ApplyCurve(double p, MotionCurve curve)
            {
                if (curve == MotionCurve.Linear)
                {
                    return p;
                }

                if (curve == MotionCurve.QuadraticIn)
                {
                    return p * p;
                }

                if (curve == MotionCurve.QuadraticOut)
                {
                    double inverse = 1.0 - p;
                    return 1.0 - (inverse * inverse);
                }

                if (curve == MotionCurve.CubicSmoothStep)
                {
                    return SmoothStep(p);
                }

                if (curve == MotionCurve.CubicInOut)
                {
                    if (p < 0.5)
                    {
                        return 4.0 * p * p * p;
                    }

                    double inverse = -2.0 * p + 2.0;
                    return 1.0 - ((inverse * inverse * inverse) / 2.0);
                }

                return p;
            }

            private static double SmoothStep(double value)
            {
                double x = Clamp01(value);
                return x * x * (3.0 - (2.0 * x));
            }

            private static double Clamp01(double value)
            {
                return Math.Max(0, Math.Min(1, value));
            }

            private static double Lerp(int start, int end, double progress)
            {
                return start + ((end - start) * progress);
            }
        }
    }
}
