using System;
using System.Threading;
using System.Windows.Forms;

namespace CursorMirror
{
    public sealed class StaMessageLoopDispatcher : IUiDispatcher, IDisposable
    {
        private readonly string _threadName;
        private readonly ManualResetEvent _ready = new ManualResetEvent(false);
        private readonly object _sync = new object();
        private Thread _thread;
        private Control _control;
        private Exception _startupException;
        private volatile bool _stopping;
        private bool _started;
        private bool _disposed;

        public StaMessageLoopDispatcher(string threadName)
        {
            _threadName = string.IsNullOrWhiteSpace(threadName) ? "Cursor Mirror STA dispatcher" : threadName;
        }

        public bool InvokeRequired
        {
            get
            {
                Control control = _control;
                return control != null && control.InvokeRequired;
            }
        }

        public void Start()
        {
            ThrowIfDisposed();
            if (_started)
            {
                return;
            }

            _stopping = false;
            _startupException = null;
            _ready.Reset();
            _thread = new Thread(RunMessageLoop);
            _thread.Name = _threadName;
            _thread.IsBackground = true;
            _thread.Priority = ThreadPriority.AboveNormal;
            _thread.SetApartmentState(ApartmentState.STA);
            _thread.Start();
            _ready.WaitOne();

            if (_startupException != null)
            {
                Stop();
                throw new InvalidOperationException("The STA dispatcher thread could not be started.", _startupException);
            }

            _started = true;
        }

        public void BeginInvoke(Action action)
        {
            if (action == null)
            {
                throw new ArgumentNullException("action");
            }

            Control control;
            lock (_sync)
            {
                control = _control;
            }

            if (!_started || _stopping || control == null || control.IsDisposed || !control.IsHandleCreated)
            {
                throw new InvalidOperationException("The STA dispatcher is not running.");
            }

            control.BeginInvoke(action);
        }

        public void Stop()
        {
            _stopping = true;

            Control control;
            lock (_sync)
            {
                control = _control;
            }

            if (control != null && !control.IsDisposed && control.IsHandleCreated)
            {
                try
                {
                    control.BeginInvoke((Action)Application.ExitThread);
                }
                catch (ObjectDisposedException)
                {
                }
                catch (InvalidOperationException)
                {
                }
            }

            Thread thread = _thread;
            if (thread != null && thread != Thread.CurrentThread)
            {
                thread.Join(1000);
            }

            lock (_sync)
            {
                _control = null;
            }

            _thread = null;
            _started = false;
        }

        public void Dispose()
        {
            if (!_disposed)
            {
                Stop();
                _ready.Dispose();
                _disposed = true;
            }
        }

        private void RunMessageLoop()
        {
            Control control = null;
            try
            {
                control = new Control();
                control.CreateControl();
                IntPtr handle = control.Handle;
                if (handle == IntPtr.Zero)
                {
                    throw new InvalidOperationException("The dispatcher control handle could not be created.");
                }

                lock (_sync)
                {
                    _control = control;
                }

                _ready.Set();
                Application.Run();
            }
            catch (Exception ex)
            {
                _startupException = ex;
                _ready.Set();
            }
            finally
            {
                lock (_sync)
                {
                    _control = null;
                }

                if (control != null)
                {
                    control.Dispose();
                }

                _ready.Set();
            }
        }

        private void ThrowIfDisposed()
        {
            if (_disposed)
            {
                throw new ObjectDisposedException(GetType().Name);
            }
        }
    }
}
