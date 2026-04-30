using System;
using System.Runtime.InteropServices;

namespace CursorMirror
{
    public sealed class WindowsHookNativeMethods : IWindowsHookNativeMethods
    {
        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, NativeHookCallback callback, IntPtr hInstance, int threadId);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool UnhookWindowsHookEx(IntPtr hook);

        [DllImport("user32.dll")]
        private static extern IntPtr CallNextHookEx(IntPtr hook, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr GetModuleHandle(string name);

        IntPtr IWindowsHookNativeMethods.SetWindowsHookEx(int idHook, NativeHookCallback callback, IntPtr hInstance, int threadId)
        {
            return SetWindowsHookEx(idHook, callback, hInstance, threadId);
        }

        bool IWindowsHookNativeMethods.UnhookWindowsHookEx(IntPtr hook)
        {
            return UnhookWindowsHookEx(hook);
        }

        IntPtr IWindowsHookNativeMethods.CallNextHookEx(IntPtr hook, int nCode, IntPtr wParam, IntPtr lParam)
        {
            return CallNextHookEx(hook, nCode, wParam, lParam);
        }

        IntPtr IWindowsHookNativeMethods.GetModuleHandle(string name)
        {
            return GetModuleHandle(name);
        }
    }
}
