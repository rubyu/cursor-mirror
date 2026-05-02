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
        private int _referencePollIntervalMilliseconds;
        private int _timerResolutionMilliseconds;
        private int _runtimeSchedulerWakeAdvanceMilliseconds;
        private int _runtimeSchedulerFallbackIntervalMilliseconds;
        private int _runtimeSchedulerCoalescedTickCount;
        private bool _timerResolutionSucceeded;
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
                int referencePollSamples = 0;
                int runtimeSchedulerPollSamples = 0;
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
                    else if (sample.EventType == "referencePoll")
                    {
                        referencePollSamples++;
                    }
                    else if (sample.EventType == "runtimeSchedulerPoll")
                    {
                        runtimeSchedulerPollSamples++;
                    }

                    if (sample.DwmTimingAvailable)
                    {
                        dwmTimingSamples++;
                    }
                }

                return new MouseTraceSampleCounts(
                    _samples.Count,
                    hookMoveSamples,
                    cursorPollSamples,
                    referencePollSamples,
                    runtimeSchedulerPollSamples,
                    dwmTimingSamples);
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
            Start(stopwatchTicks, pollIntervalMilliseconds, 0, 0, false);
        }

        public void Start(
            long stopwatchTicks,
            int pollIntervalMilliseconds,
            int referencePollIntervalMilliseconds,
            int timerResolutionMilliseconds,
            bool timerResolutionSucceeded)
        {
            Start(
                stopwatchTicks,
                pollIntervalMilliseconds,
                referencePollIntervalMilliseconds,
                timerResolutionMilliseconds,
                timerResolutionSucceeded,
                0,
                0);
        }

        public void Start(
            long stopwatchTicks,
            int pollIntervalMilliseconds,
            int referencePollIntervalMilliseconds,
            int timerResolutionMilliseconds,
            bool timerResolutionSucceeded,
            int runtimeSchedulerWakeAdvanceMilliseconds,
            int runtimeSchedulerFallbackIntervalMilliseconds)
        {
            lock (_syncRoot)
            {
                _samples.Clear();
                _startTicks = stopwatchTicks;
                _stopTicks = stopwatchTicks;
                _pollIntervalMilliseconds = Math.Max(0, pollIntervalMilliseconds);
                _referencePollIntervalMilliseconds = Math.Max(0, referencePollIntervalMilliseconds);
                _timerResolutionMilliseconds = Math.Max(0, timerResolutionMilliseconds);
                _timerResolutionSucceeded = timerResolutionSucceeded;
                _runtimeSchedulerWakeAdvanceMilliseconds = Math.Max(0, runtimeSchedulerWakeAdvanceMilliseconds);
                _runtimeSchedulerFallbackIntervalMilliseconds = Math.Max(0, runtimeSchedulerFallbackIntervalMilliseconds);
                _runtimeSchedulerCoalescedTickCount = 0;
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

        public void AddReferencePoll(long stopwatchTicks, Point cursorPoint)
        {
            AddSample(stopwatchTicks, cursorPoint, "referencePoll", null, cursorPoint, null, null, null, null, false, new DwmTimingInfo());
        }

        public void AddRuntimeSchedulerPoll(
            long stopwatchTicks,
            Point cursorPoint,
            bool dwmTimingAvailable,
            DwmTimingInfo dwmTiming,
            bool schedulerTimingUsable,
            long? targetVBlankTicks,
            long? plannedTickTicks,
            long actualTickTicks,
            long? vBlankLeadMicroseconds)
        {
            AddRuntimeSchedulerPoll(
                stopwatchTicks,
                cursorPoint,
                dwmTimingAvailable,
                dwmTiming,
                schedulerTimingUsable,
                targetVBlankTicks,
                plannedTickTicks,
                actualTickTicks,
                vBlankLeadMicroseconds,
                null,
                null,
                null,
                null,
                null);
        }

        public void AddRuntimeSchedulerPoll(
            long stopwatchTicks,
            Point cursorPoint,
            bool dwmTimingAvailable,
            DwmTimingInfo dwmTiming,
            bool schedulerTimingUsable,
            long? targetVBlankTicks,
            long? plannedTickTicks,
            long actualTickTicks,
            long? vBlankLeadMicroseconds,
            long? queuedTickTicks,
            long? dispatchStartedTicks,
            long? cursorReadStartedTicks,
            long? cursorReadCompletedTicks,
            long? sampleRecordedTicks)
        {
            AddSample(
                stopwatchTicks,
                cursorPoint,
                "runtimeSchedulerPoll",
                null,
                cursorPoint,
                null,
                null,
                null,
                null,
                dwmTimingAvailable,
                dwmTiming,
                schedulerTimingUsable,
                targetVBlankTicks,
                plannedTickTicks,
                actualTickTicks,
                vBlankLeadMicroseconds,
                queuedTickTicks,
                dispatchStartedTicks,
                cursorReadStartedTicks,
                cursorReadCompletedTicks,
                sampleRecordedTicks);
        }

        public void AddRuntimeSchedulerCoalescedTick()
        {
            lock (_syncRoot)
            {
                if (_state == MouseTraceState.Recording)
                {
                    _runtimeSchedulerCoalescedTickCount++;
                }
            }
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
            AddSample(
                stopwatchTicks,
                primaryPoint,
                eventType,
                hookPoint,
                cursorPoint,
                hookMouseData,
                hookFlags,
                hookTimeMilliseconds,
                hookExtraInfo,
                dwmTimingAvailable,
                dwmTiming,
                null,
                null,
                null,
                null,
                null);
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
            DwmTimingInfo dwmTiming,
            bool? runtimeSchedulerTimingUsable,
            long? runtimeSchedulerTargetVBlankTicks,
            long? runtimeSchedulerPlannedTickTicks,
            long? runtimeSchedulerActualTickTicks,
            long? runtimeSchedulerVBlankLeadMicroseconds)
        {
            AddSample(
                stopwatchTicks,
                primaryPoint,
                eventType,
                hookPoint,
                cursorPoint,
                hookMouseData,
                hookFlags,
                hookTimeMilliseconds,
                hookExtraInfo,
                dwmTimingAvailable,
                dwmTiming,
                runtimeSchedulerTimingUsable,
                runtimeSchedulerTargetVBlankTicks,
                runtimeSchedulerPlannedTickTicks,
                runtimeSchedulerActualTickTicks,
                runtimeSchedulerVBlankLeadMicroseconds,
                null,
                null,
                null,
                null,
                null);
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
            DwmTimingInfo dwmTiming,
            bool? runtimeSchedulerTimingUsable,
            long? runtimeSchedulerTargetVBlankTicks,
            long? runtimeSchedulerPlannedTickTicks,
            long? runtimeSchedulerActualTickTicks,
            long? runtimeSchedulerVBlankLeadMicroseconds,
            long? runtimeSchedulerQueuedTickTicks,
            long? runtimeSchedulerDispatchStartedTicks,
            long? runtimeSchedulerCursorReadStartedTicks,
            long? runtimeSchedulerCursorReadCompletedTicks,
            long? runtimeSchedulerSampleRecordedTicks)
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
                    dwmTiming,
                    runtimeSchedulerTimingUsable,
                    runtimeSchedulerTargetVBlankTicks,
                    runtimeSchedulerPlannedTickTicks,
                    runtimeSchedulerActualTickTicks,
                    runtimeSchedulerVBlankLeadMicroseconds,
                    runtimeSchedulerQueuedTickTicks,
                    runtimeSchedulerDispatchStartedTicks,
                    runtimeSchedulerCursorReadStartedTicks,
                    runtimeSchedulerCursorReadCompletedTicks,
                    runtimeSchedulerSampleRecordedTicks));
            }
        }

        public MouseTraceSnapshot Snapshot()
        {
            lock (_syncRoot)
            {
                return new MouseTraceSnapshot(
                    _state,
                    _startTicks,
                    _stopTicks,
                    TicksToMicroseconds(_stopTicks - _startTicks),
                    _samples.ToArray(),
                    _pollIntervalMilliseconds,
                    _referencePollIntervalMilliseconds,
                    _timerResolutionMilliseconds,
                    _timerResolutionSucceeded,
                    _runtimeSchedulerWakeAdvanceMilliseconds,
                    _runtimeSchedulerFallbackIntervalMilliseconds,
                    _runtimeSchedulerCoalescedTickCount);
            }
        }

        public static long TicksToMicroseconds(long stopwatchTicks)
        {
            return (long)Math.Round((stopwatchTicks * 1000000.0) / Stopwatch.Frequency);
        }
    }
}
