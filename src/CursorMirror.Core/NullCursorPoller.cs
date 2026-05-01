namespace CursorMirror
{
    internal sealed class NullCursorPoller : ICursorPoller
    {
        public static readonly NullCursorPoller Instance = new NullCursorPoller();

        private NullCursorPoller()
        {
        }

        public bool TryGetSample(out CursorPollSample sample)
        {
            sample = new CursorPollSample();
            return false;
        }
    }
}
