using System;
using System.Drawing;

namespace CursorMirror
{
    public sealed class CursorCapture : IDisposable
    {
        private bool _disposed;

        public CursorCapture(IntPtr cursorHandle, Bitmap bitmap, Point hotSpot)
        {
            if (bitmap == null)
            {
                throw new ArgumentNullException("bitmap");
            }

            CursorHandle = cursorHandle;
            Bitmap = bitmap;
            HotSpot = hotSpot;
        }

        public IntPtr CursorHandle { get; private set; }
        public Bitmap Bitmap { get; private set; }
        public Point HotSpot { get; private set; }

        public void Dispose()
        {
            if (!_disposed)
            {
                if (Bitmap != null)
                {
                    Bitmap.Dispose();
                    Bitmap = null;
                }

                _disposed = true;
            }
        }
    }
}
