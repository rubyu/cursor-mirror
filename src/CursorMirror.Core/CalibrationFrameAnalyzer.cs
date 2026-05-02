using System;

namespace CursorMirror
{
    public static class CalibrationFrameAnalyzer
    {
        public const byte DefaultDarkThreshold = 48;

        public static CalibrationFrameAnalysis AnalyzeBgra(
            int frameIndex,
            long timestampTicks,
            byte[] pixels,
            int width,
            int height,
            int stride,
            byte darkThreshold)
        {
            if (pixels == null)
            {
                throw new ArgumentNullException("pixels");
            }

            if (width <= 0)
            {
                throw new ArgumentOutOfRangeException("width");
            }

            if (height <= 0)
            {
                throw new ArgumentOutOfRangeException("height");
            }

            if (stride < width * 4)
            {
                throw new ArgumentOutOfRangeException("stride");
            }

            int minimumX = width;
            int minimumY = height;
            int maximumX = -1;
            int maximumY = -1;
            int darkPixels = 0;

            for (int y = 0; y < height; y++)
            {
                int row = y * stride;
                for (int x = 0; x < width; x++)
                {
                    int index = row + (x * 4);
                    byte b = pixels[index];
                    byte g = pixels[index + 1];
                    byte r = pixels[index + 2];
                    if (r <= darkThreshold && g <= darkThreshold && b <= darkThreshold)
                    {
                        darkPixels++;
                        if (x < minimumX)
                        {
                            minimumX = x;
                        }

                        if (y < minimumY)
                        {
                            minimumY = y;
                        }

                        if (x > maximumX)
                        {
                            maximumX = x;
                        }

                        if (y > maximumY)
                        {
                            maximumY = y;
                        }
                    }
                }
            }

            if (darkPixels == 0)
            {
                return new CalibrationFrameAnalysis(frameIndex, timestampTicks, width, height, 0, false, 0, 0, 0, 0);
            }

            return new CalibrationFrameAnalysis(
                frameIndex,
                timestampTicks,
                width,
                height,
                darkPixels,
                true,
                minimumX,
                minimumY,
                maximumX - minimumX + 1,
                maximumY - minimumY + 1);
        }
    }
}
