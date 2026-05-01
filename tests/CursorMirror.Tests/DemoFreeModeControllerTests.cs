namespace CursorMirror.Tests
{
    internal static class DemoFreeModeControllerTests
    {
        public static void AddTo(TestSuite suite)
        {
            suite.Add("COT-MEU-4", ExternalInputEntersFreeMode);
            suite.Add("COT-MEU-5", FreeModeResumesAfterThreeSeconds);
            suite.Add("COT-MEU-6", RepeatedExternalInputExtendsFreeMode);
        }

        // External input enters free mode [COT-MEU-4]
        private static void ExternalInputEntersFreeMode()
        {
            DemoFreeModeController controller = new DemoFreeModeController();
            TestAssert.Equal(DemoInputMode.Auto, controller.Mode, "initial mode");
            controller.RecordExternalInput(123);
            TestAssert.Equal(DemoInputMode.Free, controller.Mode, "external input switches to free mode");
            TestAssert.Equal(123L, controller.LastExternalInputMilliseconds, "last external input time");
        }

        // Free mode resumes after three seconds [COT-MEU-5]
        private static void FreeModeResumesAfterThreeSeconds()
        {
            DemoFreeModeController controller = new DemoFreeModeController();
            controller.RecordExternalInput(1000);
            TestAssert.False(controller.Tick(3999), "does not resume before timeout");
            TestAssert.Equal(DemoInputMode.Free, controller.Mode, "still free before timeout");
            TestAssert.True(controller.Tick(4000), "resumes at three seconds");
            TestAssert.Equal(DemoInputMode.Auto, controller.Mode, "auto after timeout");
        }

        // Repeated external input extends free mode [COT-MEU-6]
        private static void RepeatedExternalInputExtendsFreeMode()
        {
            DemoFreeModeController controller = new DemoFreeModeController();
            controller.RecordExternalInput(1000);
            controller.RecordExternalInput(9000);
            TestAssert.False(controller.Tick(11999), "second input extends timeout");
            TestAssert.Equal(1, controller.RemainingMilliseconds(11999), "remaining time");
            TestAssert.True(controller.Tick(12000), "resumes three seconds after latest input");
        }
    }
}
