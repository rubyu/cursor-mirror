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
        private int _pollIntervalMilliseconds;
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

        public MouseTraceSampleCounts GetSampleCounts()
        {
            lock (_syncRoot)
            {
                int hookMoveSamples = 0;
                int cursorPollSamples = 0;
                int dwmTimingSamples = 0;

                for (int i = 0; i < _samples.Count; i++)
                {
                    MouseTraceEvent sample = _samples[i];
                    if (sample.EventType == "move")
                    {
                        hookMoveSamples++;
                    }
                    else if (sample.EventType == "poll")
                    {
                        cursorPollSamples++;
                    }

                    if (sample.DwmTimingAvailable)
                    {
                        dwmTimingSamples++;
                    }
                }

                return new MouseTraceSampleCounts(_samples.Count, hookMoveSamples, cursorPollSamples, dwmTimingSamples);
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
            Start(stopwatchTicks, 0);
        }

        public void Start(long stopwatchTicks, int pollIntervalMilliseconds)
        {
            lock (_syncRoot)
            {
                _samples.Clear();
                _startTicks = stopwatchTicks;
                _stopTicks = stopwatchTicks;
                _pollIntervalMilliseconds = Math.Max(0, pollIntervalMilliseconds);
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
            AddSample(stopwatchTicks, point, "move", point, null, null, null, null, null, false, new DwmTimingInfo());
        }

        public void AddHookMove(long stopwatchTicks, Point hookPoint, uint mouseData, uint flags, uint hookTimeMilliseconds, IntPtr extraInfo, Point? cursorPoint)
        {
            AddSample(
                stopwatchTicks,
                hookPoint,
                "move",
                hookPoint,
                cursorPoint,
                mouseData,
                flags,
                hookTimeMilliseconds,
                extraInfo.ToInt64(),
                false,
                new DwmTimingInfo());
        }

        public void AddPoll(long stopwatchTicks, Point cursorPoint, bool dwmTimingAvailable, DwmTimingInfo dwmTiming)
        {
            AddSample(stopwatchTicks, cursorPoint, "poll", null, cursorPoint, null, null, null, null, dwmTimingAvailable, dwmTiming);
        }

        private void AddSample(
            long stopwatchTicks,
            Point primaryPoint,
            string eventType,
            Point? hookPoint,
            Point? cursorPoint,
            uint? hookMouseData,
            uint? hookFlags,
            uint? hookTimeMilliseconds,
            long? hookExtraInfo,
            bool dwmTimingAvailable,
            DwmTimingInfo dwmTiming)
        {
            lock (_syncRoot)
            {
                if (_state != MouseTraceState.Recording)
                {
                    return;
                }

                long sequence = _samples.Count;
                long elapsed = TicksToMicroseconds(stopwatchTicks - _startTicks);
                _samples.Add(new MouseTraceEvent(
                    sequence,
                    stopwatchTicks,
                    elapsed,
                    primaryPoint.X,
                    primaryPoint.Y,
                    eventType,
                    hookPoint.HasValue ? hookPoint.Value.X : (int?)null,
                    hookPoint.HasValue ? hookPoint.Value.Y : (int?)null,
                    cursorPoint.HasValue ? cursorPoint.Value.X : (int?)null,
                    cursorPoint.HasValue ? cursorPoint.Value.Y : (int?)null,
                    hookMouseData,
                    hookFlags,
                    hookTimeMilliseconds,
                    hookExtraInfo,
                    dwmTimingAvailable,
                    dwmTiming));
            }
        }

        public MouseTraceSnapshot Snapshot()
        {
            lock (_syncRoot)
            {
                return new MouseTraceSnapshot(_state, _startTicks, _stopTicks, TicksToMicroseconds(_stopTicks - _startTicks), _samples.ToArray(), _pollIntervalMilliseconds);
            }
        }

        public static long TicksToMicroseconds(long stopwatchTicks)
        {
            return (long)Math.Round((stopwatchTicks * 1000000.0) / Stopwatch.Frequency);
        }
    }
}
