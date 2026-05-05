using System;

namespace CursorMirror
{
    public sealed class IntSettingRange
    {
        public IntSettingRange(int minimum, int maximum)
        {
            if (maximum < minimum)
            {
                throw new ArgumentOutOfRangeException("maximum");
            }

            Minimum = minimum;
            Maximum = maximum;
        }

        public int Minimum { get; private set; }

        public int Maximum { get; private set; }

        public int Clamp(int value)
        {
            return Math.Max(Minimum, Math.Min(Maximum, value));
        }
    }
}
