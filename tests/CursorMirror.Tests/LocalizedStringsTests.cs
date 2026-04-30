using System.Globalization;
using System.Threading;
using CursorMirror;

namespace CursorMirror.Tests
{
    internal static class LocalizedStringsTests
    {
        public static void AddTo(TestSuite suite)
        {
            suite.Add("COT-MTU-4", LocalizedUserVisibleStrings);
        }

        // Localized user-visible strings [COT-MTU-4]
        private static void LocalizedUserVisibleStrings()
        {
            CultureInfo originalCulture = Thread.CurrentThread.CurrentCulture;
            CultureInfo originalUiCulture = Thread.CurrentThread.CurrentUICulture;

            try
            {
                Thread.CurrentThread.CurrentCulture = CultureInfo.GetCultureInfo("en-US");
                Thread.CurrentThread.CurrentUICulture = CultureInfo.GetCultureInfo("en-US");
                TestAssert.Equal("Exit", LocalizedStrings.ExitCommand, "English exit command");
                TestAssert.Equal(
                    "Cursor Mirror failed to start.\r\n\r\nboom",
                    LocalizedStrings.StartupFailureMessage("boom"),
                    "English startup failure message");

                Thread.CurrentThread.CurrentCulture = CultureInfo.GetCultureInfo("ja-JP");
                Thread.CurrentThread.CurrentUICulture = CultureInfo.GetCultureInfo("ja-JP");
                TestAssert.Equal("終了", LocalizedStrings.ExitCommand, "Japanese exit command");
                TestAssert.Equal(
                    "Cursor Mirror の起動に失敗しました。\r\n\r\nboom",
                    LocalizedStrings.StartupFailureMessage("boom"),
                    "Japanese startup failure message");
            }
            finally
            {
                Thread.CurrentThread.CurrentCulture = originalCulture;
                Thread.CurrentThread.CurrentUICulture = originalUiCulture;
            }
        }
    }
}
