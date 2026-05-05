using System;
using System.Diagnostics;
using System.Drawing;
using System.Threading;

namespace CursorMirror.Calibrator
{
    internal sealed class CalibratorMotionPlaybackRunner : IDisposable
    {
        private const int DefaultSampleRateHz = 60;
        private readonly RealCursorDriver _cursorDriver;
        private readonly ICalibrationMotionSource _motionSource;
        private readonly Action<CalibrationMotionSample> _sampleMoved;
        private readonly double _durationMilliseconds;
        private readonly int _sampleRateHz;
        private Thread _thread;
        private volatile bool _active;
        private bool _disposed;

        public CalibratorMotionPlaybackRunner(
            RealCursorDriver cursorDriver,
            ICalibrationMotionSource motionSource,
            double durationMilliseconds,
            int sampleRateHz,
            Action<CalibrationMotionSample> sampleMoved)
        {
            if (cursorDriver == null)
            {
                throw new ArgumentNullException("cursorDriver");
            }

            if (motionSource == null)
            {
                throw new ArgumentNullException("motionSource");
            }

            _cursorDriver = cursorDriver;
            _motionSource = motionSource;
            _durationMilliseconds = Math.Max(1.0, durationMilliseconds);
            _sampleRateHz = sampleRateHz <= 0 ? DefaultSampleRateHz : sampleRateHz;
            _sampleMoved = sampleMoved;
        }

        public void Start()
        {
            ThrowIfDisposed();
            Stop();
            _active = true;
            _thread = new Thread(Run);
            _thread.Name = "Cursor Mirror calibrator motion playback";
            _thread.IsBackground = true;
            _thread.Priority = ThreadPriority.AboveNormal;
            _thread.Start();
        }

        public void Stop()
        {
            _active = false;
            Thread thread = _thread;
            if (thread != null && thread.IsAlive && thread != Thread.CurrentThread)
            {
                thread.Join(1000);
            }

            _thread = null;
        }

        public void Dispose()
        {
            if (!_disposed)
            {
                Stop();
                _disposed = true;
            }
        }

        private void Run()
        {
            try
            {
                Stopwatch stopwatch = Stopwatch.StartNew();
                long intervalTicks = Math.Max(1, (long)Math.Round(Stopwatch.Frequency / (double)_sampleRateHz));
                long nextTicks = Stopwatch.GetTimestamp();
                using (HighResolutionWaitTimer waitTimer = HighResolutionWaitTimer.CreateBestEffort())
                {
                    while (_active)
                    {
                        double elapsedMilliseconds = stopwatch.Elapsed.TotalMilliseconds;
                        if (elapsedMilliseconds >= _durationMilliseconds)
                        {
                            MoveAt(_durationMilliseconds);
                            return;
                        }

                        MoveAt(elapsedMilliseconds);
                        nextTicks += intervalTicks;
                        WaitUntil(waitTimer, nextTicks);
                    }
                }
            }
            catch
            {
            }
            finally
            {
                _active = false;
            }
        }

        private void MoveAt(double elapsedMilliseconds)
        {
            CalibrationMotionSample sample = _motionSource.GetSample(elapsedMilliseconds);
            _cursorDriver.MoveTo(new Point(sample.ExpectedX, sample.ExpectedY));
            if (_sampleMoved != null)
            {
                _sampleMoved(sample);
            }
        }

        private static void WaitUntil(HighResolutionWaitTimer waitTimer, long targetTicks)
        {
            while (true)
            {
                long remainingTicks = targetTicks - Stopwatch.GetTimestamp();
                if (remainingTicks <= 0)
                {
                    return;
                }

                if (waitTimer != null && remainingTicks > MicrosecondsToTicks(500))
                {
                    waitTimer.WaitTicks(remainingTicks - MicrosecondsToTicks(250), Stopwatch.Frequency);
                    continue;
                }

                if (remainingTicks > MicrosecondsToTicks(200))
                {
                    Thread.Sleep(0);
                }
                else
                {
                    Thread.SpinWait(64);
                }
            }
        }

        private static long MicrosecondsToTicks(int microseconds)
        {
            if (microseconds <= 0)
            {
                return 0;
            }

            double ticks = microseconds * (double)Stopwatch.Frequency / 1000000.0;
            if (ticks >= long.MaxValue)
            {
                return long.MaxValue;
            }

            return (long)Math.Round(ticks);
        }

        private void ThrowIfDisposed()
        {
            if (_disposed)
            {
                throw new ObjectDisposedException(GetType().Name);
            }
        }
    }
}
