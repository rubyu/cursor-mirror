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
        }

        // DWM scheduler waits until the configured vblank lead time [COT-MOU-23]
        private static void DwmSchedulerWaitsUntilVBlankLead()
        {
            DwmSynchronizedRuntimeScheduleDecision decision =
                DwmSynchronizedRuntimeScheduler.EvaluateDwmTiming(1010, 1000, 1000, 17, 0, 2, 8);

            TestAssert.True(decision.IsDwmTimingUsable, "DWM timing should be usable");
            TestAssert.False(decision.ShouldTick, "scheduler must wait before the lead window");
            TestAssert.Equal(5, decision.DelayMilliseconds, "delay to wake lead");
            TestAssert.Equal(1017L, decision.TargetVBlankTicks, "target vblank");
        }

        // DWM scheduler requests one tick per target vblank [COT-MOU-24]
        private static void DwmSchedulerRequestsOneTickPerVBlank()
        {
            DwmSynchronizedRuntimeScheduleDecision first =
                DwmSynchronizedRuntimeScheduler.EvaluateDwmTiming(1015, 1000, 1000, 17, 0, 2, 8);
            DwmSynchronizedRuntimeScheduleDecision second =
                DwmSynchronizedRuntimeScheduler.EvaluateDwmTiming(1016, 1000, 1000, 17, first.TargetVBlankTicks, 2, 8);

            TestAssert.True(first.ShouldTick, "scheduler should tick inside the lead window");
            TestAssert.Equal(1017L, first.TargetVBlankTicks, "first target vblank");
            TestAssert.False(second.ShouldTick, "scheduler must not repeat the same vblank");
            TestAssert.Equal(1034L, second.TargetVBlankTicks, "next target vblank");
            TestAssert.Equal(8, second.DelayMilliseconds, "long waits should be capped");
        }

        // DWM scheduler invalid timing falls back to the fallback loop [COT-MOU-25]
        private static void DwmSchedulerInvalidTimingFallsBack()
        {
            DwmSynchronizedRuntimeScheduleDecision decision =
                DwmSynchronizedRuntimeScheduler.EvaluateDwmTiming(1000, 1000, 0, 0, 0, 2, 8);

            TestAssert.False(decision.IsDwmTimingUsable, "invalid DWM timing");
            TestAssert.False(decision.ShouldTick, "invalid DWM timing should not trigger a DWM tick");
            TestAssert.Equal(8, decision.DelayMilliseconds, "fallback delay");
            TestAssert.Equal(0L, decision.TargetVBlankTicks, "no target vblank");
        }
    }
}
