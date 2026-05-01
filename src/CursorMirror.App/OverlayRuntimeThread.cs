using System;
using System.Threading;
using System.Windows.Forms;

namespace CursorMirror
{
    internal sealed class OverlayRuntimeThread : IDisposable
    {
        private readonly CursorMirrorSettings _initialSettings;
        private readonly ManualResetEvent _ready = new ManualResetEvent(false);
        private readonly object _sync = new object();
        private Thread _thread;
        private OverlayWindow _overlayWindow;
        private CursorMirrorController _controller;
        private DwmSynchronizedRuntimeScheduler _runtimeScheduler;
        private Exception _startupException;
        private bool _started;
        private bool _disposed;
        private volatile bool _stopping;

        public OverlayRuntimeThread(CursorMirrorSettings initialSettings)
        {
            if (initialSettings == null)
            {
                throw new ArgumentNullException("initialSettings");
            }

            _initialSettings = initialSettings.Normalize();
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
            _thread = new Thread(RunOverlayThread);
            _thread.Name = "Cursor Mirror overlay runtime";
            _thread.IsBackground = true;
            _thread.Priority = ThreadPriority.AboveNormal;
            _thread.SetApartmentState(ApartmentState.STA);
            _thread.Start();
            _ready.WaitOne();

            if (_startupException != null)
            {
                Stop();
                throw new InvalidOperationException("The overlay runtime thread could not be started.", _startupException);
            }

            _started = true;
        }

        public HookResult HandleMouseEvent(LowLevelMouseHook.MouseEvent mouseEvent, LowLevelMouseHook.MSLLHOOKSTRUCT data)
        {
            if (mouseEvent == LowLevelMouseHook.MouseEvent.WM_MOUSEMOVE)
            {
                Post(delegate
                {
                    CursorMirrorController controller = GetController();
                    if (controller != null)
                    {
                        controller.HandleMouseEvent(mouseEvent, data);
                    }
                });
            }

            return HookResult.Transfer;
        }

        public void UpdateSettings(CursorMirrorSettings settings)
        {
            if (settings == null)
            {
                throw new ArgumentNullException("settings");
            }

            CursorMirrorSettings normalized = settings.Normalize();
            Post(delegate
            {
                CursorMirrorController controller = GetController();
                if (controller != null)
                {
                    controller.UpdateSettings(normalized);
                }
            });
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

        private void RunOverlayThread()
        {
            OverlayWindow overlayWindow = null;
            CursorMirrorController controller = null;
            DwmSynchronizedRuntimeScheduler runtimeScheduler = null;

            try
            {
                overlayWindow = new OverlayWindow();
                overlayWindow.CreateControl();
                IntPtr handle = overlayWindow.Handle;
                if (handle == IntPtr.Zero)
                {
                    throw new InvalidOperationException("The overlay window handle could not be created.");
                }

                ControlDispatcher dispatcher = new ControlDispatcher(overlayWindow);
                controller = new CursorMirrorController(
                    new CursorImageProvider(),
                    overlayWindow,
                    dispatcher,
                    _initialSettings,
                    new SystemClock(),
                    new CursorPoller());
                runtimeScheduler = new DwmSynchronizedRuntimeScheduler(dispatcher, RunRuntimeTick);

                lock (_sync)
                {
                    _overlayWindow = overlayWindow;
                    _controller = controller;
                    _runtimeScheduler = runtimeScheduler;
                }

                runtimeScheduler.Start();
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
                _stopping = true;

                if (runtimeScheduler != null)
                {
                    runtimeScheduler.Dispose();
                }

                if (controller != null)
                {
                    controller.Dispose();
                }
                else if (overlayWindow != null)
                {
                    overlayWindow.Dispose();
                }

                lock (_sync)
                {
                    _runtimeScheduler = null;
                    _controller = null;
                    _overlayWindow = null;
                }

                _ready.Set();
            }
        }

        private void RunRuntimeTick()
        {
            if (_stopping)
            {
                return;
            }

            CursorMirrorController controller = GetController();
            if (controller != null)
            {
                controller.Tick();
            }
        }

        private CursorMirrorController GetController()
        {
            lock (_sync)
            {
                return _controller;
            }
        }

        private bool Post(Action action)
        {
            if (action == null)
            {
                throw new ArgumentNullException("action");
            }

            if (_stopping || _disposed)
            {
                return false;
            }

            OverlayWindow overlayWindow;
            lock (_sync)
            {
                overlayWindow = _overlayWindow;
            }

            if (overlayWindow == null || overlayWindow.IsDisposed || !overlayWindow.IsHandleCreated)
            {
                return false;
            }

            try
            {
                overlayWindow.BeginInvoke(action);
                return true;
            }
            catch (ObjectDisposedException)
            {
                return false;
            }
            catch (InvalidOperationException)
            {
                return false;
            }
        }

        private void Stop()
        {
            _stopping = true;

            OverlayWindow overlayWindow;
            lock (_sync)
            {
                overlayWindow = _overlayWindow;
            }

            if (overlayWindow != null && !overlayWindow.IsDisposed && overlayWindow.IsHandleCreated)
            {
                try
                {
                    overlayWindow.BeginInvoke((Action)Application.ExitThread);
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

            _thread = null;
            _started = false;
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
