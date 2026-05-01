namespace CursorMirror
{
    public interface ICursorPoller
    {
        bool TryGetSample(out CursorPollSample sample);
    }
}
