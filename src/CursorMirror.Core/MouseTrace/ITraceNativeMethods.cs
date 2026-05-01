namespace CursorMirror.MouseTrace
{
    public interface ITraceNativeMethods
    {
        bool GetCursorPos(out NativePoint point);
        bool TryGetDwmTimingInfo(out DwmTimingInfo timingInfo);
        bool TryBeginTimerResolution(int milliseconds);
        void EndTimerResolution(int milliseconds);
    }
}
