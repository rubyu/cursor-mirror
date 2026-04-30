using System;
using System.Runtime.InteropServices;

namespace CursorMirror
{
    public sealed class CursorNativeMethods : ICursorNativeMethods
    {
        [DllImport("user32.dll", EntryPoint = "GetCursorInfo", SetLastError = true)]
        private static extern bool GetCursorInfoNative(ref NativeCursorInfo pci);

        [DllImport("user32.dll", EntryPoint = "CopyIcon", SetLastError = true)]
        private static extern IntPtr CopyIconNative(IntPtr hIcon);

        [DllImport("user32.dll", EntryPoint = "GetIconInfo", SetLastError = true)]
        private static extern bool GetIconInfoNative(IntPtr hIcon, out NativeIconInfo piconinfo);

        [DllImport("user32.dll", EntryPoint = "DrawIconEx", SetLastError = true)]
        private static extern bool DrawIconExNative(IntPtr hdc, int xLeft, int yTop, IntPtr hIcon, int cxWidth, int cyWidth, int istepIfAniCur, IntPtr hbrFlickerFreeDraw, int diFlags);

        [DllImport("user32.dll", EntryPoint = "DestroyIcon", SetLastError = true)]
        private static extern bool DestroyIconNative(IntPtr hIcon);

        [DllImport("gdi32.dll", EntryPoint = "DeleteObject", SetLastError = true)]
        private static extern bool DeleteObjectNative(IntPtr hObject);

        [DllImport("gdi32.dll", EntryPoint = "GetObject", SetLastError = true)]
        private static extern int GetObjectNative(IntPtr hgdiobj, int cbBuffer, out NativeBitmapInfo lpvObject);

        public bool GetCursorInfo(ref NativeCursorInfo cursorInfo)
        {
            return GetCursorInfoNative(ref cursorInfo);
        }

        public IntPtr CopyIcon(IntPtr iconHandle)
        {
            return CopyIconNative(iconHandle);
        }

        public bool GetIconInfo(IntPtr iconHandle, out NativeIconInfo iconInfo)
        {
            return GetIconInfoNative(iconHandle, out iconInfo);
        }

        public bool DrawIconEx(IntPtr hdc, int xLeft, int yTop, IntPtr iconHandle, int width, int height, int stepIfAniCur, IntPtr flickerFreeBrush, int flags)
        {
            return DrawIconExNative(hdc, xLeft, yTop, iconHandle, width, height, stepIfAniCur, flickerFreeBrush, flags);
        }

        public bool DestroyIcon(IntPtr iconHandle)
        {
            return DestroyIconNative(iconHandle);
        }

        public bool DeleteObject(IntPtr objectHandle)
        {
            return DeleteObjectNative(objectHandle);
        }

        public int GetObject(IntPtr objectHandle, int bufferSize, out NativeBitmapInfo bitmapInfo)
        {
            return GetObjectNative(objectHandle, bufferSize, out bitmapInfo);
        }
    }
}
