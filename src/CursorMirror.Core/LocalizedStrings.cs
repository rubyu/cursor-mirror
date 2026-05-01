using System.Globalization;

namespace CursorMirror
{
    public static class LocalizedStrings
    {
        public static string ProductName
        {
            get { return "Cursor Mirror"; }
        }

        public static string ExitCommand
        {
            get { return Get("ExitCommand"); }
        }

        public static string SettingsCommand
        {
            get { return Get("SettingsCommand"); }
        }

        public static string SettingsTitle
        {
            get { return Get("SettingsTitle"); }
        }

        public static string MovementTranslucencyLabel
        {
            get { return Get("MovementTranslucencyLabel"); }
        }

        public static string PredictiveOverlayPositioningLabel
        {
            get { return Get("PredictiveOverlayPositioningLabel"); }
        }

        public static string MovingOpacityLabel
        {
            get { return Get("MovingOpacityLabel"); }
        }

        public static string FadeDurationLabel
        {
            get { return Get("FadeDurationLabel"); }
        }

        public static string IdleDelayLabel
        {
            get { return Get("IdleDelayLabel"); }
        }

        public static string ResetCommand
        {
            get { return Get("ResetCommand"); }
        }

        public static string CloseCommand
        {
            get { return Get("CloseCommand"); }
        }

        public static string ExitCursorMirrorCommand
        {
            get { return Get("ExitCursorMirrorCommand"); }
        }

        public static string TraceToolTitle
        {
            get { return Get("TraceToolTitle"); }
        }

        public static string TraceStatusLabel
        {
            get { return Get("TraceStatusLabel"); }
        }

        public static string TraceSampleCountLabel
        {
            get { return Get("TraceSampleCountLabel"); }
        }

        public static string TraceTotalSampleCountLabel
        {
            get { return Get("TraceTotalSampleCountLabel"); }
        }

        public static string TraceHookMoveSampleCountLabel
        {
            get { return Get("TraceHookMoveSampleCountLabel"); }
        }

        public static string TraceCursorPollSampleCountLabel
        {
            get { return Get("TraceCursorPollSampleCountLabel"); }
        }

        public static string TraceDwmTimingSampleCountLabel
        {
            get { return Get("TraceDwmTimingSampleCountLabel"); }
        }

        public static string TraceDurationLabel
        {
            get { return Get("TraceDurationLabel"); }
        }

        public static string TraceStartRecordingCommand
        {
            get { return Get("TraceStartRecordingCommand"); }
        }

        public static string TraceStopRecordingCommand
        {
            get { return Get("TraceStopRecordingCommand"); }
        }

        public static string TraceSaveCommand
        {
            get { return Get("TraceSaveCommand"); }
        }

        public static string TraceSaveDialogTitle
        {
            get { return Get("TraceSaveDialogTitle"); }
        }

        public static string TraceSaveDialogFilter
        {
            get { return Get("TraceSaveDialogFilter"); }
        }

        public static string TraceUnsavedExitMessage
        {
            get { return Get("TraceUnsavedExitMessage"); }
        }

        public static string TraceDiscardUnsavedMessage
        {
            get { return Get("TraceDiscardUnsavedMessage"); }
        }

        public static string TraceStateLabel(string state)
        {
            return string.Format(CultureInfo.CurrentUICulture, Get("TraceStateLabelFormat"), state);
        }

        public static string TraceDwmTimingSampleCount(int availableSamples, int pollSamples)
        {
            int safePollSamples = pollSamples < 0 ? 0 : pollSamples;
            int safeAvailableSamples = availableSamples < 0 ? 0 : availableSamples;
            double percent = safePollSamples == 0 ? 0 : (safeAvailableSamples * 100.0) / safePollSamples;
            return string.Format(CultureInfo.CurrentUICulture, Get("TraceDwmTimingSampleCountFormat"), safeAvailableSamples, safePollSamples, percent);
        }

        public static string StartupFailureTitle
        {
            get { return ProductName; }
        }

        public static string StartupFailureMessage(string detail)
        {
            return string.Format(CultureInfo.CurrentUICulture, Get("StartupFailureMessageFormat"), detail);
        }

        private static string Get(string key)
        {
            string language = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName;
            if (language == "ja")
            {
                string ja = GetJapanese(key);
                if (ja != null)
                {
                    return ja;
                }
            }

            return GetEnglish(key);
        }

        private static string GetEnglish(string key)
        {
            switch (key)
            {
                case "ExitCommand":
                    return "Exit";
                case "SettingsCommand":
                    return "Settings";
                case "SettingsTitle":
                    return "Cursor Mirror Settings";
                case "MovementTranslucencyLabel":
                    return "Movement translucency";
                case "PredictiveOverlayPositioningLabel":
                    return "Predict cursor position";
                case "MovingOpacityLabel":
                    return "Moving opacity (%)";
                case "FadeDurationLabel":
                    return "Fade duration (ms)";
                case "IdleDelayLabel":
                    return "Idle delay (ms)";
                case "ResetCommand":
                    return "Reset";
                case "CloseCommand":
                    return "Close";
                case "ExitCursorMirrorCommand":
                    return "Exit Cursor Mirror";
                case "TraceToolTitle":
                    return "Cursor Mirror Trace Tool";
                case "TraceStatusLabel":
                    return "Status";
                case "TraceSampleCountLabel":
                    return "Samples";
                case "TraceTotalSampleCountLabel":
                    return "Total samples";
                case "TraceHookMoveSampleCountLabel":
                    return "Hook move";
                case "TraceCursorPollSampleCountLabel":
                    return "Cursor poll";
                case "TraceDwmTimingSampleCountLabel":
                    return "DWM timing";
                case "TraceDurationLabel":
                    return "Duration";
                case "TraceStartRecordingCommand":
                    return "Start Recording";
                case "TraceStopRecordingCommand":
                    return "Stop Recording";
                case "TraceSaveCommand":
                    return "Save";
                case "TraceSaveDialogTitle":
                    return "Save Mouse Trace";
                case "TraceSaveDialogFilter":
                    return "Cursor Mirror trace package (*.zip)|*.zip";
                case "TraceUnsavedExitMessage":
                    return "Unsaved trace samples will be discarded. Exit Cursor Mirror Trace Tool?";
                case "TraceDiscardUnsavedMessage":
                    return "Unsaved trace samples will be discarded. Start a new recording?";
                case "TraceStateLabelFormat":
                    return "{0}";
                case "TraceDwmTimingSampleCountFormat":
                    return "{0} / {1} ({2:0.0}%)";
                case "StartupFailureMessageFormat":
                    return "Cursor Mirror failed to start.\r\n\r\n{0}";
                default:
                    return key;
            }
        }

        private static string GetJapanese(string key)
        {
            switch (key)
            {
                case "ExitCommand":
                    return "終了";
                case "SettingsCommand":
                    return "設定";
                case "SettingsTitle":
                    return "Cursor Mirror 設定";
                case "MovementTranslucencyLabel":
                    return "移動中に半透明にする";
                case "PredictiveOverlayPositioningLabel":
                    return "カーソル位置を予測する";
                case "MovingOpacityLabel":
                    return "移動中の不透明度 (%)";
                case "FadeDurationLabel":
                    return "フェード時間 (ms)";
                case "IdleDelayLabel":
                    return "待機時間 (ms)";
                case "ResetCommand":
                    return "リセット";
                case "CloseCommand":
                    return "閉じる";
                case "ExitCursorMirrorCommand":
                    return "Cursor Mirror を終了";
                case "TraceToolTitle":
                    return "Cursor Mirror トレースツール";
                case "TraceStatusLabel":
                    return "状態";
                case "TraceSampleCountLabel":
                    return "サンプル数";
                case "TraceTotalSampleCountLabel":
                    return "総サンプル数";
                case "TraceHookMoveSampleCountLabel":
                    return "フック移動";
                case "TraceCursorPollSampleCountLabel":
                    return "カーソルポーリング";
                case "TraceDwmTimingSampleCountLabel":
                    return "DWM タイミング";
                case "TraceDurationLabel":
                    return "記録時間";
                case "TraceStartRecordingCommand":
                    return "記録開始";
                case "TraceStopRecordingCommand":
                    return "記録終了";
                case "TraceSaveCommand":
                    return "保存";
                case "TraceSaveDialogTitle":
                    return "マウストレースを保存";
                case "TraceSaveDialogFilter":
                    return "Cursor Mirror トレースパッケージ (*.zip)|*.zip";
                case "TraceUnsavedExitMessage":
                    return "未保存のトレースサンプルは破棄されます。Cursor Mirror トレースツールを終了しますか？";
                case "TraceDiscardUnsavedMessage":
                    return "未保存のトレースサンプルは破棄されます。新しい記録を開始しますか？";
                case "TraceStateLabelFormat":
                    return "{0}";
                case "TraceDwmTimingSampleCountFormat":
                    return "{0} / {1} ({2:0.0}%)";
                case "StartupFailureMessageFormat":
                    return "Cursor Mirror の起動に失敗しました。\r\n\r\n{0}";
                default:
                    return null;
            }
        }
    }
}
