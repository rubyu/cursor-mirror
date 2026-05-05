using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Security;

namespace CursorMirror
{
    internal sealed class ProcessLatencyProfile : IDisposable
    {
        private readonly Process _process;
        private readonly ProcessPriorityClass _originalPriorityClass;
        private readonly bool _priorityChanged;
        private bool _disposed;

        private ProcessLatencyProfile(Process process, ProcessPriorityClass originalPriorityClass, bool priorityChanged)
        {
            _process = process;
            _originalPriorityClass = originalPriorityClass;
            _priorityChanged = priorityChanged;
        }

        public static ProcessLatencyProfile Enter()
        {
            try
            {
                Process process = Process.GetCurrentProcess();
                ProcessPriorityClass originalPriorityClass = process.PriorityClass;
                bool shouldBoost =
                    originalPriorityClass != ProcessPriorityClass.AboveNormal &&
                    originalPriorityClass != ProcessPriorityClass.High &&
                    originalPriorityClass != ProcessPriorityClass.RealTime;
                if (shouldBoost)
                {
                    process.PriorityClass = ProcessPriorityClass.AboveNormal;
                    return new ProcessLatencyProfile(process, originalPriorityClass, true);
                }

                return new ProcessLatencyProfile(process, originalPriorityClass, false);
            }
            catch (InvalidOperationException)
            {
                return null;
            }
            catch (NotSupportedException)
            {
                return null;
            }
            catch (SecurityException)
            {
                return null;
            }
            catch (UnauthorizedAccessException)
            {
                return null;
            }
            catch (Win32Exception)
            {
                return null;
            }
        }

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }

            if (_priorityChanged)
            {
                try
                {
                    _process.PriorityClass = _originalPriorityClass;
                }
                catch (InvalidOperationException)
                {
                }
                catch (NotSupportedException)
                {
                }
                catch (SecurityException)
                {
                }
                catch (UnauthorizedAccessException)
                {
                }
                catch (Win32Exception)
                {
                }
            }

            if (_process != null)
            {
                _process.Dispose();
            }

            _disposed = true;
        }
    }
}
