using System.Threading;

namespace CursorMirror
{
    public static class CursorMirrorRuntimeSignals
    {
        public const string MainShutdownEventName = @"Local\CursorMirror.Main.Shutdown";

        public static EventWaitHandle CreateMainShutdownEvent()
        {
            bool createdNew;
            return new EventWaitHandle(false, EventResetMode.AutoReset, MainShutdownEventName, out createdNew);
        }

        public static bool IsMainShutdownEventAvailable()
        {
            EventWaitHandle handle;
            if (!TryOpenMainShutdownEvent(out handle))
            {
                return false;
            }

            handle.Dispose();
            return true;
        }

        public static bool TryRequestMainShutdown()
        {
            EventWaitHandle handle;
            if (!TryOpenMainShutdownEvent(out handle))
            {
                return false;
            }

            using (handle)
            {
                return handle.Set();
            }
        }

        private static bool TryOpenMainShutdownEvent(out EventWaitHandle handle)
        {
            try
            {
                handle = EventWaitHandle.OpenExisting(MainShutdownEventName);
                return true;
            }
            catch (WaitHandleCannotBeOpenedException)
            {
                handle = null;
                return false;
            }
        }
    }
}
