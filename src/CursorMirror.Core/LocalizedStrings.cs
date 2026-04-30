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
                case "StartupFailureMessageFormat":
                    return "Cursor Mirror の起動に失敗しました。\r\n\r\n{0}";
                default:
                    return null;
            }
        }
    }
}
