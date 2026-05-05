namespace CursorMirror
{
    public interface ICalibrationMotionSource
    {
        string SourceName { get; }
        string GenerationProfile { get; }
        int ScenarioCount { get; }
        double TotalDurationMilliseconds { get; }
        CalibrationMotionSample GetSample(double elapsedMilliseconds);
    }
}
