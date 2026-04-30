using System;

namespace CursorMirror
{
    public sealed class ImmediateDispatcher : IUiDispatcher
    {
        public bool InvokeRequired
        {
            get { return false; }
        }

        public void BeginInvoke(Action action)
        {
            if (action == null)
            {
                throw new ArgumentNullException("action");
            }

            action();
        }
    }
}
