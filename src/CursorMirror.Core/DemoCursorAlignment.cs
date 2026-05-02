using System;
using System.Drawing;

namespace CursorMirror
{
    public static class DemoCursorAlignment
    {
        public static Point StartPoint(Rectangle movementBounds)
        {
            return new Point(movementBounds.Left, StartY(movementBounds));
        }

        public static int RelativeXFromStart(Point cursorPosition, Rectangle movementBounds)
        {
            return cursorPosition.X - movementBounds.Left;
        }

        private static int StartY(Rectangle movementBounds)
        {
            return (int)Math.Round(movementBounds.Top + (movementBounds.Height / 2.0));
        }
    }
}
