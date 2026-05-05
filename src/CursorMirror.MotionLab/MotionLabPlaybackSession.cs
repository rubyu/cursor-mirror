using System;
using System.Diagnostics;
using System.IO;
using CursorMirror.MotionLab;
using CursorMirror.MouseTrace;

namespace CursorMirror.MotionLabApp
{
    public sealed class MotionLabPlaybackSession : IDisposable
    {
        private readonly MotionLabScenarioSet _scenarioSet;
        private readonly RealCursorDriver _cursorDriver;
        private readonly bool _runLoadGenerator;
        private readonly int _loadPercent;
        private readonly int _loadWorkers;
        private MotionLabPlaybackRunner _playbackRunner;
        private MotionLabInputBlocker _inputBlocker;
        private MouseTraceRecorder _recorder;
        private Process _loadProcess;
        private bool _disposed;

        public MotionLabPlaybackSession(
            MotionLabScenarioSet scenarioSet,
            RealCursorDriver cursorDriver,
            string outputPath,
            bool runLoadGenerator,
            int loadPercent,
            int loadWorkers)
        {
            if (scenarioSet == null)
            {
                throw new ArgumentNullException("scenarioSet");
            }

            if (cursorDriver == null)
            {
                throw new ArgumentNullException("cursorDriver");
            }

            _scenarioSet = scenarioSet;
            _cursorDriver = cursorDriver;
            OutputPath = outputPath;
            _runLoadGenerator = runLoadGenerator;
            _loadPercent = Math.Max(1, Math.Min(100, loadPercent));
            _loadWorkers = Math.Max(1, Math.Min(64, loadWorkers));
        }

        public event EventHandler Completed;

        public string OutputPath { get; private set; }

        public MotionLabScenarioSetSample LastSample
        {
            get { return _playbackRunner == null ? null : _playbackRunner.LastSample; }
        }

        public bool IsRunning
        {
            get { return _playbackRunner != null && _playbackRunner.IsRunning; }
        }

        public void Start()
        {
            ThrowIfDisposed();
            _recorder = new MouseTraceRecorder();
            try
            {
                _recorder.Start();
                _inputBlocker = new MotionLabInputBlocker(_cursorDriver.InjectionExtraInfo);
                _inputBlocker.Start();
                StartLoadGenerator();
                _playbackRunner = new MotionLabPlaybackRunner(_cursorDriver);
                _playbackRunner.Completed += PlaybackCompleted;
                _playbackRunner.Start(_scenarioSet);
            }
            catch
            {
                Stop();
                throw;
            }
        }

        public MouseTraceSampleCounts GetSampleCounts()
        {
            return _recorder == null ? new MouseTraceSampleCounts(0, 0, 0, 0, 0, 0, 0) : _recorder.GetSampleCounts();
        }

        public MotionLabPlaybackResult Stop()
        {
            Exception playbackException = null;
            if (_playbackRunner != null)
            {
                _playbackRunner.Completed -= PlaybackCompleted;
                playbackException = _playbackRunner.Exception;
                _playbackRunner.Stop();
                if (playbackException == null)
                {
                    playbackException = _playbackRunner.Exception;
                }

                _playbackRunner.Dispose();
                _playbackRunner = null;
            }

            StopLoadGenerator();

            MouseTraceSnapshot snapshot = null;
            if (_recorder != null)
            {
                try
                {
                    snapshot = _recorder.Stop();
                }
                finally
                {
                    _recorder.Dispose();
                    _recorder = null;
                }
            }

            StopInputBlocker();
            return new MotionLabPlaybackResult(snapshot, playbackException);
        }

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }

            Stop();
            _disposed = true;
        }

        private void StartLoadGenerator()
        {
            if (!_runLoadGenerator || _loadProcess != null)
            {
                return;
            }

            string path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "CursorMirror.LoadGen.exe");
            if (!File.Exists(path))
            {
                return;
            }

            ProcessStartInfo startInfo = new ProcessStartInfo(path);
            startInfo.UseShellExecute = false;
            startInfo.CreateNoWindow = true;
            startInfo.Arguments =
                "--duration-seconds " + Math.Max(1, (int)Math.Ceiling(_scenarioSet.DurationMilliseconds / 1000.0)).ToString() +
                " --workers " + _loadWorkers.ToString() +
                " --load-percent " + _loadPercent.ToString();
            _loadProcess = Process.Start(startInfo);
        }

        private void StopLoadGenerator()
        {
            if (_loadProcess == null)
            {
                return;
            }

            try
            {
                if (!_loadProcess.HasExited)
                {
                    _loadProcess.Kill();
                }
            }
            catch
            {
            }
            finally
            {
                _loadProcess.Dispose();
                _loadProcess = null;
            }
        }

        private void StopInputBlocker()
        {
            if (_inputBlocker == null)
            {
                return;
            }

            _inputBlocker.Dispose();
            _inputBlocker = null;
        }

        private void PlaybackCompleted(object sender, EventArgs e)
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

    public sealed class MotionLabPlaybackResult
    {
        public MotionLabPlaybackResult(MouseTraceSnapshot snapshot, Exception exception)
        {
            Snapshot = snapshot;
            Exception = exception;
        }

        public MouseTraceSnapshot Snapshot { get; private set; }

        public Exception Exception { get; private set; }
    }
}
