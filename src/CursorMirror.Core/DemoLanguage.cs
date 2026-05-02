using System.Globalization;
using System.Threading;

namespace CursorMirror
{
    public static class DemoLanguage
    {
        public const string Auto = "auto";
        public const string English = "en";
        public const string Japanese = "ja";

        private static readonly CultureInfo InitialCulture = Thread.CurrentThread.CurrentCulture;
        private static readonly CultureInfo InitialUiCulture = Thread.CurrentThread.CurrentUICulture;

        public static string Normalize(string language)
        {
            if (string.IsNullOrWhiteSpace(language))
            {
                return Auto;
            }

            string value = language.Trim().ToLowerInvariant();
            if (value == English || value == "en-us")
            {
                return English;
            }

            if (value == Japanese || value == "ja-jp")
            {
                return Japanese;
            }

            return Auto;
        }

        public static void Apply(string language)
        {
            string normalized = Normalize(language);
            if (normalized == English)
            {
                ApplyCulture(CultureInfo.GetCultureInfo("en-US"));
                return;
            }

            if (normalized == Japanese)
            {
                ApplyCulture(CultureInfo.GetCultureInfo("ja-JP"));
                return;
            }

            Thread.CurrentThread.CurrentCulture = InitialCulture;
            Thread.CurrentThread.CurrentUICulture = InitialUiCulture;
        }

        private static void ApplyCulture(CultureInfo culture)
        {
            Thread.CurrentThread.CurrentCulture = culture;
            Thread.CurrentThread.CurrentUICulture = culture;
        }
    }
}
