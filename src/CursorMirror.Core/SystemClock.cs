using System;

namespace CursorMirror
{
    public sealed class SystemClock : IClock
    {
        public long Milliseconds
        {
            get { return Environment.TickCount; }
        }
    }
}
