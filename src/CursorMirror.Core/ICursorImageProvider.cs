namespace CursorMirror
{
    public interface ICursorImageProvider
    {
        bool TryCapture(out CursorCapture capture);
    }
}
