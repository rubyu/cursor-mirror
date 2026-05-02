namespace CursorMirror
{
    public static class CalibrationRuntimeMode
    {
        public const int ProductRuntime = 0;
        public const int SimpleTimer = 1;
        public const int Default = ProductRuntime;

        public static int Normalize(int runtimeMode)
        {
            if (runtimeMode == SimpleTimer)
            {
                return SimpleTimer;
            }

            return ProductRuntime;
        }

        public static bool TryParse(string value, out int runtimeMode)
        {
            string normalized = (value ?? string.Empty).Trim().ToLowerInvariant();
            if (normalized == "product" ||
                normalized == "productruntime" ||
                normalized == "product-runtime" ||
                normalized == "product_runtime")
            {
                runtimeMode = ProductRuntime;
                return true;
            }

            if (normalized == "simple" ||
                normalized == "simpletimer" ||
                normalized == "simple-timer" ||
                normalized == "simple_timer")
            {
                runtimeMode = SimpleTimer;
                return true;
            }

            if (int.TryParse(value, out runtimeMode))
            {
                runtimeMode = Normalize(runtimeMode);
                return true;
            }

            runtimeMode = Default;
            return false;
        }

        public static string ToExternalName(int runtimeMode)
        {
            return Normalize(runtimeMode) == SimpleTimer ? "SimpleTimer" : "ProductRuntime";
        }

        public static string ToDisplayText(int runtimeMode)
        {
            return Normalize(runtimeMode) == SimpleTimer ? "Simple timer" : "Product runtime (default)";
        }
    }
}
