using System;
using System.Drawing;

namespace CursorMirror
{
    public sealed class DwmAwareCursorPositionPredictor
    {
        public const double DefaultGain = 0.75;
        private bool _hasSample;
        private double _lastX;
        private double _lastY;
        private long _lastTimestampTicks;
        private int _idleResetMilliseconds;

        public DwmAwareCursorPositionPredictor(int idleResetMilliseconds)
        {
            ApplyIdleResetMilliseconds(idleResetMilliseconds);
        }

        public void ApplyIdleResetMilliseconds(int idleResetMilliseconds)
        {
            _idleResetMilliseconds = Math.Max(1, idleResetMilliseconds);
            Reset();
        }

        public void Reset()
        {
            _hasSample = false;
            _lastX = 0;
            _lastY = 0;
            _lastTimestampTicks = 0;
        }

        public Point PredictRounded(CursorPollSample sample, CursorPredictionCounters counters)
        {
            PointF predicted = Predict(sample, counters);
            return new Point(
                (int)Math.Round(predicted.X),
                (int)Math.Round(predicted.Y));
        }

        public PointF Predict(CursorPollSample sample, CursorPredictionCounters counters)
        {
            if (counters == null)
            {
                throw new ArgumentNullException("counters");
            }

            if (!_hasSample)
            {
                StoreSample(sample);
                return new PointF(sample.Position.X, sample.Position.Y);
            }

            long deltaTicks = sample.TimestampTicks - _lastTimestampTicks;
            if (deltaTicks <= 0 || IsIdleGap(deltaTicks, sample.StopwatchFrequency))
            {
                counters.PredictionResetDueToInvalidDtOrIdleGap++;
                counters.FallbackToHold++;
                StoreSample(sample);
                return new PointF(sample.Position.X, sample.Position.Y);
            }

            long nextVBlankTicks = SelectNextVBlank(sample, counters);
            if (nextVBlankTicks <= 0)
            {
                counters.FallbackToHold++;
                StoreSample(sample);
                return new PointF(sample.Position.X, sample.Position.Y);
            }

            long horizonTicks = nextVBlankTicks - sample.TimestampTicks;
            if (horizonTicks <= 0 || (double)horizonTicks > sample.DwmRefreshPeriodTicks * 1.25)
            {
                counters.HorizonOver125xRefreshPeriod++;
                counters.FallbackToHold++;
                StoreSample(sample);
                return new PointF(sample.Position.X, sample.Position.Y);
            }

            double scale = DefaultGain * horizonTicks / deltaTicks;
            double predictedX = sample.Position.X + ((sample.Position.X - _lastX) * scale);
            double predictedY = sample.Position.Y + ((sample.Position.Y - _lastY) * scale);
            StoreSample(sample);
            return new PointF((float)predictedX, (float)predictedY);
        }

        private bool IsIdleGap(long deltaTicks, long stopwatchFrequency)
        {
            if (stopwatchFrequency <= 0)
            {
                return true;
            }

            double deltaMilliseconds = (deltaTicks * 1000.0) / stopwatchFrequency;
            return deltaMilliseconds > _idleResetMilliseconds;
        }

        private static long SelectNextVBlank(CursorPollSample sample, CursorPredictionCounters counters)
        {
            if (!sample.DwmTimingAvailable || sample.DwmVBlankTicks <= 0 || sample.DwmRefreshPeriodTicks <= 0)
            {
                counters.InvalidDwmHorizon++;
                return 0;
            }

            long next = sample.DwmVBlankTicks;
            if (next <= sample.TimestampTicks)
            {
                counters.LateDwmHorizon++;
                long periodsLate = ((sample.TimestampTicks - next) / sample.DwmRefreshPeriodTicks) + 1L;
                next += periodsLate * sample.DwmRefreshPeriodTicks;
            }

            return next;
        }

        private void StoreSample(CursorPollSample sample)
        {
            _lastX = sample.Position.X;
            _lastY = sample.Position.Y;
            _lastTimestampTicks = sample.TimestampTicks;
            _hasSample = true;
        }
    }
}
