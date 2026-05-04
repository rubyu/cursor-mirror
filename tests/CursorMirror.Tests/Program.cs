namespace CursorMirror.Tests
{
    internal static class Program
    {
        private static int Main()
        {
            TestSuite suite = new TestSuite();
            HookTests.AddTo(suite);
            CursorImageProviderTests.AddTo(suite);
            CursorPositionPredictorTests.AddTo(suite);
            CalibrationTests.AddTo(suite);
            ControllerTests.AddTo(suite);
            LocalizedStringsTests.AddTo(suite);
            BuildVersionTests.AddTo(suite);
            VersionUpdateTests.AddTo(suite);
            MovementOpacityControllerTests.AddTo(suite);
            RuntimeSchedulerTests.AddTo(suite);
            HighFrequencyCursorPollerTests.AddTo(suite);
            SettingsTests.AddTo(suite);
            SettingsWindowTests.AddTo(suite);
            MouseTraceTests.AddTo(suite);
            ProductRuntimeTelemetryTests.AddTo(suite);
            DemoPointerStreamTests.AddTo(suite);
            DemoFreeModeControllerTests.AddTo(suite);
            DemoSettingsTests.AddTo(suite);
            return suite.Run();
        }
    }
}
