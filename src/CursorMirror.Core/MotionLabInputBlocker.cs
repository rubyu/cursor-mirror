using System;

namespace CursorMirror
{
    public sealed class MotionLabInputBlocker : IDisposable
    {
        private readonly IntPtr _allowedExtraInfo;
        private readonly IWindowsHookNativeMethods _nativeMethods;
        private LowLevelMouseHook _hook;
        private bool _disposed;

        public MotionLabInputBlocker(IntPtr allowedExtraInfo)
            : this(allowedExtraInfo, new WindowsHookNativeMethods())
        {
        }

        public MotionLabInputBlocker(IntPtr allowedExtraInfo, IWindowsHookNativeMethods nativeMethods)
        {
            if (nativeMethods == null)
            {
                throw new ArgumentNullException("nativeMethods");
            }

            _allowedExtraInfo = allowedExtraInfo;
            _nativeMethods = nativeMethods;
        }

        public bool IsActive
        {
            get { return _hook != null && _hook.IsActivated; }
        }

        public void Start()
        {
            ThrowIfDisposed();
            if (IsActive)
            {
                return;
            }

            _hook = new LowLevelMouseHook(HandleMouseEvent, _nativeMethods);
            _hook.SetHook();
        }

        public void Stop()
        {
            LowLevelMouseHook hook = _hook;
            _hook = null;
            if (hook == null)
            {
                return;
            }

            hook.Dispose();
        }

        public void Dispose()
        {
            if (!_disposed)
            {
                Stop();
                _disposed = true;
            }
        }

        private HookResult HandleMouseEvent(LowLevelMouseHook.MouseEvent mouseEvent, LowLevelMouseHook.MSLLHOOKSTRUCT data)
        {
            return data.dwExtraInfo == _allowedExtraInfo ? HookResult.Transfer : HookResult.Cancel;
        }

        private void ThrowIfDisposed()
        {
            if (_disposed)
            {
                throw new ObjectDisposedException(GetType().Name);
            }
        }
    }
}
