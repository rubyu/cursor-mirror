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
                case "StartupFailureMessageFormat":
                    return "Cursor Mirror の起動に失敗しました。\r\n\r\n{0}";
                default:
                    return null;
            }
        }
    }
}
