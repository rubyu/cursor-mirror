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
                TestAssert.Equal("Settings", LocalizedStrings.SettingsCommand, "English settings command");
                TestAssert.Equal("Exit Cursor Mirror", LocalizedStrings.ExitCursorMirrorCommand, "English settings exit command");
                TestAssert.Equal("Predict cursor position", LocalizedStrings.PredictiveOverlayPositioningLabel, "English prediction label");
                TestAssert.Equal("Start Recording", LocalizedStrings.TraceStartRecordingCommand, "English trace start command");
                TestAssert.Equal("Stop Recording", LocalizedStrings.TraceStopRecordingCommand, "English trace stop command");
                TestAssert.Equal("Total samples", LocalizedStrings.TraceTotalSampleCountLabel, "English trace total samples label");
                TestAssert.Equal("Hook move", LocalizedStrings.TraceHookMoveSampleCountLabel, "English trace hook move label");
                TestAssert.Equal("Cursor poll", LocalizedStrings.TraceCursorPollSampleCountLabel, "English trace cursor poll label");
                TestAssert.Equal("DWM timing", LocalizedStrings.TraceDwmTimingSampleCountLabel, "English trace dwm timing label");
                TestAssert.Equal("1 / 2 (50.0%)", LocalizedStrings.TraceDwmTimingSampleCount(1, 2), "English trace dwm timing count");
                TestAssert.Equal(
                    "Cursor Mirror failed to start.\r\n\r\nboom",
                    LocalizedStrings.StartupFailureMessage("boom"),
                    "English startup failure message");

                Thread.CurrentThread.CurrentCulture = CultureInfo.GetCultureInfo("ja-JP");
                Thread.CurrentThread.CurrentUICulture = CultureInfo.GetCultureInfo("ja-JP");
                TestAssert.Equal("終了", LocalizedStrings.ExitCommand, "Japanese exit command");
                TestAssert.Equal("設定", LocalizedStrings.SettingsCommand, "Japanese settings command");
                TestAssert.Equal("Cursor Mirror を終了", LocalizedStrings.ExitCursorMirrorCommand, "Japanese settings exit command");
                TestAssert.Equal("カーソル位置を予測する", LocalizedStrings.PredictiveOverlayPositioningLabel, "Japanese prediction label");
                TestAssert.Equal("記録開始", LocalizedStrings.TraceStartRecordingCommand, "Japanese trace start command");
                TestAssert.Equal("記録終了", LocalizedStrings.TraceStopRecordingCommand, "Japanese trace stop command");
                TestAssert.Equal("総サンプル数", LocalizedStrings.TraceTotalSampleCountLabel, "Japanese trace total samples label");
                TestAssert.Equal("フック移動", LocalizedStrings.TraceHookMoveSampleCountLabel, "Japanese trace hook move label");
                TestAssert.Equal("カーソルポーリング", LocalizedStrings.TraceCursorPollSampleCountLabel, "Japanese trace cursor poll label");
                TestAssert.Equal("DWM タイミング", LocalizedStrings.TraceDwmTimingSampleCountLabel, "Japanese trace dwm timing label");
                TestAssert.Equal("1 / 2 (50.0%)", LocalizedStrings.TraceDwmTimingSampleCount(1, 2), "Japanese trace dwm timing count");
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
