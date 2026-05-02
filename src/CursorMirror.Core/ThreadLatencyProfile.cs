using System;
using System.Runtime.InteropServices;
using System.Security;
using System.Threading;

namespace CursorMirror
{
    public sealed class ThreadLatencyProfile : IDisposable
    {
        public const string DefaultMmcssTaskName = "Games";
        public const string UnavailableSummary = "managed=unavailable;mmcss=unavailable";

        private const string ManagedPriorityName = "Highest";
        private const string MmcssPriorityName = "High";
        private readonly Thread _thread;
        private readonly ThreadPriority _originalPriority;
        private readonly IntPtr _mmcssHandle;
        private bool _disposed;

        private ThreadLatencyProfile(
            string roleName,
            Thread thread,
            ThreadPriority originalPriority,
            bool managedPriorityApplied,
            bool mmcssApplied,
            bool mmcssPriorityApplied,
            string failureReason,
            IntPtr mmcssHandle)
        {
            RoleName = string.IsNullOrWhiteSpace(roleName) ? "latencySensitive" : roleName;
            ManagedPriorityApplied = managedPriorityApplied;
            MmcssApplied = mmcssApplied;
            MmcssPriorityApplied = mmcssPriorityApplied;
            FailureReason = failureReason ?? string.Empty;
            Summary = FormatSummary(managedPriorityApplied, mmcssApplied, mmcssPriorityApplied, FailureReason);
            _thread = thread;
            _originalPriority = originalPriority;
            _mmcssHandle = mmcssHandle;
        }

        public string RoleName { get; private set; }

        public bool ManagedPriorityApplied { get; private set; }

        public bool MmcssApplied { get; private set; }

        public bool MmcssPriorityApplied { get; private set; }

        public string FailureReason { get; private set; }

        public string Summary { get; private set; }

        public static ThreadLatencyProfile Enter(string roleName)
        {
            Thread thread = Thread.CurrentThread;
            ThreadPriority originalPriority = thread.Priority;
            bool managedPriorityApplied = TryApplyManagedThreadPriority(thread, ThreadPriority.Highest);
            bool mmcssApplied = false;
            bool mmcssPriorityApplied = false;
            string failureReason = string.Empty;
            IntPtr handle = IntPtr.Zero;

            try
            {
                uint taskIndex = 0;
                handle = AvSetMmThreadCharacteristicsNative(DefaultMmcssTaskName, ref taskIndex);
                if (handle != IntPtr.Zero)
                {
                    mmcssApplied = true;
                    mmcssPriorityApplied = AvSetMmThreadPriorityNative(handle, AvrtPriority.High);
                    if (!mmcssPriorityApplied)
                    {
                        failureReason = "mmcssPriorityFailed:" + Marshal.GetLastWin32Error().ToString();
                    }
                }
                else
                {
                    failureReason = "mmcssFailed:" + Marshal.GetLastWin32Error().ToString();
                }
            }
            catch (DllNotFoundException)
            {
                failureReason = "avrtUnavailable";
            }
            catch (EntryPointNotFoundException)
            {
                failureReason = "avrtEntryPointUnavailable";
            }

            return new ThreadLatencyProfile(
                roleName,
                thread,
                originalPriority,
                managedPriorityApplied,
                mmcssApplied,
                mmcssPriorityApplied,
                failureReason,
                handle);
        }

        public static ThreadLatencyProfile EnterManagedOnly(string roleName)
        {
            Thread thread = Thread.CurrentThread;
            ThreadPriority originalPriority = thread.Priority;
            bool managedPriorityApplied = TryApplyManagedThreadPriority(thread, ThreadPriority.Highest);
            return new ThreadLatencyProfile(
                roleName,
                thread,
                originalPriority,
                managedPriorityApplied,
                false,
                false,
                string.Empty,
                IntPtr.Zero);
        }

        public static bool TryApplyManagedThreadPriority(Thread thread, ThreadPriority priority)
        {
            if (thread == null)
            {
                return false;
            }

            try
            {
                thread.Priority = priority;
                return thread.Priority == priority;
            }
            catch (ThreadStateException)
            {
                return false;
            }
            catch (SecurityException)
            {
                return false;
            }
            catch (InvalidOperationException)
            {
                return false;
            }
        }

        public static string FormatSummary(bool managedPriorityApplied, bool mmcssApplied, bool mmcssPriorityApplied, string failureReason)
        {
            string managedPart = managedPriorityApplied ? "managed=" + ManagedPriorityName : "managed=unavailable";
            string mmcssPart;
            if (mmcssApplied)
            {
                mmcssPart = mmcssPriorityApplied
                    ? "mmcss=" + DefaultMmcssTaskName + ":" + MmcssPriorityName
                    : "mmcss=" + DefaultMmcssTaskName + ":priorityUnavailable";
            }
            else
            {
                mmcssPart = "mmcss=unavailable";
            }

            if (string.IsNullOrWhiteSpace(failureReason))
            {
                return managedPart + ";" + mmcssPart;
            }

            return managedPart + ";" + mmcssPart + ";reason=" + failureReason;
        }

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }

            if (_mmcssHandle != IntPtr.Zero)
            {
                AvRevertMmThreadCharacteristicsNative(_mmcssHandle);
            }

            if (ManagedPriorityApplied)
            {
                TryApplyManagedThreadPriority(_thread, _originalPriority);
            }

            _disposed = true;
        }

        [DllImport("avrt.dll", EntryPoint = "AvSetMmThreadCharacteristicsW", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr AvSetMmThreadCharacteristicsNative(string taskName, ref uint taskIndex);

        [DllImport("avrt.dll", EntryPoint = "AvSetMmThreadPriority", SetLastError = true)]
        private static extern bool AvSetMmThreadPriorityNative(IntPtr avrtHandle, AvrtPriority priority);

        [DllImport("avrt.dll", EntryPoint = "AvRevertMmThreadCharacteristics", SetLastError = true)]
        private static extern bool AvRevertMmThreadCharacteristicsNative(IntPtr avrtHandle);

        private enum AvrtPriority
        {
            VeryLow = -2,
            Low = -1,
            Normal = 0,
            High = 1,
            Critical = 2
        }
    }
}
