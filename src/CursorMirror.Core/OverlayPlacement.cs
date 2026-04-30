using System.Drawing;

namespace CursorMirror
{
    public static class OverlayPlacement
    {
        public static Point FromPointerAndHotSpot(Point pointer, Point hotSpot)
        {
            return new Point(pointer.X - hotSpot.X, pointer.Y - hotSpot.Y);
        }
    }
}
