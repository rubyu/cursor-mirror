namespace CursorMirror
{
    public sealed class CalibrationFrameAnalysis
    {
        public CalibrationFrameAnalysis(
            int frameIndex,
            long timestampTicks,
            int width,
            int height,
            int darkPixelCount,
            bool hasDarkPixels,
            int darkBoundsX,
            int darkBoundsY,
            int darkBoundsWidth,
            int darkBoundsHeight)
            : this(
                frameIndex,
                timestampTicks,
                width,
                height,
                darkPixelCount,
                hasDarkPixels,
                darkBoundsX,
                darkBoundsY,
                darkBoundsWidth,
                darkBoundsHeight,
                0,
                string.Empty,
                string.Empty,
                0,
                0,
                0)
        {
        }

        public CalibrationFrameAnalysis(
            int frameIndex,
            long timestampTicks,
            int width,
            int height,
            int darkPixelCount,
            bool hasDarkPixels,
            int darkBoundsX,
            int darkBoundsY,
            int darkBoundsWidth,
            int darkBoundsHeight,
            double elapsedMilliseconds,
            string patternName,
            string phaseName,
            int expectedX,
            int expectedY,
            double expectedVelocityPixelsPerSecond)
        {
            FrameIndex = frameIndex;
            TimestampTicks = timestampTicks;
            Width = width;
            Height = height;
            DarkPixelCount = darkPixelCount;
            HasDarkPixels = hasDarkPixels;
            DarkBoundsX = darkBoundsX;
            DarkBoundsY = darkBoundsY;
            DarkBoundsWidth = darkBoundsWidth;
            DarkBoundsHeight = darkBoundsHeight;
            ElapsedMilliseconds = elapsedMilliseconds;
            PatternName = patternName ?? string.Empty;
            PhaseName = phaseName ?? string.Empty;
            ExpectedX = expectedX;
            ExpectedY = expectedY;
            ExpectedVelocityPixelsPerSecond = expectedVelocityPixelsPerSecond;
        }

        public int FrameIndex { get; private set; }
        public long TimestampTicks { get; private set; }
        public int Width { get; private set; }
        public int Height { get; private set; }
        public int DarkPixelCount { get; private set; }
        public bool HasDarkPixels { get; private set; }
        public int DarkBoundsX { get; private set; }
        public int DarkBoundsY { get; private set; }
        public int DarkBoundsWidth { get; private set; }
        public int DarkBoundsHeight { get; private set; }
        public double ElapsedMilliseconds { get; private set; }
        public string PatternName { get; private set; }
        public string PhaseName { get; private set; }
        public int ExpectedX { get; private set; }
        public int ExpectedY { get; private set; }
        public double ExpectedVelocityPixelsPerSecond { get; private set; }

        public CalibrationFrameAnalysis WithMotion(CalibrationMotionSample sample)
        {
            if (sample == null)
            {
                return this;
            }

            return new CalibrationFrameAnalysis(
                FrameIndex,
                TimestampTicks,
                Width,
                Height,
                DarkPixelCount,
                HasDarkPixels,
                DarkBoundsX,
                DarkBoundsY,
                DarkBoundsWidth,
                DarkBoundsHeight,
                sample.ElapsedMilliseconds,
                sample.PatternName,
                sample.PhaseName,
                sample.ExpectedX,
                sample.ExpectedY,
                sample.VelocityPixelsPerSecond);
        }
    }
}
