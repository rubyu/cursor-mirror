using System;

namespace CursorMirror.Tests
{
    internal static class TestAssert
    {
        public static void True(bool value, string message)
        {
            if (!value)
            {
                throw new Exception(message);
            }
        }

        public static void False(bool value, string message)
        {
            if (value)
            {
                throw new Exception(message);
            }
        }

        public static void Equal<T>(T expected, T actual, string message)
        {
            if (!object.Equals(expected, actual))
            {
                throw new Exception(message + " Expected: " + expected + " Actual: " + actual);
            }
        }

        public static TException Throws<TException>(Action action, string message)
            where TException : Exception
        {
            try
            {
                action();
            }
            catch (TException ex)
            {
                return ex;
            }
            catch (Exception ex)
            {
                throw new Exception(message + " Unexpected exception: " + ex.GetType().FullName);
            }

            throw new Exception(message + " No exception was thrown.");
        }
    }
}
