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
                TestAssert.Equal("Fade when idle", LocalizedStrings.IdleFadeLabel, "English idle fade label");
                TestAssert.Equal("Idle opacity (%)", LocalizedStrings.IdleOpacityLabel, "English idle opacity label");
                TestAssert.Equal("Idle fade delay (s)", LocalizedStrings.IdleFadeDelayLabel, "English idle fade delay label");
                TestAssert.Equal("Version: v1.2.0+20260501.abcdef123456", LocalizedStrings.VersionMenuText("v1.2.0+20260501.abcdef123456"), "English version menu text");
                TestAssert.Equal("Update: up to date (v1.2.0)", LocalizedStrings.UpdateStatusUpToDate("v1.2.0"), "English up-to-date status");
                TestAssert.Equal("Update: 2 release(s) behind (v1.3.0)", LocalizedStrings.UpdateStatusBehind(2, "v1.3.0"), "English behind status");
                TestAssert.Equal("Update: development build; latest v1.3.0", LocalizedStrings.UpdateStatusDevelopmentBuild("v1.3.0"), "English development status");
                TestAssert.Equal("Start Recording", LocalizedStrings.TraceStartRecordingCommand, "English trace start command");
                TestAssert.Equal("Stop Recording", LocalizedStrings.TraceStopRecordingCommand, "English trace stop command");
                TestAssert.Equal("Total samples", LocalizedStrings.TraceTotalSampleCountLabel, "English trace total samples label");
                TestAssert.Equal("Hook move", LocalizedStrings.TraceHookMoveSampleCountLabel, "English trace hook move label");
                TestAssert.Equal("Cursor poll", LocalizedStrings.TraceCursorPollSampleCountLabel, "English trace cursor poll label");
                TestAssert.Equal("Reference poll", LocalizedStrings.TraceReferencePollSampleCountLabel, "English trace reference poll label");
                TestAssert.Equal("Runtime scheduler poll", LocalizedStrings.TraceRuntimeSchedulerPollSampleCountLabel, "English trace runtime scheduler poll label");
                TestAssert.Equal("DWM timing", LocalizedStrings.TraceDwmTimingSampleCountLabel, "English trace dwm timing label");
                TestAssert.Equal("1 / 2 (50.0%)", LocalizedStrings.TraceDwmTimingSampleCount(1, 2), "English trace dwm timing count");
                TestAssert.Equal("Start Demo", LocalizedStrings.DemoStartCommand, "English demo start command");
                TestAssert.Equal("Language", LocalizedStrings.DemoLanguageLabel, "English demo language label");
                TestAssert.Equal("System language", LocalizedStrings.DemoLanguageSystem, "English demo system language option");
                TestAssert.Equal("Show mirrored cursor", LocalizedStrings.DemoMirrorCursorLabel, "English demo mirror cursor label");
                TestAssert.Equal("Mirrored cursor: On", LocalizedStrings.DemoMirrorCursorStatus(LocalizedStrings.DemoEnabledLabel), "English demo mirror status");
                TestAssert.Equal("640 x 480", LocalizedStrings.DemoWindowPresetVga, "English demo VGA preset");
                TestAssert.Equal("Press any key to stop", LocalizedStrings.DemoEscHint, "English demo key hint");
                TestAssert.Equal("Press any key to stop", LocalizedStrings.DemoAnyKeyHint, "English demo any key hint");
                TestAssert.Equal("Free", LocalizedStrings.DemoFreeModeLabel, "English demo free mode");
                TestAssert.Equal("3.0s", LocalizedStrings.DemoResumeCountdown(3000), "English demo resume countdown");
                TestAssert.True(
                    LocalizedStrings.DemoMainAppRunningMessage.Contains("already running"),
                    "English demo main-app warning");
                TestAssert.Equal(
                    "Cursor Mirror failed to start.\r\n\r\nboom",
                    LocalizedStrings.StartupFailureMessage("boom"),
                    "English startup failure message");
                TestAssert.True(
                    LocalizedStrings.SettingsRestoreFailureMessage("settings.json", "boom").Contains("Defaults will be used"),
                    "English settings restore failure message");
                TestAssert.True(
                    LocalizedStrings.DemoSettingsRestoreFailureMessage("demo-settings.json", "boom").Contains("Demo settings could not be restored"),
                    "English demo settings restore failure message");

                Thread.CurrentThread.CurrentCulture = CultureInfo.GetCultureInfo("ja-JP");
                Thread.CurrentThread.CurrentUICulture = CultureInfo.GetCultureInfo("ja-JP");
                TestAssert.Equal("終了", LocalizedStrings.ExitCommand, "Japanese exit command");
                TestAssert.Equal("設定", LocalizedStrings.SettingsCommand, "Japanese settings command");
                TestAssert.Equal("Cursor Mirror を終了", LocalizedStrings.ExitCursorMirrorCommand, "Japanese settings exit command");
                TestAssert.Equal("カーソル位置を予測する", LocalizedStrings.PredictiveOverlayPositioningLabel, "Japanese prediction label");
                TestAssert.Equal("停止後にフェードする", LocalizedStrings.IdleFadeLabel, "Japanese idle fade label");
                TestAssert.Equal("停止後の不透明度 (%)", LocalizedStrings.IdleOpacityLabel, "Japanese idle opacity label");
                TestAssert.Equal("停止後フェード待機 (秒)", LocalizedStrings.IdleFadeDelayLabel, "Japanese idle fade delay label");
                TestAssert.Equal("バージョン: v1.2.0+20260501.abcdef123456", LocalizedStrings.VersionMenuText("v1.2.0+20260501.abcdef123456"), "Japanese version menu text");
                TestAssert.Equal("更新: 最新です (v1.2.0)", LocalizedStrings.UpdateStatusUpToDate("v1.2.0"), "Japanese up-to-date status");
                TestAssert.Equal("更新: 2 リリース遅れ (v1.3.0)", LocalizedStrings.UpdateStatusBehind(2, "v1.3.0"), "Japanese behind status");
                TestAssert.Equal("更新: 開発版です。最新 v1.3.0", LocalizedStrings.UpdateStatusDevelopmentBuild("v1.3.0"), "Japanese development status");
                TestAssert.Equal("記録開始", LocalizedStrings.TraceStartRecordingCommand, "Japanese trace start command");
                TestAssert.Equal("記録終了", LocalizedStrings.TraceStopRecordingCommand, "Japanese trace stop command");
                TestAssert.Equal("総サンプル数", LocalizedStrings.TraceTotalSampleCountLabel, "Japanese trace total samples label");
                TestAssert.Equal("フック移動", LocalizedStrings.TraceHookMoveSampleCountLabel, "Japanese trace hook move label");
                TestAssert.Equal("カーソルポーリング", LocalizedStrings.TraceCursorPollSampleCountLabel, "Japanese trace cursor poll label");
                TestAssert.Equal("高精度参照ポーリング", LocalizedStrings.TraceReferencePollSampleCountLabel, "Japanese trace reference poll label");
                TestAssert.Equal("実行時スケジューラーポーリング", LocalizedStrings.TraceRuntimeSchedulerPollSampleCountLabel, "Japanese trace runtime scheduler poll label");
                TestAssert.Equal("DWM タイミング", LocalizedStrings.TraceDwmTimingSampleCountLabel, "Japanese trace dwm timing label");
                TestAssert.Equal("1 / 2 (50.0%)", LocalizedStrings.TraceDwmTimingSampleCount(1, 2), "Japanese trace dwm timing count");
                TestAssert.Equal("デモ開始", LocalizedStrings.DemoStartCommand, "Japanese demo start command");
                TestAssert.Equal("表示言語", LocalizedStrings.DemoLanguageLabel, "Japanese demo language label");
                TestAssert.Equal("システム設定", LocalizedStrings.DemoLanguageSystem, "Japanese demo system language option");
                TestAssert.Equal("ミラーカーソルを表示する", LocalizedStrings.DemoMirrorCursorLabel, "Japanese demo mirror cursor label");
                TestAssert.Equal("ミラーカーソル: オン", LocalizedStrings.DemoMirrorCursorStatus(LocalizedStrings.DemoEnabledLabel), "Japanese demo mirror status");
                TestAssert.Equal("640 x 480", LocalizedStrings.DemoWindowPresetVga, "Japanese demo VGA preset");
                TestAssert.Equal("いずれかのキーで停止", LocalizedStrings.DemoEscHint, "Japanese demo key hint");
                TestAssert.Equal("いずれかのキーで停止", LocalizedStrings.DemoAnyKeyHint, "Japanese demo any key hint");
                TestAssert.Equal("Free", LocalizedStrings.DemoFreeModeLabel, "Japanese demo free mode");
                TestAssert.Equal("3.0s", LocalizedStrings.DemoResumeCountdown(3000), "Japanese demo resume countdown");
                TestAssert.True(
                    LocalizedStrings.DemoMainAppRunningMessage.Contains("起動中"),
                    "Japanese demo main-app warning");
                TestAssert.Equal(
                    "Cursor Mirror の起動に失敗しました。\r\n\r\nboom",
                    LocalizedStrings.StartupFailureMessage("boom"),
                    "Japanese startup failure message");
                TestAssert.True(
                    LocalizedStrings.SettingsRestoreFailureMessage("settings.json", "boom").Contains("設定を復元できませんでした"),
                    "Japanese settings restore failure message");
                TestAssert.True(
                    LocalizedStrings.DemoSettingsRestoreFailureMessage("demo-settings.json", "boom").Contains("デモ設定を復元できませんでした"),
                    "Japanese demo settings restore failure message");
            }
            finally
            {
                Thread.CurrentThread.CurrentCulture = originalCulture;
                Thread.CurrentThread.CurrentUICulture = originalUiCulture;
            }
        }
    }
}
