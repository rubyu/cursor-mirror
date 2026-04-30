using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace CursorMirror
{
    public sealed class CursorImageProvider : ICursorImageProvider
    {
        private const int CURSOR_SHOWING = 0x00000001;
        private const int DI_NORMAL = 0x0003;
        private readonly ICursorNativeMethods _nativeMethods;

        public CursorImageProvider()
            : this(new CursorNativeMethods())
        {
        }

        public CursorImageProvider(ICursorNativeMethods nativeMethods)
        {
            if (nativeMethods == null)
            {
                throw new ArgumentNullException("nativeMethods");
            }

            _nativeMethods = nativeMethods;
        }

        public bool TryCapture(out CursorCapture capture)
        {
            capture = null;

            NativeCursorInfo cursorInfo = new NativeCursorInfo();
            cursorInfo.cbSize = Marshal.SizeOf(typeof(NativeCursorInfo));
            if (!_nativeMethods.GetCursorInfo(ref cursorInfo))
            {
                return false;
            }

            if ((cursorInfo.flags & CURSOR_SHOWING) == 0 || cursorInfo.hCursor == IntPtr.Zero)
            {
                return false;
            }

            IntPtr copiedIcon = _nativeMethods.CopyIcon(cursorInfo.hCursor);
            if (copiedIcon == IntPtr.Zero)
            {
                return false;
            }

            NativeIconInfo iconInfo = new NativeIconInfo();
            Bitmap bitmap = null;

            try
            {
                if (!_nativeMethods.GetIconInfo(copiedIcon, out iconInfo))
                {
                    return false;
                }

                Size size = GetIconSize(iconInfo);
                if (size.Width <= 0 || size.Height <= 0)
                {
                    return false;
                }

                bitmap = new Bitmap(size.Width, size.Height, PixelFormat.Format32bppArgb);
                using (Graphics graphics = Graphics.FromImage(bitmap))
                {
                    graphics.Clear(Color.Transparent);
                    IntPtr hdc = graphics.GetHdc();
                    try
                    {
                        if (!_nativeMethods.DrawIconEx(hdc, 0, 0, copiedIcon, size.Width, size.Height, 0, IntPtr.Zero, DI_NORMAL))
                        {
                            bitmap.Dispose();
                            bitmap = null;
                            return false;
                        }
                    }
                    finally
                    {
                        graphics.ReleaseHdc(hdc);
                    }
                }

                capture = new CursorCapture(cursorInfo.hCursor, bitmap, new Point(iconInfo.xHotspot, iconInfo.yHotspot));
                bitmap = null;
                return true;
            }
            finally
            {
                if (bitmap != null)
                {
                    bitmap.Dispose();
                }

                if (iconInfo.hbmColor != IntPtr.Zero)
                {
                    _nativeMethods.DeleteObject(iconInfo.hbmColor);
                }

                if (iconInfo.hbmMask != IntPtr.Zero)
                {
                    _nativeMethods.DeleteObject(iconInfo.hbmMask);
                }

                _nativeMethods.DestroyIcon(copiedIcon);
            }
        }

        private Size GetIconSize(NativeIconInfo iconInfo)
        {
            NativeBitmapInfo bitmapInfo;
            IntPtr sizeSource = iconInfo.hbmColor != IntPtr.Zero ? iconInfo.hbmColor : iconInfo.hbmMask;
            if (sizeSource == IntPtr.Zero)
            {
                return Size.Empty;
            }

            int bytes = _nativeMethods.GetObject(sizeSource, Marshal.SizeOf(typeof(NativeBitmapInfo)), out bitmapInfo);
            if (bytes == 0)
            {
                return Size.Empty;
            }

            int height = bitmapInfo.bmHeight;
            if (iconInfo.hbmColor == IntPtr.Zero)
            {
                height = height / 2;
            }

            return new Size(bitmapInfo.bmWidth, height);
        }
    }
}
