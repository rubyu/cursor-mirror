using System;
using System.Runtime.InteropServices;

namespace CursorMirror
{
    public sealed class HighResolutionWaitTimer : IDisposable
    {
        private const uint CreateWaitableTimerHighResolution = 0x00000002;
        private const uint TimerModifyState = 0x0002;
        private const uint Synchronize = 0x00100000;
        private const uint WaitObject0 = 0x00000000;
        private const uint WaitInfinite = 0xFFFFFFFF;
        private readonly IntPtr _handle;
        private readonly string _waitMethod;
        private bool _disposed;

        private HighResolutionWaitTimer(IntPtr handle, string waitMethod)
        {
            _handle = handle;
            _waitMethod = waitMethod;
        }

        public string WaitMethod
        {
            get { return _waitMethod; }
        }

        public IntPtr Handle
        {
            get { return _handle; }
        }

        public static HighResolutionWaitTimer CreateBestEffort()
        {
            IntPtr handle = TryCreate(CreateWaitableTimerHighResolution);
            if (handle != IntPtr.Zero)
            {
                return new HighResolutionWaitTimer(handle, "highResolutionWaitableTimer");
            }

            handle = TryCreate(0);
            if (handle != IntPtr.Zero)
            {
                return new HighResolutionWaitTimer(handle, "waitableTimer");
            }

            return null;
        }

        public bool Wait(int milliseconds)
        {
            ThrowIfDisposed();
            if (milliseconds <= 0)
            {
                return true;
            }

            long dueTime = -MillisecondsToHundredNanoseconds(milliseconds);
            return WaitHundredNanoseconds(dueTime);
        }

        public bool WaitTicks(long ticks, long stopwatchFrequency)
        {
            ThrowIfDisposed();
            if (ticks <= 0)
            {
                return true;
            }

            if (!SetTicks(ticks, stopwatchFrequency))
            {
                return false;
            }

            return WaitForSingleObjectNative(_handle, WaitInfinite) == WaitObject0;
        }

        public bool SetTicks(long ticks, long stopwatchFrequency)
        {
            ThrowIfDisposed();
            if (ticks <= 0)
            {
                return true;
            }

            long dueTime = -TicksToHundredNanoseconds(ticks, stopwatchFrequency);
            return SetRelativeHundredNanoseconds(dueTime);
        }

        private bool WaitHundredNanoseconds(long dueTime)
        {
            if (dueTime == 0)
            {
                return true;
            }

            if (!SetRelativeHundredNanoseconds(dueTime))
            {
                return false;
            }

            return WaitForSingleObjectNative(_handle, WaitInfinite) == WaitObject0;
        }

        private bool SetRelativeHundredNanoseconds(long dueTime)
        {
            if (dueTime == 0)
            {
                return true;
            }

            return SetWaitableTimerNative(_handle, ref dueTime, 0, IntPtr.Zero, IntPtr.Zero, false);
        }

        public void Dispose()
        {
            if (!_disposed)
            {
                CloseHandleNative(_handle);
                _disposed = true;
            }
        }

        private static IntPtr TryCreate(uint flags)
        {
            try
            {
                return CreateWaitableTimerExNative(
                    IntPtr.Zero,
                    null,
                    flags,
                    Synchronize | TimerModifyState);
            }
            catch (EntryPointNotFoundException)
            {
                return IntPtr.Zero;
            }
            catch (DllNotFoundException)
            {
                return IntPtr.Zero;
            }
        }

        private static long MillisecondsToHundredNanoseconds(int milliseconds)
        {
            if (milliseconds <= 0)
            {
                return 0;
            }

            if ((long)milliseconds > long.MaxValue / 10000L)
            {
                return long.MaxValue;
            }

            return milliseconds * 10000L;
        }

        private static long TicksToHundredNanoseconds(long ticks, long stopwatchFrequency)
        {
            if (ticks <= 0 || stopwatchFrequency <= 0)
            {
                return 0;
            }

            double hundredNanoseconds = ticks * 10000000.0 / stopwatchFrequency;
            if (hundredNanoseconds >= long.MaxValue)
            {
                return long.MaxValue;
            }

            long result = (long)Math.Ceiling(hundredNanoseconds);
            if (result < 1)
            {
                return 1;
            }

            return result;
        }

        private void ThrowIfDisposed()
        {
            if (_disposed)
            {
                throw new ObjectDisposedException(GetType().Name);
            }
        }

        [DllImport("kernel32.dll", EntryPoint = "CreateWaitableTimerExW", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateWaitableTimerExNative(IntPtr timerAttributes, string timerName, uint flags, uint desiredAccess);

        [DllImport("kernel32.dll", EntryPoint = "SetWaitableTimer", SetLastError = true)]
        private static extern bool SetWaitableTimerNative(IntPtr timer, ref long dueTime, int period, IntPtr completionRoutine, IntPtr argToCompletionRoutine, bool resume);

        [DllImport("kernel32.dll", EntryPoint = "WaitForSingleObject", SetLastError = true)]
        private static extern uint WaitForSingleObjectNative(IntPtr handle, uint milliseconds);

        [DllImport("kernel32.dll", EntryPoint = "CloseHandle", SetLastError = true)]
        private static extern bool CloseHandleNative(IntPtr handle);
    }
}
