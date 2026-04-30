using System;
using System.Drawing;

namespace CursorMirror
{
    public interface IOverlayPresenter : IDisposable
    {
        void ShowCursor(Bitmap bitmap, Point location);
        void Move(Point location);
        void SetOpacity(byte alpha);
        void HideOverlay();
    }
}
