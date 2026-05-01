using System.Drawing;

namespace CursorMirror.Tests
{
    internal static class DemoPointerStreamTests
    {
        public static void AddTo(TestSuite suite)
        {
            suite.Add("COT-MEU-1", DeterministicDemoPointerStream);
            suite.Add("COT-MEU-2", StoppedPhaseHookSuppression);
            suite.Add("COT-MEU-3", DemoPathTimingFields);
            suite.Add("COT-MEU-7", DemoPathStartsAtLeftEdge);
        }

        // Deterministic demo pointer stream [COT-MEU-1]
        private static void DeterministicDemoPointerStream()
        {
            Rectangle bounds = new Rectangle(10, 20, 300, 120);
            DemoPointerStream first = new DemoPointerStream(bounds, DemoPointerSpeed.Normal);
            DemoPointerStream second = new DemoPointerStream(bounds, DemoPointerSpeed.Normal);
            double[] elapsedMilliseconds = new double[] { 0, 7.5, 16, 33.4, 250, 750, 1510, 1700, 1900, 2300 };

            for (int i = 0; i < elapsedMilliseconds.Length; i++)
            {
                DemoPointerSample a = first.GetSample(elapsedMilliseconds[i]);
                DemoPointerSample b = second.GetSample(elapsedMilliseconds[i]);
                TestAssert.Equal(a.Position, b.Position, "position");
                TestAssert.Equal(a.ShouldPoll, b.ShouldPoll, "poll flag");
                TestAssert.Equal(a.ShouldHook, b.ShouldHook, "hook flag");
                TestAssert.Equal(a.IsMoving, b.IsMoving, "moving flag");
                TestAssert.Equal(a.Phase, b.Phase, "phase");
                TestAssert.Equal(a.TimestampTicks, b.TimestampTicks, "timestamp");
                TestAssert.Equal(a.DwmVBlankTicks, b.DwmVBlankTicks, "vblank");
                TestAssert.Equal(a.DwmRefreshPeriodTicks, b.DwmRefreshPeriodTicks, "refresh period");
            }
        }

        // Stopped phase hook suppression [COT-MEU-2]
        private static void StoppedPhaseHookSuppression()
        {
            DemoPointerStream stream = new DemoPointerStream(new Rectangle(0, 0, 400, 100), DemoPointerSpeed.Normal);
            bool sawHoldPoll = false;
            bool sawHoldHook = false;

            for (double elapsed = 0; elapsed <= 1900; elapsed += 8)
            {
                DemoPointerSample sample = stream.GetSample(elapsed);
                if (sample.Phase == "hold-right")
                {
                    if (sample.ShouldPoll)
                    {
                        sawHoldPoll = true;
                    }

                    if (sample.ShouldHook)
                    {
                        sawHoldHook = true;
                    }
                }
            }

            TestAssert.True(sawHoldPoll, "stopped phase keeps poll samples");
            TestAssert.False(sawHoldHook, "stopped phase suppresses hook samples");
        }

        // Demo path timing fields [COT-MEU-3]
        private static void DemoPathTimingFields()
        {
            DemoPointerStream stream = new DemoPointerStream(new Rectangle(20, 30, 500, 180), DemoPointerSpeed.Fast);
            stream.GetSample(16.7);
            DemoPointerSample sample = stream.GetSample(33.4);

            TestAssert.True(sample.StopwatchFrequency > 0, "stopwatch frequency is positive");
            TestAssert.Equal(DemoPointerStream.StopwatchFrequency, sample.StopwatchFrequency, "stopwatch frequency");
            TestAssert.Equal(DemoPointerStream.DwmRefreshPeriodTicks, sample.DwmRefreshPeriodTicks, "refresh period");
            TestAssert.True(sample.DwmVBlankTicks <= sample.TimestampTicks, "vblank is not in the future");
            TestAssert.True(sample.TimestampTicks - sample.DwmVBlankTicks < sample.DwmRefreshPeriodTicks, "vblank is within one refresh period");
        }

        // Demo path starts at left edge [COT-MEU-7]
        private static void DemoPathStartsAtLeftEdge()
        {
            Rectangle bounds = new Rectangle(20, 30, 500, 180);
            DemoPointerStream stream = new DemoPointerStream(bounds, DemoPointerSpeed.Normal);
            DemoPointerSample sample = stream.GetSample(0);

            TestAssert.Equal(new Point(bounds.Left, bounds.Top + (bounds.Height / 2)), sample.Position, "initial position");
            TestAssert.Equal("moving-right", sample.Phase, "initial phase");
            TestAssert.True(sample.IsMoving, "initial movement");
        }
    }
}
