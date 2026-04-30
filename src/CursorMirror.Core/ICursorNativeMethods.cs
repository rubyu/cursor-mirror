using System;

namespace CursorMirror
{
    public interface ICursorNativeMethods
    {
        bool GetCursorInfo(ref NativeCursorInfo cursorInfo);
        IntPtr CopyIcon(IntPtr iconHandle);
        bool GetIconInfo(IntPtr iconHandle, out NativeIconInfo iconInfo);
        bool DrawIconEx(IntPtr hdc, int xLeft, int yTop, IntPtr iconHandle, int width, int height, int stepIfAniCur, IntPtr flickerFreeBrush, int flags);
        bool DestroyIcon(IntPtr iconHandle);
        bool DeleteObject(IntPtr objectHandle);
        int GetObject(IntPtr objectHandle, int bufferSize, out NativeBitmapInfo bitmapInfo);
    }
}
