using System;
using System.Diagnostics;
using System.Drawing;
using System.Threading;

namespace CursorMirror.MotionLab
{
    public sealed class MotionLabPlaybackRunner : IDisposable
    {
        private readonly object _syncRoot = new object();
        private readonly RealCursorDriver _cursorDriver;
        private Thread _thread;
        private volatile bool _active;
        private MotionLabScenarioSet _scenarioSet;
        private MotionLabScenarioSetSampler _sampler;
        private MotionLabScenarioSetSample _lastSample;
        private Exception _exception;
        private bool _disposed;

        public MotionLabPlaybackRunner(RealCursorDriver cursorDriver)
        {
            if (cursorDriver == null)
            {
                throw new ArgumentNullException("cursorDriver");
            }

            _cursorDriver = cursorDriver;
        }

        public event EventHandler Completed;

        public bool IsRunning
        {
            get { return _active; }
        }

        public double ElapsedMilliseconds
        {
            get
            {
                MotionLabScenarioSetSample sample = LastSample;
                return sample == null ? 0 : sample.ElapsedMilliseconds;
            }
        }

        public MotionLabScenarioSetSample LastSample
        {
            get
            {
                lock (_syncRoot)
                {
                    return _lastSample;
                }
            }
        }

        public Exception Exception
        {
            get
            {
                lock (_syncRoot)
                {
                    return _exception;
                }
            }
        }

        public void Start(MotionLabScenarioSet scenarioSet)
        {
            if (scenarioSet == null)
            {
                throw new ArgumentNullException("scenarioSet");
            }

            ThrowIfDisposed();
            Stop();
            _scenarioSet = scenarioSet;
            _sampler = new MotionLabScenarioSetSampler(scenarioSet);
            lock (_syncRoot)
            {
                _lastSample = null;
                _exception = null;
            }

            _active = true;
            _thread = new Thread(Run);
            _thread.Name = "CursorMirrorMotionLabPlayback";
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
            bool completedNaturally = false;
            try
            {
                Stopwatch stopwatch = Stopwatch.StartNew();
                int sampleRate = Math.Max(1, _scenarioSet.SampleRateHz);
                long intervalTicks = Math.Max(1, (long)Math.Round(Stopwatch.Frequency / (double)sampleRate));
                long nextTicks = Stopwatch.GetTimestamp();
                using (HighResolutionWaitTimer waitTimer = HighResolutionWaitTimer.CreateBestEffort())
                {
                    while (_active)
                    {
                        double elapsed = stopwatch.Elapsed.TotalMilliseconds;
                        if (elapsed >= _sampler.TotalDurationMilliseconds)
                        {
                            MotionLabScenarioSetSample finalSample = _sampler.GetSample(_sampler.TotalDurationMilliseconds);
                            MoveAndStore(finalSample);
                            completedNaturally = true;
                            break;
                        }

                        MotionLabScenarioSetSample sample = _sampler.GetSample(elapsed);
                        MoveAndStore(sample);
                        nextTicks += intervalTicks;
                        WaitUntil(waitTimer, nextTicks);
                    }
                }
            }
            catch (Exception ex)
            {
                lock (_syncRoot)
                {
                    _exception = ex;
                }
            }
            finally
            {
                _active = false;
                if (completedNaturally || Exception != null)
                {
                    OnCompleted();
                }
            }
        }

        private void MoveAndStore(MotionLabScenarioSetSample sample)
        {
            _cursorDriver.MoveTo(new Point((int)Math.Round(sample.X), (int)Math.Round(sample.Y)));
            lock (_syncRoot)
            {
                _lastSample = sample;
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

        private void OnCompleted()
        {
            EventHandler handler = Completed;
            if (handler != null)
            {
                handler(this, EventArgs.Empty);
            }
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
