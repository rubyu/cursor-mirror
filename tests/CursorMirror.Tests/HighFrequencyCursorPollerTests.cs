using System.Reflection;
using CursorMirror;

namespace CursorMirror.Tests
{
    internal static class HighFrequencyCursorPollerTests
    {
        public static void AddTo(TestSuite suite)
        {
            suite.Add("COT-MOU-44", FallbackSleepUsesBlockingWait);
        }

        // Poller fallback waits must block instead of yielding in a tight loop [COT-MOU-44]
        private static void FallbackSleepUsesBlockingWait()
        {
            TestAssert.Equal(0, CalculateFallbackSleepMilliseconds(0, 1000, 2), "zero remaining time");
            TestAssert.Equal(1, CalculateFallbackSleepMilliseconds(1, 1000, 2), "one millisecond remaining");
            TestAssert.Equal(1, CalculateFallbackSleepMilliseconds(1, 10000000, 2), "sub-millisecond remaining");
            TestAssert.Equal(2, CalculateFallbackSleepMilliseconds(2500, 1000, 2), "maximum sleep cap");
            TestAssert.Equal(1, CalculateFallbackSleepMilliseconds(2500, 1000, 0), "minimum sleep cap");
        }

        private static int CalculateFallbackSleepMilliseconds(long remainingTicks, long stopwatchFrequency, int maximumMilliseconds)
        {
            MethodInfo method = typeof(HighFrequencyCursorPoller).GetMethod(
                "CalculateFallbackSleepMilliseconds",
                BindingFlags.Static | BindingFlags.NonPublic);
            TestAssert.True(method != null, "fallback sleep calculation method");
            return (int)method.Invoke(null, new object[] { remainingTicks, stopwatchFrequency, maximumMilliseconds });
        }
    }
}
