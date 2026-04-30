namespace CursorMirror.Tests
{
    internal static class Program
    {
        private static int Main()
        {
            TestSuite suite = new TestSuite();
            HookTests.AddTo(suite);
            CursorImageProviderTests.AddTo(suite);
            ControllerTests.AddTo(suite);
            LocalizedStringsTests.AddTo(suite);
            BuildVersionTests.AddTo(suite);
            MovementOpacityControllerTests.AddTo(suite);
            SettingsTests.AddTo(suite);
            MouseTraceTests.AddTo(suite);
            return suite.Run();
        }
    }
}
