using System;

namespace CursorMirror
{
    public interface IUiDispatcher
    {
        bool InvokeRequired { get; }
        void BeginInvoke(Action action);
    }
}
