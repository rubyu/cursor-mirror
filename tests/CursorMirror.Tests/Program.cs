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
            return suite.Run();
        }
    }
}
