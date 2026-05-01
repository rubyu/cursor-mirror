namespace CursorMirror.MouseTrace
{
    public interface ITraceNativeMethods
    {
        bool GetCursorPos(out NativePoint point);
        bool TryGetDwmTimingInfo(out DwmTimingInfo timingInfo);
    }
}
