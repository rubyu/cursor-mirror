using System;
using System.Drawing;

namespace CursorMirror
{
    public sealed class CursorPositionPredictor
    {
        private bool _hasSample;
        private bool _hasVelocity;
        private double _lastX;
        private double _lastY;
        private long _lastTimestampMilliseconds;
        private double _velocityXPerMillisecond;
        private double _velocityYPerMillisecond;
        private int _idleResetMilliseconds;

        public CursorPositionPredictor(int idleResetMilliseconds)
        {
            ApplyIdleResetMilliseconds(idleResetMilliseconds);
        }

        public int IdleResetMilliseconds
        {
            get { return _idleResetMilliseconds; }
        }

        public bool HasSample
        {
            get { return _hasSample; }
        }

        public bool HasVelocity
        {
            get { return _hasVelocity; }
        }

        public void ApplyIdleResetMilliseconds(int idleResetMilliseconds)
        {
            _idleResetMilliseconds = Math.Max(1, idleResetMilliseconds);
            Reset();
        }

        public void Reset()
        {
            _hasSample = false;
            _hasVelocity = false;
            _lastX = 0;
            _lastY = 0;
            _lastTimestampMilliseconds = 0;
            _velocityXPerMillisecond = 0;
            _velocityYPerMillisecond = 0;
        }

        public void AddSample(long timestampMilliseconds, Point point)
        {
            AddSample(timestampMilliseconds, point.X, point.Y);
        }

        public void AddSample(long timestampMilliseconds, int x, int y)
        {
            if (!_hasSample)
            {
                StoreSample(timestampMilliseconds, x, y);
                _hasVelocity = false;
                return;
            }

            long deltaMilliseconds = timestampMilliseconds - _lastTimestampMilliseconds;
            if (deltaMilliseconds <= 0 || deltaMilliseconds > _idleResetMilliseconds)
            {
                StoreSample(timestampMilliseconds, x, y);
                _hasVelocity = false;
                return;
            }

            _velocityXPerMillisecond = (x - _lastX) / deltaMilliseconds;
            _velocityYPerMillisecond = (y - _lastY) / deltaMilliseconds;
            StoreSample(timestampMilliseconds, x, y);
            _hasVelocity = true;
        }

        public PointF Predict(double horizonMilliseconds)
        {
            if (!_hasSample)
            {
                return new PointF(0, 0);
            }

            if (!_hasVelocity || horizonMilliseconds <= 0)
            {
                return new PointF((float)_lastX, (float)_lastY);
            }

            double predictedX = _lastX + (_velocityXPerMillisecond * horizonMilliseconds);
            double predictedY = _lastY + (_velocityYPerMillisecond * horizonMilliseconds);
            return new PointF((float)predictedX, (float)predictedY);
        }

        public Point PredictRounded(double horizonMilliseconds)
        {
            PointF predicted = Predict(horizonMilliseconds);
            return new Point(
                (int)Math.Round(predicted.X),
                (int)Math.Round(predicted.Y));
        }

        private void StoreSample(long timestampMilliseconds, double x, double y)
        {
            _lastTimestampMilliseconds = timestampMilliseconds;
            _lastX = x;
            _lastY = y;
            _hasSample = true;
        }
    }
}
