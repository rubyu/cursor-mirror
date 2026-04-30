using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;

namespace CursorMirror.MouseTrace
{
    public sealed class MouseTraceSession
    {
        private readonly object _syncRoot = new object();
        private readonly List<MouseTraceEvent> _samples = new List<MouseTraceEvent>();
        private long _startTicks;
        private long _stopTicks;
        private MouseTraceState _state = MouseTraceState.Idle;

        public MouseTraceState State
        {
            get
            {
                lock (_syncRoot)
                {
                    return _state;
                }
            }
        }

        public int SampleCount
        {
            get
            {
                lock (_syncRoot)
                {
                    return _samples.Count;
                }
            }
        }

        public long ElapsedMicroseconds
        {
            get
            {
                lock (_syncRoot)
                {
                    if (_state == MouseTraceState.Idle)
                    {
                        return 0;
                    }

                    long endTicks = _state == MouseTraceState.Recording ? Stopwatch.GetTimestamp() : _stopTicks;
                    return TicksToMicroseconds(endTicks - _startTicks);
                }
            }
        }

        public void Start(long stopwatchTicks)
        {
            lock (_syncRoot)
            {
                _samples.Clear();
                _startTicks = stopwatchTicks;
                _stopTicks = stopwatchTicks;
                _state = MouseTraceState.Recording;
            }
        }

        public void Stop(long stopwatchTicks)
        {
            lock (_syncRoot)
            {
                if (_state != MouseTraceState.Recording)
                {
                    return;
                }

                _stopTicks = stopwatchTicks;
                _state = _samples.Count == 0 ? MouseTraceState.Idle : MouseTraceState.StoppedWithSamples;
            }
        }

        public void MarkSaved()
        {
            lock (_syncRoot)
            {
                if (_samples.Count > 0)
                {
                    _state = MouseTraceState.Saved;
                }
            }
        }

        public void AddMove(long stopwatchTicks, Point point)
        {
            lock (_syncRoot)
            {
                if (_state != MouseTraceState.Recording)
                {
                    return;
                }

                long sequence = _samples.Count;
                long elapsed = TicksToMicroseconds(stopwatchTicks - _startTicks);
                _samples.Add(new MouseTraceEvent(sequence, stopwatchTicks, elapsed, point.X, point.Y, "move"));
            }
        }

        public MouseTraceSnapshot Snapshot()
        {
            lock (_syncRoot)
            {
                return new MouseTraceSnapshot(_state, _startTicks, _stopTicks, TicksToMicroseconds(_stopTicks - _startTicks), _samples.ToArray());
            }
        }

        public static long TicksToMicroseconds(long stopwatchTicks)
        {
            return (long)Math.Round((stopwatchTicks * 1000000.0) / Stopwatch.Frequency);
        }
    }
}
