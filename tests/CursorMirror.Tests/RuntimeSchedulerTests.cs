using CursorMirror;

namespace CursorMirror.Tests
{
    internal static class RuntimeSchedulerTests
    {
        public static void AddTo(TestSuite suite)
        {
            suite.Add("COT-MOU-23", DwmSchedulerWaitsUntilVBlankLead);
            suite.Add("COT-MOU-24", DwmSchedulerRequestsOneTickPerVBlank);
            suite.Add("COT-MOU-25", DwmSchedulerInvalidTimingFallsBack);
            suite.Add("COT-MOU-30", DwmSchedulerHoldsRequestedVBlankUntilItPasses);
            suite.Add("COT-MOU-31", DwmSchedulerAdvancesAfterRequestedVBlankPasses);
            suite.Add("COT-MOU-32", HighResolutionWaitTimerBestEffortWaits);
            suite.Add("COT-MOU-33", ThreadLatencyProfileSummary);
            suite.Add("COT-MOU-34", DwmOneShotSchedulerWaitsUntilAbsoluteWake);
            suite.Add("COT-MOU-35", DwmOneShotSchedulerSkipsNearDuplicateVBlank);
        }

        // DWM scheduler waits until the configured vblank lead time [COT-MOU-23]
        private static void DwmSchedulerWaitsUntilVBlankLead()
        {
            DwmSynchronizedRuntimeScheduleDecision decision =
                DwmSynchronizedRuntimeScheduler.EvaluateDwmTiming(
                    1010,
                    1000,
                    1000,
                    17,
                    0,
                    DwmSynchronizedRuntimeScheduler.WakeAdvanceMilliseconds,
                    DwmSynchronizedRuntimeScheduler.MaximumDwmSleepMilliseconds);

            TestAssert.True(decision.IsDwmTimingUsable, "DWM timing should be usable");
            TestAssert.False(decision.ShouldTick, "scheduler must wait before the lead window");
            TestAssert.Equal(2, decision.DelayMilliseconds, "delay to wake lead is capped to the short scheduler cadence");
            TestAssert.Equal(1017L, decision.TargetVBlankTicks, "target vblank");
            TestAssert.Equal(1012L, decision.WaitUntilTicks, "wait target follows capped scheduler cadence");
        }

        // DWM scheduler requests one tick per target vblank [COT-MOU-24]
        private static void DwmSchedulerRequestsOneTickPerVBlank()
        {
            DwmSynchronizedRuntimeScheduleDecision first =
                DwmSynchronizedRuntimeScheduler.EvaluateDwmTiming(
                    1015,
                    1000,
                    1000,
                    17,
                    0,
                    DwmSynchronizedRuntimeScheduler.WakeAdvanceMilliseconds,
                    DwmSynchronizedRuntimeScheduler.MaximumDwmSleepMilliseconds);
            DwmSynchronizedRuntimeScheduleDecision second =
                DwmSynchronizedRuntimeScheduler.EvaluateDwmTiming(
                    1016,
                    1000,
                    1000,
                    17,
                    first.TargetVBlankTicks,
                    DwmSynchronizedRuntimeScheduler.WakeAdvanceMilliseconds,
                    DwmSynchronizedRuntimeScheduler.MaximumDwmSleepMilliseconds);

            TestAssert.True(first.ShouldTick, "scheduler should tick inside the lead window");
            TestAssert.Equal(1017L, first.TargetVBlankTicks, "first target vblank");
            TestAssert.Equal(1015L, first.WaitUntilTicks, "first tick wait target is immediate");
            TestAssert.False(second.ShouldTick, "scheduler must not repeat the same vblank");
            TestAssert.Equal(1017L, second.TargetVBlankTicks, "requested target vblank must be held until it passes");
            TestAssert.Equal(1, second.DelayMilliseconds, "wait until requested vblank passes");
            TestAssert.Equal(1017L, second.WaitUntilTicks, "wait target holds until requested vblank passes");
        }

        // DWM scheduler invalid timing falls back to the fallback loop [COT-MOU-25]
        private static void DwmSchedulerInvalidTimingFallsBack()
        {
            DwmSynchronizedRuntimeScheduleDecision decision =
                DwmSynchronizedRuntimeScheduler.EvaluateDwmTiming(
                    1000,
                    1000,
                    0,
                    0,
                    0,
                    DwmSynchronizedRuntimeScheduler.WakeAdvanceMilliseconds,
                    DwmSynchronizedRuntimeScheduler.FallbackIntervalMilliseconds);

            TestAssert.False(decision.IsDwmTimingUsable, "invalid DWM timing");
            TestAssert.False(decision.ShouldTick, "invalid DWM timing should not trigger a DWM tick");
            TestAssert.Equal(8, decision.DelayMilliseconds, "fallback delay");
            TestAssert.Equal(0L, decision.TargetVBlankTicks, "no target vblank");
            TestAssert.Equal(1008L, decision.WaitUntilTicks, "fallback wait target");
        }

        // DWM scheduler holds a requested vblank until that vblank has passed [COT-MOU-30]
        private static void DwmSchedulerHoldsRequestedVBlankUntilItPasses()
        {
            DwmSynchronizedRuntimeScheduleDecision decision =
                DwmSynchronizedRuntimeScheduler.EvaluateDwmTiming(
                    1016,
                    1000,
                    1000,
                    17,
                    1017,
                    DwmSynchronizedRuntimeScheduler.WakeAdvanceMilliseconds,
                    DwmSynchronizedRuntimeScheduler.MaximumDwmSleepMilliseconds);

            TestAssert.True(decision.IsDwmTimingUsable, "DWM timing should be usable");
            TestAssert.False(decision.ShouldTick, "scheduler must not tick twice for a requested vblank");
            TestAssert.Equal(1017L, decision.TargetVBlankTicks, "pending requested vblank");
            TestAssert.Equal(1, decision.DelayMilliseconds, "short wait until requested vblank");
            TestAssert.Equal(1017L, decision.WaitUntilTicks, "wait target holds requested vblank");
        }

        // DWM scheduler advances after the requested vblank has passed [COT-MOU-31]
        private static void DwmSchedulerAdvancesAfterRequestedVBlankPasses()
        {
            DwmSynchronizedRuntimeScheduleDecision decision =
                DwmSynchronizedRuntimeScheduler.EvaluateDwmTiming(
                    1017,
                    1000,
                    1000,
                    17,
                    1017,
                    DwmSynchronizedRuntimeScheduler.WakeAdvanceMilliseconds,
                    DwmSynchronizedRuntimeScheduler.MaximumDwmSleepMilliseconds);

            TestAssert.True(decision.IsDwmTimingUsable, "DWM timing should be usable");
            TestAssert.False(decision.ShouldTick, "next vblank lead window is not reached yet");
            TestAssert.Equal(1034L, decision.TargetVBlankTicks, "next target vblank after requested vblank passes");
            TestAssert.Equal(2, decision.DelayMilliseconds, "long waits should be capped to the short scheduler cadence");
            TestAssert.Equal(1019L, decision.WaitUntilTicks, "wait target remains capped while far from wake lead");
        }

        // High-resolution wait timer waits with best-effort fallback [COT-MOU-32]
        private static void HighResolutionWaitTimerBestEffortWaits()
        {
            using (HighResolutionWaitTimer timer = HighResolutionWaitTimer.CreateBestEffort())
            {
                TestAssert.True(timer != null, "wait timer should be available on Windows");
                TestAssert.True(timer.Wait(1), "wait timer should complete");
                TestAssert.True(timer.WaitTicks(StopwatchTicksForOneMillisecond(), StopwatchTicksPerSecond()), "wait timer ticks should complete");
                TestAssert.True(
                    timer.WaitMethod == "highResolutionWaitableTimer" || timer.WaitMethod == "waitableTimer",
                    "wait timer method should be reported");
            }
        }

        private static long StopwatchTicksForOneMillisecond()
        {
            return System.Diagnostics.Stopwatch.Frequency / 1000;
        }

        private static long StopwatchTicksPerSecond()
        {
            return System.Diagnostics.Stopwatch.Frequency;
        }

        // DWM one-shot scheduler waits directly until the selected vblank lead [COT-MOU-34]
        private static void DwmOneShotSchedulerWaitsUntilAbsoluteWake()
        {
            DwmSynchronizedRuntimeScheduleDecision decision =
                DwmSynchronizedRuntimeScheduler.EvaluateOneShotDwmTiming(
                    1010,
                    1000,
                    1000,
                    17,
                    0,
                    DwmSynchronizedRuntimeScheduler.WakeAdvanceMilliseconds,
                    DwmSynchronizedRuntimeScheduler.FallbackIntervalMilliseconds);

            TestAssert.True(decision.IsDwmTimingUsable, "DWM timing should be usable");
            TestAssert.False(decision.ShouldTick, "one-shot scheduler must wait before the lead window");
            TestAssert.Equal(1017L, decision.TargetVBlankTicks, "target vblank");
            TestAssert.Equal(1013L, decision.WaitUntilTicks, "wait target should be the absolute vblank lead");
        }

        // DWM one-shot scheduler skips near-duplicate reports for the already requested vblank [COT-MOU-35]
        private static void DwmOneShotSchedulerSkipsNearDuplicateVBlank()
        {
            DwmSynchronizedRuntimeScheduleDecision decision =
                DwmSynchronizedRuntimeScheduler.EvaluateOneShotDwmTiming(
                    1015,
                    1000,
                    1001,
                    17,
                    1017,
                    DwmSynchronizedRuntimeScheduler.WakeAdvanceMilliseconds,
                    DwmSynchronizedRuntimeScheduler.FallbackIntervalMilliseconds);

            TestAssert.True(decision.IsDwmTimingUsable, "DWM timing should be usable");
            TestAssert.False(decision.ShouldTick, "near-duplicate target should be advanced to a later frame");
            TestAssert.Equal(1035L, decision.TargetVBlankTicks, "next distinct target vblank");
            TestAssert.Equal(1031L, decision.WaitUntilTicks, "next distinct wait target");
        }

        // Latency-sensitive thread profile summary [COT-MOU-33]
        private static void ThreadLatencyProfileSummary()
        {
            TestAssert.Equal(
                "managed=Highest;mmcss=Games:High",
                CursorMirror.ThreadLatencyProfile.FormatSummary(true, true, true, null),
                "fully applied latency profile summary");
            TestAssert.Equal(
                "managed=Highest;mmcss=unavailable",
                CursorMirror.ThreadLatencyProfile.FormatSummary(true, false, false, null),
                "managed-only latency profile summary");
            TestAssert.Equal(
                "managed=Highest;mmcss=Games:priorityUnavailable;reason=mmcssPriorityFailed:1",
                CursorMirror.ThreadLatencyProfile.FormatSummary(true, true, false, "mmcssPriorityFailed:1"),
                "partial latency profile summary");
            TestAssert.Equal(
                "managed=unavailable;mmcss=unavailable;reason=avrtUnavailable",
                CursorMirror.ThreadLatencyProfile.FormatSummary(false, false, false, "avrtUnavailable"),
                "unavailable latency profile summary");
        }
    }
}
