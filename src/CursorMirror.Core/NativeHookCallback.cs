using System;

namespace CursorMirror
{
    public delegate IntPtr NativeHookCallback(int nCode, IntPtr wParam, IntPtr lParam);
}
