using System;
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

        public static string PredictionGainLabel
        {
            get { return Get("PredictionGainLabel"); }
        }

        public static string PredictionModelLabel
        {
            get { return Get("PredictionModelLabel"); }
        }

        public static string PredictionTargetOffsetLabel
        {
            get { return Get("PredictionTargetOffsetLabel"); }
        }

        public static string DistilledMlpPostStopBrakeLabel
        {
            get { return Get("DistilledMlpPostStopBrakeLabel"); }
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

        public static string IdleFadeLabel
        {
            get { return Get("IdleFadeLabel"); }
        }

        public static string IdleOpacityLabel
        {
            get { return Get("IdleOpacityLabel"); }
        }

        public static string IdleFadeDelayLabel
        {
            get { return Get("IdleFadeDelayLabel"); }
        }

        public static string VersionMenuLabel
        {
            get { return Get("VersionMenuLabel"); }
        }

        public static string UpdateStatusChecking
        {
            get { return Get("UpdateStatusChecking"); }
        }

        public static string UpdateStatusUnknown
        {
            get { return Get("UpdateStatusUnknown"); }
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

        public static string TraceReferencePollSampleCountLabel
        {
            get { return Get("TraceReferencePollSampleCountLabel"); }
        }

        public static string TraceRuntimeSchedulerPollSampleCountLabel
        {
            get { return Get("TraceRuntimeSchedulerPollSampleCountLabel"); }
        }

        public static string TraceRuntimeSchedulerLoopSampleCountLabel
        {
            get { return Get("TraceRuntimeSchedulerLoopSampleCountLabel"); }
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

        public static string DemoToolTitle
        {
            get { return Get("DemoToolTitle"); }
        }

        public static string DemoDisplayModeLabel
        {
            get { return Get("DemoDisplayModeLabel"); }
        }

        public static string DemoLanguageLabel
        {
            get { return Get("DemoLanguageLabel"); }
        }

        public static string DemoLanguageSystem
        {
            get { return Get("DemoLanguageSystem"); }
        }

        public static string DemoLanguageEnglish
        {
            get { return Get("DemoLanguageEnglish"); }
        }

        public static string DemoLanguageJapanese
        {
            get { return Get("DemoLanguageJapanese"); }
        }

        public static string DemoSpeedLabel
        {
            get { return Get("DemoSpeedLabel"); }
        }

        public static string DemoMirrorCursorLabel
        {
            get { return Get("DemoMirrorCursorLabel"); }
        }

        public static string DemoStartCommand
        {
            get { return Get("DemoStartCommand"); }
        }

        public static string DemoWindowPresetVga
        {
            get { return Get("DemoWindowPresetVga"); }
        }

        public static string DemoWindowPreset720
        {
            get { return Get("DemoWindowPreset720"); }
        }

        public static string DemoWindowPreset1080
        {
            get { return Get("DemoWindowPreset1080"); }
        }

        public static string DemoFullscreenOption
        {
            get { return Get("DemoFullscreenOption"); }
        }

        public static string DemoSpeedSlow
        {
            get { return Get("DemoSpeedSlow"); }
        }

        public static string DemoSpeedNormal
        {
            get { return Get("DemoSpeedNormal"); }
        }

        public static string DemoSpeedFast
        {
            get { return Get("DemoSpeedFast"); }
        }

        public static string DemoAnyKeyHint
        {
            get { return Get("DemoAnyKeyHint"); }
        }

        public static string DemoEscHint
        {
            get { return Get("DemoEscHint"); }
        }

        public static string DemoRealCursorNote
        {
            get { return Get("DemoRealCursorNote"); }
        }

        public static string DemoMainAppRunningMessage
        {
            get { return Get("DemoMainAppRunningMessage"); }
        }

        public static string DemoMainAppShutdownFailedMessage
        {
            get { return Get("DemoMainAppShutdownFailedMessage"); }
        }

        public static string DemoAutoModeLabel
        {
            get { return Get("DemoAutoModeLabel"); }
        }

        public static string DemoFreeModeLabel
        {
            get { return Get("DemoFreeModeLabel"); }
        }

        public static string DemoResumeActiveLabel
        {
            get { return Get("DemoResumeActiveLabel"); }
        }

        public static string DemoEnabledLabel
        {
            get { return Get("DemoEnabledLabel"); }
        }

        public static string DemoDisabledLabel
        {
            get { return Get("DemoDisabledLabel"); }
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

        public static string DemoPhaseLabel(string phase)
        {
            return Get("DemoPhase" + phase);
        }

        public static string DemoStatus(
            string mode,
            string speed,
            string resume,
            string relativeCursorX,
            int sentMoves)
        {
            return string.Format(
                CultureInfo.CurrentUICulture,
                Get("DemoStatusFormat"),
                mode,
                speed,
                resume,
                relativeCursorX,
                sentMoves);
        }

        public static string DemoMirrorCursorStatus(string enabled)
        {
            return string.Format(CultureInfo.CurrentUICulture, Get("DemoMirrorCursorStatusFormat"), enabled);
        }

        public static string DemoRelativeCursorX(int relativeX)
        {
            return string.Format(CultureInfo.CurrentUICulture, Get("DemoRelativeCursorXFormat"), relativeX);
        }

        public static string DemoResumeCountdown(int remainingMilliseconds)
        {
            double seconds = Math.Max(0, remainingMilliseconds) / 1000.0;
            return string.Format(CultureInfo.CurrentUICulture, Get("DemoResumeCountdownFormat"), seconds);
        }

        public static string VersionMenuText(string version)
        {
            return string.Format(CultureInfo.CurrentUICulture, Get("VersionMenuFormat"), version);
        }

        public static string UpdateStatusUpToDate(string latestVersion)
        {
            return string.Format(CultureInfo.CurrentUICulture, Get("UpdateStatusUpToDateFormat"), latestVersion);
        }

        public static string UpdateStatusBehind(int versionsBehind, string latestVersion)
        {
            return string.Format(CultureInfo.CurrentUICulture, Get("UpdateStatusBehindFormat"), versionsBehind, latestVersion);
        }

        public static string UpdateStatusDevelopmentBuild(string latestVersion)
        {
            return string.Format(CultureInfo.CurrentUICulture, Get("UpdateStatusDevelopmentBuildFormat"), latestVersion);
        }

        public static string UpdateStatusAheadOfLatest(string latestVersion)
        {
            return string.Format(CultureInfo.CurrentUICulture, Get("UpdateStatusAheadOfLatestFormat"), latestVersion);
        }

        public static string PredictionModelOptionText(int predictionModel)
        {
            string name = PredictionModelName(predictionModel);
            if (predictionModel == CursorMirrorSettings.DefaultDwmPredictionModel)
            {
                return name + " (default)";
            }

            return name;
        }

        public static string PredictionModelName(int predictionModel)
        {
            if (predictionModel == CursorMirrorSettings.DwmPredictionModelLeastSquares)
            {
                return "LeastSquares";
            }

            if (predictionModel == CursorMirrorSettings.DwmPredictionModelExperimentalMlp)
            {
                return "ExperimentalMLP";
            }

            if (predictionModel == CursorMirrorSettings.DwmPredictionModelDistilledMlp)
            {
                return "DistilledMLP";
            }

            if (predictionModel == CursorMirrorSettings.DwmPredictionModelRuntimeEventSafeMlp)
            {
                return "RuntimeEventSafeMLP";
            }

            return "ConstantVelocity";
        }

        public static string StartupFailureTitle
        {
            get { return ProductName; }
        }

        public static string StartupFailureMessage(string detail)
        {
            return string.Format(CultureInfo.CurrentUICulture, Get("StartupFailureMessageFormat"), detail);
        }

        public static string SettingsRestoreFailureMessage(string path, string detail)
        {
            return string.Format(
                CultureInfo.CurrentUICulture,
                Get("SettingsRestoreFailureMessageFormat"),
                path,
                detail);
        }

        public static string DemoSettingsRestoreFailureMessage(string path, string detail)
        {
            return string.Format(
                CultureInfo.CurrentUICulture,
                Get("DemoSettingsRestoreFailureMessageFormat"),
                path,
                detail);
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
                case "PredictionGainLabel":
                    return "Prediction gain (%)";
                case "PredictionModelLabel":
                    return "Prediction model";
                case "PredictionTargetOffsetLabel":
                    return "Target offset (ms)";
                case "DistilledMlpPostStopBrakeLabel":
                    return "Post-stop brake (experimental)";
                case "MovingOpacityLabel":
                    return "Moving opacity (%)";
                case "FadeDurationLabel":
                    return "Fade duration (ms)";
                case "IdleDelayLabel":
                    return "Idle delay (ms)";
                case "IdleFadeLabel":
                    return "Fade when idle";
                case "IdleOpacityLabel":
                    return "Idle opacity (%)";
                case "IdleFadeDelayLabel":
                    return "Idle fade delay (s)";
                case "VersionMenuLabel":
                    return "Version";
                case "UpdateStatusChecking":
                    return "Update: checking...";
                case "UpdateStatusUnknown":
                    return "Update: unknown";
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
                case "TraceReferencePollSampleCountLabel":
                    return "Reference poll";
                case "TraceRuntimeSchedulerPollSampleCountLabel":
                    return "Runtime scheduler poll";
                case "TraceRuntimeSchedulerLoopSampleCountLabel":
                    return "Runtime scheduler loop";
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
                case "DemoToolTitle":
                    return "Cursor Mirror Demo";
                case "DemoDisplayModeLabel":
                    return "Display mode";
                case "DemoLanguageLabel":
                    return "Language";
                case "DemoLanguageSystem":
                    return "System language";
                case "DemoLanguageEnglish":
                    return "English";
                case "DemoLanguageJapanese":
                    return "Japanese";
                case "DemoSpeedLabel":
                    return "Speed";
                case "DemoMirrorCursorLabel":
                    return "Show mirrored cursor";
                case "DemoStartCommand":
                    return "Start Demo";
                case "DemoWindowPresetVga":
                    return "640 x 480";
                case "DemoWindowPreset720":
                    return "1280 x 720";
                case "DemoWindowPreset1080":
                    return "1920 x 1080";
                case "DemoFullscreenOption":
                    return "Fullscreen";
                case "DemoSpeedSlow":
                    return "Slow";
                case "DemoSpeedNormal":
                    return "Normal";
                case "DemoSpeedFast":
                    return "Fast";
                case "DemoAnyKeyHint":
                    return "Press any key to stop";
                case "DemoEscHint":
                    return "Press any key to stop";
                case "DemoRealCursorNote":
                    return "The demo moves the real Windows cursor.\r\nWhen mirrored cursor is enabled, it shows its own Cursor Mirror overlay.\r\nManual mouse input switches to Free mode; Auto mode resumes after 3 seconds without input.";
                case "DemoMainAppRunningMessage":
                    return "Cursor Mirror is already running. Running it together with the demo overlay may show two mirrored cursors.\r\n\r\nChoose Yes to request Cursor Mirror to exit before starting the demo. Choose No to continue anyway. Choose Cancel to return.";
                case "DemoMainAppShutdownFailedMessage":
                    return "Cursor Mirror could not be closed automatically. Exit Cursor Mirror from its tray icon, then start the demo again.";
                case "DemoAutoModeLabel":
                    return "Auto";
                case "DemoFreeModeLabel":
                    return "Free";
                case "DemoResumeActiveLabel":
                    return "Active";
                case "DemoEnabledLabel":
                    return "On";
                case "DemoDisabledLabel":
                    return "Off";
                case "DemoPhasemoving-right":
                    return "Moving right";
                case "DemoPhasehold-right":
                    return "Hold right";
                case "DemoPhasemoving-left":
                    return "Moving left";
                case "DemoPhasehold-left":
                    return "Hold left";
                case "DemoStatusFormat":
                    return "Mode: {0}\r\nSpeed: {1}\r\nResume: {2}\r\n{3}\r\nInjected moves: {4}";
                case "DemoMirrorCursorStatusFormat":
                    return "Mirrored cursor: {0}";
                case "DemoRelativeCursorXFormat":
                    return "X coordinate: {0}";
                case "DemoResumeCountdownFormat":
                    return "{0:0.0}s";
                case "TraceStateLabelFormat":
                    return "{0}";
                case "TraceDwmTimingSampleCountFormat":
                    return "{0} / {1} ({2:0.0}%)";
                case "VersionMenuFormat":
                    return "Version: {0}";
                case "UpdateStatusUpToDateFormat":
                    return "Update: up to date ({0})";
                case "UpdateStatusBehindFormat":
                    return "Update: {0} release(s) behind ({1})";
                case "UpdateStatusDevelopmentBuildFormat":
                    return "Update: development build; latest {0}";
                case "UpdateStatusAheadOfLatestFormat":
                    return "Update: ahead of latest ({0})";
                case "StartupFailureMessageFormat":
                    return "Cursor Mirror failed to start.\r\n\r\n{0}";
                case "SettingsRestoreFailureMessageFormat":
                    return "Settings could not be restored. Defaults will be used and the settings file will be reset.\r\n\r\nFile: {0}\r\nDetail: {1}";
                case "DemoSettingsRestoreFailureMessageFormat":
                    return "Demo settings could not be restored. Defaults will be used and the demo settings file will be reset.\r\n\r\nFile: {0}\r\nDetail: {1}";
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
                case "PredictionGainLabel":
                    return "予測ゲイン (%)";
                case "PredictionModelLabel":
                    return "予測モデル";
                case "PredictionTargetOffsetLabel":
                    return "ターゲット補正 (ms)";
                case "DistilledMlpPostStopBrakeLabel":
                    return "停止直後ブレーキ（実験）";
                case "MovingOpacityLabel":
                    return "移動中の不透明度 (%)";
                case "FadeDurationLabel":
                    return "フェード時間 (ms)";
                case "IdleDelayLabel":
                    return "待機時間 (ms)";
                case "IdleFadeLabel":
                    return "停止後にフェードする";
                case "IdleOpacityLabel":
                    return "停止後の不透明度 (%)";
                case "IdleFadeDelayLabel":
                    return "停止後フェード待機 (秒)";
                case "VersionMenuLabel":
                    return "バージョン";
                case "UpdateStatusChecking":
                    return "更新: 確認中...";
                case "UpdateStatusUnknown":
                    return "更新: 不明";
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
                case "TraceReferencePollSampleCountLabel":
                    return "高精度参照ポーリング";
                case "TraceRuntimeSchedulerPollSampleCountLabel":
                    return "実行時スケジューラーポーリング";
                case "TraceRuntimeSchedulerLoopSampleCountLabel":
                    return "実行時スケジューラーループ";
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
                case "DemoToolTitle":
                    return "Cursor Mirror デモ";
                case "DemoDisplayModeLabel":
                    return "表示モード";
                case "DemoLanguageLabel":
                    return "表示言語";
                case "DemoLanguageSystem":
                    return "システム設定";
                case "DemoLanguageEnglish":
                    return "English";
                case "DemoLanguageJapanese":
                    return "日本語";
                case "DemoSpeedLabel":
                    return "速度";
                case "DemoMirrorCursorLabel":
                    return "ミラーカーソルを表示する";
                case "DemoStartCommand":
                    return "デモ開始";
                case "DemoWindowPresetVga":
                    return "640 x 480";
                case "DemoWindowPreset720":
                    return "1280 x 720";
                case "DemoWindowPreset1080":
                    return "1920 x 1080";
                case "DemoFullscreenOption":
                    return "フルスクリーン";
                case "DemoSpeedSlow":
                    return "低速";
                case "DemoSpeedNormal":
                    return "標準";
                case "DemoSpeedFast":
                    return "高速";
                case "DemoAnyKeyHint":
                    return "いずれかのキーで停止";
                case "DemoEscHint":
                    return "いずれかのキーで停止";
                case "DemoRealCursorNote":
                    return "デモは実際の Windows カーソルを動かします。\r\nミラーカーソルが有効な場合はオーバーレイも表示します。\r\nマウス操作で Free mode、3 秒間入力がなければ Auto mode に戻ります。";
                case "DemoMainAppRunningMessage":
                    return "Cursor Mirror 本体が起動中です。デモのオーバーレイと同時に使うと、ミラーカーソルが二重に表示される場合があります。\r\n\r\nYes を選ぶと、デモ開始前に Cursor Mirror 本体へ終了を要求します。No を選ぶとそのまま続行します。Cancel を選ぶと戻ります。";
                case "DemoMainAppShutdownFailedMessage":
                    return "Cursor Mirror 本体を自動で終了できませんでした。タスクトレイのアイコンから Cursor Mirror を終了してから、もう一度デモを開始してください。";
                case "DemoAutoModeLabel":
                    return "Auto";
                case "DemoFreeModeLabel":
                    return "Free";
                case "DemoResumeActiveLabel":
                    return "実行中";
                case "DemoEnabledLabel":
                    return "オン";
                case "DemoDisabledLabel":
                    return "オフ";
                case "DemoPhasemoving-right":
                    return "右へ移動";
                case "DemoPhasehold-right":
                    return "右端で停止";
                case "DemoPhasemoving-left":
                    return "左へ移動";
                case "DemoPhasehold-left":
                    return "左端で停止";
                case "DemoStatusFormat":
                    return "モード: {0}\r\n速度: {1}\r\n復帰: {2}\r\n{3}\r\n注入移動: {4}";
                case "DemoMirrorCursorStatusFormat":
                    return "ミラーカーソル: {0}";
                case "DemoRelativeCursorXFormat":
                    return "X座標: {0}";
                case "DemoResumeCountdownFormat":
                    return "{0:0.0}s";
                case "TraceStateLabelFormat":
                    return "{0}";
                case "TraceDwmTimingSampleCountFormat":
                    return "{0} / {1} ({2:0.0}%)";
                case "VersionMenuFormat":
                    return "バージョン: {0}";
                case "UpdateStatusUpToDateFormat":
                    return "更新: 最新です ({0})";
                case "UpdateStatusBehindFormat":
                    return "更新: {0} リリース遅れ ({1})";
                case "UpdateStatusDevelopmentBuildFormat":
                    return "更新: 開発版です。最新 {0}";
                case "UpdateStatusAheadOfLatestFormat":
                    return "更新: 最新より新しいビルドです ({0})";
                case "StartupFailureMessageFormat":
                    return "Cursor Mirror の起動に失敗しました。\r\n\r\n{0}";
                case "SettingsRestoreFailureMessageFormat":
                    return "設定を復元できませんでした。デフォルト設定を使用し、設定ファイルをリセットします。\r\n\r\nファイル: {0}\r\n詳細: {1}";
                case "DemoSettingsRestoreFailureMessageFormat":
                    return "デモ設定を復元できませんでした。デフォルト設定を使用し、デモ設定ファイルをリセットします。\r\n\r\nファイル: {0}\r\n詳細: {1}";
                default:
                    return null;
            }
        }
    }
}
