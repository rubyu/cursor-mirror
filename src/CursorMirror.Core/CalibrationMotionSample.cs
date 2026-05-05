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
            : this(
                elapsedMilliseconds,
                patternName,
                phaseName,
                expectedX,
                expectedY,
                velocityPixelsPerSecond,
                string.Empty,
                string.Empty,
                -1,
                elapsedMilliseconds,
                0,
                -1,
                elapsedMilliseconds)
        {
        }

        public CalibrationMotionSample(
            double elapsedMilliseconds,
            string patternName,
            string phaseName,
            int expectedX,
            int expectedY,
            double velocityPixelsPerSecond,
            string motionSourceName,
            string generationProfile,
            int scenarioIndex,
            double scenarioElapsedMilliseconds,
            double progress,
            int holdIndex,
            double phaseElapsedMilliseconds)
        {
            ElapsedMilliseconds = elapsedMilliseconds;
            PatternName = patternName ?? string.Empty;
            PhaseName = phaseName ?? string.Empty;
            ExpectedX = expectedX;
            ExpectedY = expectedY;
            VelocityPixelsPerSecond = velocityPixelsPerSecond;
            MotionSourceName = motionSourceName ?? string.Empty;
            GenerationProfile = generationProfile ?? string.Empty;
            ScenarioIndex = scenarioIndex;
            ScenarioElapsedMilliseconds = scenarioElapsedMilliseconds;
            Progress = progress;
            HoldIndex = holdIndex;
            PhaseElapsedMilliseconds = phaseElapsedMilliseconds;
        }

        public double ElapsedMilliseconds { get; private set; }
        public string PatternName { get; private set; }
        public string PhaseName { get; private set; }
        public int ExpectedX { get; private set; }
        public int ExpectedY { get; private set; }
        public double VelocityPixelsPerSecond { get; private set; }
        public string MotionSourceName { get; private set; }
        public string GenerationProfile { get; private set; }
        public int ScenarioIndex { get; private set; }
        public double ScenarioElapsedMilliseconds { get; private set; }
        public double Progress { get; private set; }
        public int HoldIndex { get; private set; }
        public double PhaseElapsedMilliseconds { get; private set; }
    }
}
