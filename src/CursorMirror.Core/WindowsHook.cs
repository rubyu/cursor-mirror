using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace CursorMirror
{
    public class WindowsHook : IDisposable
    {
        protected delegate HookResult UserCallback(IntPtr wParam, IntPtr lParam);

        public const int HC_ACTION = 0;

        public enum HookType
        {
            WH_KEYBOARD_LL = 13,
            WH_MOUSE_LL = 14
        }

        private static readonly IntPtr CancelResult = new IntPtr(1);

        private readonly IWindowsHookNativeMethods _nativeMethods;
        private readonly HookType _hookType;
        private readonly UserCallback _userCallback;
        private readonly NativeHookCallback _systemCallback;
        private IntPtr _hookHandle;
        private bool _disposed;

        protected WindowsHook(HookType hookType, UserCallback userCallback)
            : this(hookType, userCallback, new WindowsHookNativeMethods())
        {
        }

        protected WindowsHook(HookType hookType, UserCallback userCallback, IWindowsHookNativeMethods nativeMethods)
        {
            if (userCallback == null)
            {
                throw new ArgumentNullException("userCallback");
            }

            if (nativeMethods == null)
            {
                throw new ArgumentNullException("nativeMethods");
            }

            _hookType = hookType;
            _userCallback = userCallback;
            _nativeMethods = nativeMethods;
            _systemCallback = Callback;
            _hookHandle = IntPtr.Zero;
        }

        public bool IsActivated
        {
            get { return _hookHandle != IntPtr.Zero; }
        }

        public void SetHook()
        {
            ThrowIfDisposed();

            if (IsActivated)
            {
                throw new InvalidOperationException("The hook is already active.");
            }

            IntPtr moduleHandle = IntPtr.Zero;
            Process currentProcess = Process.GetCurrentProcess();
            ProcessModule mainModule = currentProcess.MainModule;
            if (mainModule != null)
            {
                moduleHandle = _nativeMethods.GetModuleHandle(mainModule.ModuleName);
            }

            _hookHandle = _nativeMethods.SetWindowsHookEx((int)_hookType, _systemCallback, moduleHandle, 0);
            if (_hookHandle == IntPtr.Zero)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "SetWindowsHookEx failed.");
            }
        }

        public void Unhook()
        {
            ThrowIfDisposed();

            if (!IsActivated)
            {
                throw new InvalidOperationException("The hook is not active.");
            }

            IntPtr handle = _hookHandle;
            if (!_nativeMethods.UnhookWindowsHookEx(handle))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "UnhookWindowsHookEx failed.");
            }

            _hookHandle = IntPtr.Zero;
        }

        private IntPtr Callback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= HC_ACTION)
            {
                HookResult result;
                try
                {
                    result = _userCallback(wParam, lParam);
                }
                catch
                {
                    result = HookResult.Transfer;
                }

                if (result == HookResult.Cancel)
                {
                    return CancelResult;
                }

                if (result == HookResult.Determine)
                {
                    return IntPtr.Zero;
                }
            }

            return _nativeMethods.CallNextHookEx(_hookHandle, nCode, wParam, lParam);
        }

        public void Dispose()
        {
            Dispose(true);
            GC.SuppressFinalize(this);
        }

        protected virtual void Dispose(bool disposing)
        {
            if (!_disposed)
            {
                if (disposing && IsActivated)
                {
                    try
                    {
                        Unhook();
                    }
                    catch (Win32Exception)
                    {
                        _hookHandle = IntPtr.Zero;
                    }
                }

                _disposed = true;
            }
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
