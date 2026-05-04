using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using CursorMirror.ProductRuntimeTelemetry;

namespace CursorMirror
{
    public sealed class OverlayWindow : Form, IOverlayPresenter
    {
        private const int WS_EX_LAYERED = 0x00080000;
        private const int WS_EX_TRANSPARENT = 0x00000020;
        private const int WS_EX_NOACTIVATE = 0x08000000;
        private const int WS_EX_TOOLWINDOW = 0x00000080;
        private const int ULW_ALPHA = 0x00000002;
        private const byte AC_SRC_OVER = 0x00;
        private const byte AC_SRC_ALPHA = 0x01;
        private const int SW_SHOWNOACTIVATE = 4;
        private const int SWP_NOSIZE = 0x0001;
        private const int SWP_NOMOVE = 0x0002;
        private const int SWP_NOACTIVATE = 0x0010;
        private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
        private Bitmap _lastBitmap;
        private Point _lastLocation;
        private byte _opacity = 255;
        private bool _isLayerVisible;

        [StructLayout(LayoutKind.Sequential)]
        private struct POINT
        {
            public int x;
            public int y;

            public POINT(int x, int y)
            {
                this.x = x;
                this.y = y;
            }
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct SIZE
        {
            public int cx;
            public int cy;

            public SIZE(int cx, int cy)
            {
                this.cx = cx;
                this.cy = cy;
            }
        }

        [StructLayout(LayoutKind.Sequential, Pack = 1)]
        private struct BLENDFUNCTION
        {
            public byte BlendOp;
            public byte BlendFlags;
            public byte SourceConstantAlpha;
            public byte AlphaFormat;
        }

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr GetDC(IntPtr hWnd);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern int ReleaseDC(IntPtr hWnd, IntPtr hdc);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr hdcDst, ref POINT pptDst, ref SIZE psize, IntPtr hdcSrc, ref POINT pptSrc, int crKey, ref BLENDFUNCTION pblend, int dwFlags);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, int uFlags);

        [DllImport("gdi32.dll", SetLastError = true)]
        private static extern IntPtr CreateCompatibleDC(IntPtr hdc);

        [DllImport("gdi32.dll", SetLastError = true)]
        private static extern bool DeleteDC(IntPtr hdc);

        [DllImport("gdi32.dll", SetLastError = true)]
        private static extern IntPtr SelectObject(IntPtr hdc, IntPtr hObject);

        [DllImport("gdi32.dll", SetLastError = true)]
        private static extern bool DeleteObject(IntPtr hObject);

        public OverlayWindow()
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            TopMost = true;
            Width = 1;
            Height = 1;
        }

        protected override bool ShowWithoutActivation
        {
            get { return true; }
        }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams createParams = base.CreateParams;
                createParams.ExStyle = createParams.ExStyle | WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW;
                return createParams;
            }
        }

        public void ShowCursor(Bitmap bitmap, Point location)
        {
            if (bitmap == null)
            {
                throw new ArgumentNullException("bitmap");
            }

            ProductRuntimeOutlierRecorder recorder = ProductRuntimeOutlierRecorder.Current;
            bool telemetryEnabled = recorder.IsEnabled;
            long startedTicks = telemetryEnabled ? Stopwatch.GetTimestamp() : 0;
            EnsureHandleVisible();
            _isLayerVisible = true;
            ReplaceLastBitmap(bitmap);
            _lastLocation = location;
            UpdateLayer(_lastBitmap, _lastLocation);
            if (telemetryEnabled)
            {
                RecordOverlayOperation(
                    recorder,
                    ProductOverlayOperation.ShowCursor,
                    location,
                    bitmap.Size,
                    true,
                    Stopwatch.GetTimestamp() - startedTicks,
                    true,
                    0);
            }
        }

        public new void Move(Point location)
        {
            ProductRuntimeOutlierRecorder recorder = ProductRuntimeOutlierRecorder.Current;
            bool telemetryEnabled = recorder.IsEnabled;
            long startedTicks = telemetryEnabled ? Stopwatch.GetTimestamp() : 0;
            if (!IsHandleCreated)
            {
                if (telemetryEnabled)
                {
                    RecordOverlayOperation(
                        recorder,
                        ProductOverlayOperation.Move,
                        location,
                        Size.Empty,
                        _lastBitmap != null,
                        Stopwatch.GetTimestamp() - startedTicks,
                        false,
                        0);
                }

                return;
            }

            _lastLocation = location;
            if (_lastBitmap != null)
            {
                UpdateLayer(_lastBitmap, _lastLocation);
            }
            else
            {
                SetDesktopLocation(location.X, location.Y);
            }

            if (telemetryEnabled)
            {
                Size size = _lastBitmap == null ? Size.Empty : _lastBitmap.Size;
                RecordOverlayOperation(
                    recorder,
                    ProductOverlayOperation.Move,
                    location,
                    size,
                    _lastBitmap != null,
                    Stopwatch.GetTimestamp() - startedTicks,
                    true,
                    0);
            }
        }

        public void SetOpacity(byte alpha)
        {
            ProductRuntimeOutlierRecorder recorder = ProductRuntimeOutlierRecorder.Current;
            bool telemetryEnabled = recorder.IsEnabled;
            long startedTicks = telemetryEnabled ? Stopwatch.GetTimestamp() : 0;
            if (_opacity == alpha)
            {
                if (telemetryEnabled)
                {
                    RecordOverlayOperation(
                        recorder,
                        ProductOverlayOperation.SetOpacity,
                        _lastLocation,
                        _lastBitmap == null ? Size.Empty : _lastBitmap.Size,
                        _lastBitmap != null,
                        Stopwatch.GetTimestamp() - startedTicks,
                        true,
                        0);
                }

                return;
            }

            _opacity = alpha;
            if (IsHandleCreated && _lastBitmap != null && _isLayerVisible)
            {
                UpdateLayer(_lastBitmap, _lastLocation);
            }

            if (telemetryEnabled)
            {
                RecordOverlayOperation(
                    recorder,
                    ProductOverlayOperation.SetOpacity,
                    _lastLocation,
                    _lastBitmap == null ? Size.Empty : _lastBitmap.Size,
                    _lastBitmap != null,
                    Stopwatch.GetTimestamp() - startedTicks,
                    true,
                    0);
            }
        }

        public void HideOverlay()
        {
            _isLayerVisible = false;
            Hide();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing && _lastBitmap != null)
            {
                _lastBitmap.Dispose();
                _lastBitmap = null;
            }

            base.Dispose(disposing);
        }

        private void EnsureHandleVisible()
        {
            IntPtr handle = Handle;
            ShowWindow(handle, SW_SHOWNOACTIVATE);
            SetWindowPos(handle, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }

        private void UpdateLayer(Bitmap bitmap, Point location)
        {
            ProductRuntimeOutlierRecorder recorder = ProductRuntimeOutlierRecorder.Current;
            bool telemetryEnabled = recorder.IsEnabled;
            long totalStartedTicks = telemetryEnabled ? Stopwatch.GetTimestamp() : 0;
            long phaseStartedTicks = 0;
            long getDcTicks = 0;
            long createCompatibleDcTicks = 0;
            long getHbitmapTicks = 0;
            long selectObjectTicks = 0;
            long updateLayeredWindowTicks = 0;
            long cleanupTicks = 0;
            bool updateSucceeded = false;
            int updateError = 0;
            IntPtr screenDc = IntPtr.Zero;
            IntPtr memoryDc = IntPtr.Zero;
            IntPtr hBitmap = IntPtr.Zero;
            IntPtr oldBitmap = IntPtr.Zero;

            try
            {
                phaseStartedTicks = telemetryEnabled ? Stopwatch.GetTimestamp() : 0;
                screenDc = GetDC(IntPtr.Zero);
                if (telemetryEnabled)
                {
                    getDcTicks = Stopwatch.GetTimestamp() - phaseStartedTicks;
                }

                phaseStartedTicks = telemetryEnabled ? Stopwatch.GetTimestamp() : 0;
                memoryDc = CreateCompatibleDC(screenDc);
                if (telemetryEnabled)
                {
                    createCompatibleDcTicks = Stopwatch.GetTimestamp() - phaseStartedTicks;
                }

                phaseStartedTicks = telemetryEnabled ? Stopwatch.GetTimestamp() : 0;
                hBitmap = bitmap.GetHbitmap(Color.FromArgb(0));
                if (telemetryEnabled)
                {
                    getHbitmapTicks = Stopwatch.GetTimestamp() - phaseStartedTicks;
                }

                phaseStartedTicks = telemetryEnabled ? Stopwatch.GetTimestamp() : 0;
                oldBitmap = SelectObject(memoryDc, hBitmap);
                if (telemetryEnabled)
                {
                    selectObjectTicks = Stopwatch.GetTimestamp() - phaseStartedTicks;
                }

                POINT destination = new POINT(location.X, location.Y);
                SIZE size = new SIZE(bitmap.Width, bitmap.Height);
                POINT source = new POINT(0, 0);
                BLENDFUNCTION blend = new BLENDFUNCTION();
                blend.BlendOp = AC_SRC_OVER;
                blend.BlendFlags = 0;
                blend.SourceConstantAlpha = _opacity;
                blend.AlphaFormat = AC_SRC_ALPHA;

                phaseStartedTicks = telemetryEnabled ? Stopwatch.GetTimestamp() : 0;
                updateSucceeded = UpdateLayeredWindow(Handle, screenDc, ref destination, ref size, memoryDc, ref source, 0, ref blend, ULW_ALPHA);
                updateError = Marshal.GetLastWin32Error();
                if (telemetryEnabled)
                {
                    updateLayeredWindowTicks = Stopwatch.GetTimestamp() - phaseStartedTicks;
                }
            }
            finally
            {
                phaseStartedTicks = telemetryEnabled ? Stopwatch.GetTimestamp() : 0;
                if (oldBitmap != IntPtr.Zero && memoryDc != IntPtr.Zero)
                {
                    SelectObject(memoryDc, oldBitmap);
                }

                if (hBitmap != IntPtr.Zero)
                {
                    DeleteObject(hBitmap);
                }

                if (memoryDc != IntPtr.Zero)
                {
                    DeleteDC(memoryDc);
                }

                if (screenDc != IntPtr.Zero)
                {
                    ReleaseDC(IntPtr.Zero, screenDc);
                }

                if (telemetryEnabled)
                {
                    cleanupTicks = Stopwatch.GetTimestamp() - phaseStartedTicks;
                    ProductRuntimeOutlierEvent runtimeEvent = new ProductRuntimeOutlierEvent();
                    runtimeEvent.EventKind = (int)ProductRuntimeOutlierEventKind.OverlayOperation;
                    runtimeEvent.OverlayOperation = (int)ProductOverlayOperation.UpdateLayer;
                    runtimeEvent.X = location.X;
                    runtimeEvent.Y = location.Y;
                    runtimeEvent.Width = bitmap.Width;
                    runtimeEvent.Height = bitmap.Height;
                    runtimeEvent.Alpha = _opacity;
                    runtimeEvent.HadBitmap = 1;
                    runtimeEvent.GetDcTicks = getDcTicks;
                    runtimeEvent.CreateCompatibleDcTicks = createCompatibleDcTicks;
                    runtimeEvent.GetHbitmapTicks = getHbitmapTicks;
                    runtimeEvent.SelectObjectTicks = selectObjectTicks;
                    runtimeEvent.UpdateLayeredWindowTicks = updateLayeredWindowTicks;
                    runtimeEvent.CleanupTicks = cleanupTicks;
                    runtimeEvent.TotalTicks = Stopwatch.GetTimestamp() - totalStartedTicks;
                    runtimeEvent.Succeeded = updateSucceeded ? 1 : 0;
                    runtimeEvent.LastWin32Error = updateError;
                    recorder.Record(ref runtimeEvent);
                }
            }
        }

        private void RecordOverlayOperation(
            ProductRuntimeOutlierRecorder recorder,
            ProductOverlayOperation operation,
            Point location,
            Size size,
            bool hadBitmap,
            long totalTicks,
            bool succeeded,
            int lastWin32Error)
        {
            ProductRuntimeOutlierEvent runtimeEvent = new ProductRuntimeOutlierEvent();
            runtimeEvent.EventKind = (int)ProductRuntimeOutlierEventKind.OverlayOperation;
            runtimeEvent.OverlayOperation = (int)operation;
            runtimeEvent.X = location.X;
            runtimeEvent.Y = location.Y;
            runtimeEvent.Width = size.Width;
            runtimeEvent.Height = size.Height;
            runtimeEvent.Alpha = _opacity;
            runtimeEvent.HadBitmap = hadBitmap ? 1 : 0;
            runtimeEvent.TotalTicks = totalTicks;
            runtimeEvent.Succeeded = succeeded ? 1 : 0;
            runtimeEvent.LastWin32Error = lastWin32Error;
            recorder.Record(ref runtimeEvent);
        }

        private void ReplaceLastBitmap(Bitmap bitmap)
        {
            Bitmap replacement = new Bitmap(bitmap);
            if (_lastBitmap != null)
            {
                _lastBitmap.Dispose();
            }

            _lastBitmap = replacement;
        }
    }
}
