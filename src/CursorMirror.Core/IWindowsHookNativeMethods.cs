using System;

namespace CursorMirror
{
    public interface IWindowsHookNativeMethods
    {
        IntPtr SetWindowsHookEx(int idHook, NativeHookCallback callback, IntPtr hInstance, int threadId);
        bool UnhookWindowsHookEx(IntPtr hook);
        IntPtr CallNextHookEx(IntPtr hook, int nCode, IntPtr wParam, IntPtr lParam);
        IntPtr GetModuleHandle(string name);
    }
}
