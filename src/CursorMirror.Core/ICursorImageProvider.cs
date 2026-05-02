namespace CursorMirror
{
    public interface ICursorImageProvider
    {
        bool TryGetCurrentCursorHandle(out System.IntPtr cursorHandle);

        bool TryCapture(out CursorCapture capture);
    }
}
