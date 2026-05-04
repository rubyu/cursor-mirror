using System;

namespace CursorMirror.MotionLab
{
    public sealed class MotionLabSampler
    {
        private const int LookupSteps = 256;
        private readonly MotionLabScript _script;
        private readonly double[] _progressByTime = new double[LookupSteps + 1];
        private readonly MotionLabHoldSegment[] _holdSegments;
        private readonly double _holdDurationMilliseconds;

        public MotionLabSampler(MotionLabScript script)
        {
            if (script == null)
            {
                throw new ArgumentNullException("script");
            }

            _script = script;
            BuildTimeLookup();
            _holdSegments = NormalizeHoldSegments(script.HoldSegments, Math.Max(1.0, script.DurationMilliseconds));
            _holdDurationMilliseconds = SumHoldDurations(_holdSegments);
        }

        public MotionLabSample GetSample(double elapsedMilliseconds)
        {
            double duration = Math.Max(1.0, _script.DurationMilliseconds);
            double clampedElapsed = Math.Max(0.0, Math.Min(duration, elapsedMilliseconds));
            ProgressInfo progressInfo = ProgressInfoAtElapsed(clampedElapsed);
            double curveProgress = progressInfo.Progress;
            MotionLabPoint point = EvaluateBezier(curveProgress);
            MotionLabPoint before = EvaluateBezier(ProgressAtElapsed(Math.Max(0.0, clampedElapsed - 1.0)));
            MotionLabPoint after = EvaluateBezier(ProgressAtElapsed(Math.Min(duration, clampedElapsed + 1.0)));
            double velocity = progressInfo.Phase == MotionLabMovementPhase.Hold ? 0.0 : Distance(before, after) / 0.002;
            return new MotionLabSample(
                clampedElapsed,
                curveProgress,
                point.X,
                point.Y,
                velocity,
                progressInfo.Phase,
                progressInfo.HoldIndex,
                progressInfo.PhaseElapsedMilliseconds);
        }

        public MotionLabPoint EvaluateBezier(double progress)
        {
            MotionLabPoint[] points = _script.ControlPoints ?? new MotionLabPoint[0];
            if (points.Length == 0)
            {
                return new MotionLabPoint(0, 0);
            }

            double[] x = new double[points.Length];
            double[] y = new double[points.Length];
            for (int i = 0; i < points.Length; i++)
            {
                MotionLabPoint point = points[i] ?? new MotionLabPoint(0, 0);
                x[i] = point.X;
                y[i] = point.Y;
            }

            double t = Clamp01(progress);
            for (int level = points.Length - 1; level > 0; level--)
            {
                for (int i = 0; i < level; i++)
                {
                    x[i] = Lerp(x[i], x[i + 1], t);
                    y[i] = Lerp(y[i], y[i + 1], t);
                }
            }

            return MotionLabGenerator.ClipPoint(x[0], y[0], MotionLabGenerator.ToRectangle(_script.Bounds));
        }

        public double SpeedMultiplierAt(double progress)
        {
            MotionLabSpeedPoint[] speedPoints = _script.SpeedPoints ?? new MotionLabSpeedPoint[0];
            double multiplier = 1.0;
            for (int i = 0; i < speedPoints.Length; i++)
            {
                MotionLabSpeedPoint point = speedPoints[i];
                if (point == null)
                {
                    continue;
                }

                double width = Math.Max(0.001, point.EasingWidth);
                double distance = Math.Abs(Clamp01(progress) - Clamp01(point.Progress));
                if (distance > width)
                {
                    continue;
                }

                double weight = 1.0 - (distance / width);
                weight = ApplyEasing(weight, point.Easing);
                multiplier += (Math.Max(0.05, point.Multiplier) - 1.0) * weight;
            }

            return Math.Max(0.05, Math.Min(5.0, multiplier));
        }

        private void BuildTimeLookup()
        {
            double[] cumulative = new double[LookupSteps + 1];
            MotionLabPoint previous = EvaluateBezier(0);
            cumulative[0] = 0;
            for (int i = 1; i <= LookupSteps; i++)
            {
                double progress = i / (double)LookupSteps;
                MotionLabPoint current = EvaluateBezier(progress);
                double segmentLength = Distance(previous, current);
                double speed = SpeedMultiplierAt((progress + ((i - 1) / (double)LookupSteps)) / 2.0);
                cumulative[i] = cumulative[i - 1] + (segmentLength / speed);
                previous = current;
            }

            double total = cumulative[LookupSteps];
            if (total <= 0)
            {
                for (int i = 0; i <= LookupSteps; i++)
                {
                    _progressByTime[i] = i / (double)LookupSteps;
                }

                return;
            }

            int source = 0;
            for (int i = 0; i <= LookupSteps; i++)
            {
                double target = total * i / LookupSteps;
                while (source < LookupSteps && cumulative[source + 1] < target)
                {
                    source++;
                }

                double left = cumulative[source];
                double right = cumulative[Math.Min(LookupSteps, source + 1)];
                double local = right > left ? (target - left) / (right - left) : 0.0;
                _progressByTime[i] = (source + local) / LookupSteps;
            }
        }

        private double ProgressAtTime(double timeProgress)
        {
            double scaled = Clamp01(timeProgress) * LookupSteps;
            int left = (int)Math.Floor(scaled);
            if (left >= LookupSteps)
            {
                return 1.0;
            }

            double local = scaled - left;
            return Lerp(_progressByTime[left], _progressByTime[left + 1], local);
        }

        private double ProgressAtElapsed(double elapsedMilliseconds)
        {
            return ProgressInfoAtElapsed(elapsedMilliseconds).Progress;
        }

        private ProgressInfo ProgressInfoAtElapsed(double elapsedMilliseconds)
        {
            double duration = Math.Max(1.0, _script.DurationMilliseconds);
            if (_holdSegments.Length == 0)
            {
                return new ProgressInfo(
                    ProgressAtTime(elapsedMilliseconds / duration),
                    MotionLabMovementPhase.Moving,
                    -1,
                    elapsedMilliseconds);
            }

            double movementDuration = Math.Max(1.0, duration - _holdDurationMilliseconds);
            double completedHoldDuration = 0;
            MotionLabHoldSegment resumeHold = null;
            int resumeHoldIndex = -1;
            double resumeElapsed = 0;
            double lastTransitionElapsed = 0;
            for (int i = 0; i < _holdSegments.Length; i++)
            {
                MotionLabHoldSegment hold = _holdSegments[i];
                double holdMovementStart = MovementTimeAtProgress(hold.Progress) * movementDuration;
                double holdStart = holdMovementStart + completedHoldDuration;
                double holdEnd = holdStart + hold.DurationMilliseconds;
                if (elapsedMilliseconds < holdStart)
                {
                    break;
                }

                if (elapsedMilliseconds <= holdEnd)
                {
                    return new ProgressInfo(
                        Clamp01(hold.Progress),
                        MotionLabMovementPhase.Hold,
                        i,
                        elapsedMilliseconds - holdStart);
                }

                completedHoldDuration += hold.DurationMilliseconds;
                double resumeMilliseconds = Math.Max(0.0, hold.ResumeEasingMilliseconds);
                if (resumeMilliseconds > 0 && elapsedMilliseconds < holdEnd + resumeMilliseconds)
                {
                    resumeHold = hold;
                    resumeHoldIndex = i;
                    resumeElapsed = elapsedMilliseconds - holdEnd;
                }
                else
                {
                    lastTransitionElapsed = holdEnd + resumeMilliseconds;
                }
            }

            double movementElapsed = Math.Max(0.0, Math.Min(movementDuration, elapsedMilliseconds - completedHoldDuration));
            double progress = ProgressAtTime(movementElapsed / movementDuration);
            if (resumeHold != null)
            {
                double resumeProgress = ApplyEasing(resumeElapsed / Math.Max(1.0, resumeHold.ResumeEasingMilliseconds), "smoothstep");
                progress = Lerp(Clamp01(resumeHold.Progress), progress, resumeProgress);
                return new ProgressInfo(
                    progress,
                    MotionLabMovementPhase.Resume,
                    resumeHoldIndex,
                    resumeElapsed);
            }

            return new ProgressInfo(
                progress,
                MotionLabMovementPhase.Moving,
                -1,
                Math.Max(0.0, elapsedMilliseconds - lastTransitionElapsed));
        }

        private double MovementTimeAtProgress(double progress)
        {
            double target = Clamp01(progress);
            if (target <= _progressByTime[0])
            {
                return 0.0;
            }

            for (int i = 0; i < LookupSteps; i++)
            {
                double left = _progressByTime[i];
                double right = _progressByTime[i + 1];
                if (target <= right || i == LookupSteps - 1)
                {
                    double local = right > left ? (target - left) / (right - left) : 0.0;
                    return Clamp01((i + local) / LookupSteps);
                }
            }

            return 1.0;
        }

        private static MotionLabHoldSegment[] NormalizeHoldSegments(MotionLabHoldSegment[] holdSegments, double scriptDurationMilliseconds)
        {
            if (holdSegments == null || holdSegments.Length == 0)
            {
                return new MotionLabHoldSegment[0];
            }

            MotionLabHoldSegment[] normalized = new MotionLabHoldSegment[holdSegments.Length];
            int count = 0;
            for (int i = 0; i < holdSegments.Length; i++)
            {
                MotionLabHoldSegment source = holdSegments[i];
                if (source == null || source.DurationMilliseconds <= 0)
                {
                    continue;
                }

                normalized[count] = new MotionLabHoldSegment
                {
                    Progress = Clamp01(source.Progress),
                    DurationMilliseconds = Math.Max(1.0, source.DurationMilliseconds),
                    ResumeEasingMilliseconds = Math.Max(0.0, source.ResumeEasingMilliseconds)
                };
                count++;
            }

            if (count == 0)
            {
                return new MotionLabHoldSegment[0];
            }

            Array.Resize(ref normalized, count);
            Array.Sort(normalized, CompareHoldSegments);
            ScaleHoldDurationsToFit(normalized, Math.Max(0.0, scriptDurationMilliseconds - 1.0));
            return normalized;
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

        private static double SumHoldDurations(MotionLabHoldSegment[] holdSegments)
        {
            double total = 0;
            for (int i = 0; i < holdSegments.Length; i++)
            {
                total += Math.Max(0.0, holdSegments[i].DurationMilliseconds);
            }

            return total;
        }

        private static void ScaleHoldDurationsToFit(MotionLabHoldSegment[] holdSegments, double maximumDurationMilliseconds)
        {
            double total = SumHoldDurations(holdSegments);
            if (total <= maximumDurationMilliseconds || total <= 0)
            {
                return;
            }

            double scale = maximumDurationMilliseconds / total;
            for (int i = 0; i < holdSegments.Length; i++)
            {
                holdSegments[i].DurationMilliseconds = Math.Max(1.0, holdSegments[i].DurationMilliseconds * scale);
                holdSegments[i].ResumeEasingMilliseconds = Math.Min(
                    holdSegments[i].ResumeEasingMilliseconds,
                    holdSegments[i].DurationMilliseconds);
            }
        }

        private static double ApplyEasing(double value, string easing)
        {
            double x = Clamp01(value);
            string normalized = (easing ?? string.Empty).Trim().ToLowerInvariant();
            if (normalized == "smoothstep")
            {
                return x * x * (3.0 - (2.0 * x));
            }

            if (normalized == "sine")
            {
                return Math.Sin(x * Math.PI / 2.0);
            }

            return x;
        }

        private static double Distance(MotionLabPoint left, MotionLabPoint right)
        {
            double dx = right.X - left.X;
            double dy = right.Y - left.Y;
            return Math.Sqrt((dx * dx) + (dy * dy));
        }

        private static double Lerp(double start, double end, double progress)
        {
            return start + ((end - start) * progress);
        }

        private static double Clamp01(double value)
        {
            return Math.Max(0.0, Math.Min(1.0, value));
        }

        private sealed class ProgressInfo
        {
            public ProgressInfo(double progress, string phase, int holdIndex, double phaseElapsedMilliseconds)
            {
                Progress = progress;
                Phase = phase;
                HoldIndex = holdIndex;
                PhaseElapsedMilliseconds = Math.Max(0.0, phaseElapsedMilliseconds);
            }

            public double Progress { get; private set; }
            public string Phase { get; private set; }
            public int HoldIndex { get; private set; }
            public double PhaseElapsedMilliseconds { get; private set; }
        }
    }
}
