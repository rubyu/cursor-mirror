using System;
using System.Security.Cryptography;

namespace CursorMirror.MotionLab
{
    public sealed class MotionLabRandom
    {
        private const ulong PcgMultiplier = 6364136223846793005UL;
        private const ulong SplitMixIncrement = 0x9E3779B97F4A7C15UL;

        private ulong _state;
        private readonly ulong _increment;

        public MotionLabRandom(ulong seed)
        {
            ulong stream = SplitMix64(seed ^ 0xD1B54A32D192ED03UL);
            _increment = (stream << 1) | 1UL;
            _state = 0;
            NextUInt32();
            _state += SplitMix64(seed);
            NextUInt32();
        }

        public uint NextUInt32()
        {
            ulong oldState = _state;
            _state = (oldState * PcgMultiplier) + _increment;
            uint xorshifted = (uint)(((oldState >> 18) ^ oldState) >> 27);
            int rotation = (int)(oldState >> 59);
            return (xorshifted >> rotation) | (xorshifted << ((-rotation) & 31));
        }

        public double NextDouble()
        {
            double high = NextUInt32() >> 5;
            double low = NextUInt32() >> 6;
            return ((high * 67108864.0) + low) / 9007199254740992.0;
        }

        public int NextInt(int exclusiveMaximum)
        {
            if (exclusiveMaximum <= 0)
            {
                throw new ArgumentOutOfRangeException("exclusiveMaximum");
            }

            return (int)(NextDouble() * exclusiveMaximum);
        }

        public static ulong DeriveScenarioSeed(int seed, int scenarioIndex)
        {
            ulong value = ((ulong)(uint)seed << 32) ^ (uint)scenarioIndex;
            return SplitMix64(value ^ 0xA0761D6478BD642FUL);
        }

        public static int CreateSeed()
        {
            byte[] bytes = new byte[4];
            using (RandomNumberGenerator generator = RandomNumberGenerator.Create())
            {
                generator.GetBytes(bytes);
            }

            return (int)(BitConverter.ToUInt32(bytes, 0) & 0x7FFFFFFF);
        }

        private static ulong SplitMix64(ulong value)
        {
            value += SplitMixIncrement;
            value = (value ^ (value >> 30)) * 0xBF58476D1CE4E5B9UL;
            value = (value ^ (value >> 27)) * 0x94D049BB133111EBUL;
            return value ^ (value >> 31);
        }
    }
}
