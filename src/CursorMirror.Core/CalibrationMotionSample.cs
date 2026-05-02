namespace CursorMirror
{
    public sealed class CalibrationMotionSample
    {
        public CalibrationMotionSample(
            double elapsedMilliseconds,
            string patternName,
            string phaseName,
            int expectedX,
            int expectedY,
            double velocityPixelsPerSecond)
        {
            ElapsedMilliseconds = elapsedMilliseconds;
            PatternName = patternName ?? string.Empty;
            PhaseName = phaseName ?? string.Empty;
            ExpectedX = expectedX;
            ExpectedY = expectedY;
            VelocityPixelsPerSecond = velocityPixelsPerSecond;
        }

        public double ElapsedMilliseconds { get; private set; }
        public string PatternName { get; private set; }
        public string PhaseName { get; private set; }
        public int ExpectedX { get; private set; }
        public int ExpectedY { get; private set; }
        public double VelocityPixelsPerSecond { get; private set; }
    }
}
