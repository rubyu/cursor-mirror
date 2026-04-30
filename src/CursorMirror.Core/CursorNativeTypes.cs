using System;
using System.Runtime.InteropServices;

namespace CursorMirror
{
    [StructLayout(LayoutKind.Sequential)]
    public struct NativePoint
    {
        public int x;
        public int y;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct NativeCursorInfo
    {
        public int cbSize;
        public int flags;
        public IntPtr hCursor;
        public NativePoint ptScreenPos;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct NativeIconInfo
    {
        public bool fIcon;
        public int xHotspot;
        public int yHotspot;
        public IntPtr hbmMask;
        public IntPtr hbmColor;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct NativeBitmapInfo
    {
        public int bmType;
        public int bmWidth;
        public int bmHeight;
        public int bmWidthBytes;
        public ushort bmPlanes;
        public ushort bmBitsPixel;
        public IntPtr bmBits;
    }
}
