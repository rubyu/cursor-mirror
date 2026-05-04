using System;
using System.ComponentModel;
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
        private LayerBitmapResources _layerResources;
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
            int updateError;
            bool updateSucceeded = UpdateLayer(_lastBitmap, _lastLocation, out updateError);
            if (telemetryEnabled)
            {
                RecordOverlayOperation(
                    recorder,
                    ProductOverlayOperation.ShowCursor,
                    location,
                    bitmap.Size,
                    true,
                    Stopwatch.GetTimestamp() - startedTicks,
                    updateSucceeded,
                    updateError);
            }
        }

        public new void Move(Point location)
        {
            ProductRuntimeOutlierRecorder recorder = ProductRuntimeOutlierRecorder.Current;
            bool telemetryEnabled = recorder.IsEnabled;
            long startedTicks = telemetryEnabled ? Stopwatch.GetTimestamp() : 0;
            bool moveSucceeded = true;
            int moveError = 0;
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
                moveSucceeded = UpdateLayer(_lastBitmap, _lastLocation, out moveError);
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
                    moveSucceeded,
                    moveError);
            }
        }

        public void SetOpacity(byte alpha)
        {
            ProductRuntimeOutlierRecorder recorder = ProductRuntimeOutlierRecorder.Current;
            bool telemetryEnabled = recorder.IsEnabled;
            long startedTicks = telemetryEnabled ? Stopwatch.GetTimestamp() : 0;
            bool updateSucceeded = true;
            int updateError = 0;
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
                updateSucceeded = UpdateLayer(_lastBitmap, _lastLocation, out updateError);
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
                    updateSucceeded,
                    updateError);
            }
        }

        public void HideOverlay()
        {
            _isLayerVisible = false;
            Hide();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                DisposeLayerResources();
                if (_lastBitmap != null)
                {
                    _lastBitmap.Dispose();
                    _lastBitmap = null;
                }
            }

            base.Dispose(disposing);
        }

        private void EnsureHandleVisible()
        {
            IntPtr handle = Handle;
            ShowWindow(handle, SW_SHOWNOACTIVATE);
            SetWindowPos(handle, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }

        private bool UpdateLayer(Bitmap bitmap, Point location, out int lastWin32Error)
        {
            lastWin32Error = 0;
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
            LayerBitmapResources layerResources = null;

            try
            {
                phaseStartedTicks = telemetryEnabled ? Stopwatch.GetTimestamp() : 0;
                screenDc = GetDC(IntPtr.Zero);
                if (telemetryEnabled)
                {
                    getDcTicks = Stopwatch.GetTimestamp() - phaseStartedTicks;
                }

                if (screenDc == IntPtr.Zero)
                {
                    updateError = Marshal.GetLastWin32Error();
                    lastWin32Error = updateError;
                    return false;
                }

                if (!TryEnsureLayerResources(
                    bitmap,
                    screenDc,
                    telemetryEnabled,
                    out layerResources,
                    out createCompatibleDcTicks,
                    out getHbitmapTicks,
                    out selectObjectTicks,
                    out updateError))
                {
                    lastWin32Error = updateError;
                    return false;
                }

                POINT destination = new POINT(location.X, location.Y);
                SIZE size = new SIZE(layerResources.Size.Width, layerResources.Size.Height);
                POINT source = new POINT(0, 0);
                BLENDFUNCTION blend = new BLENDFUNCTION();
                blend.BlendOp = AC_SRC_OVER;
                blend.BlendFlags = 0;
                blend.SourceConstantAlpha = _opacity;
                blend.AlphaFormat = AC_SRC_ALPHA;

                phaseStartedTicks = telemetryEnabled ? Stopwatch.GetTimestamp() : 0;
                updateSucceeded = UpdateLayeredWindow(Handle, screenDc, ref destination, ref size, layerResources.MemoryDc, ref source, 0, ref blend, ULW_ALPHA);
                updateError = updateSucceeded ? 0 : Marshal.GetLastWin32Error();
                lastWin32Error = updateError;
                if (telemetryEnabled)
                {
                    updateLayeredWindowTicks = Stopwatch.GetTimestamp() - phaseStartedTicks;
                }
            }
            finally
            {
                phaseStartedTicks = telemetryEnabled ? Stopwatch.GetTimestamp() : 0;
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

            return updateSucceeded;
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
            DisposeLayerResources();
            if (_lastBitmap != null)
            {
                _lastBitmap.Dispose();
            }

            _lastBitmap = replacement;
        }

        private bool TryEnsureLayerResources(
            Bitmap bitmap,
            IntPtr screenDc,
            bool telemetryEnabled,
            out LayerBitmapResources resources,
            out long createCompatibleDcTicks,
            out long getHbitmapTicks,
            out long selectObjectTicks,
            out int lastWin32Error)
        {
            resources = null;
            createCompatibleDcTicks = 0;
            getHbitmapTicks = 0;
            selectObjectTicks = 0;
            lastWin32Error = 0;

            if (_layerResources != null && _layerResources.Matches(bitmap))
            {
                resources = _layerResources;
                return true;
            }

            DisposeLayerResources();
            LayerBitmapResources created;
            if (!LayerBitmapResources.TryCreate(
                bitmap,
                screenDc,
                telemetryEnabled,
                out created,
                out createCompatibleDcTicks,
                out getHbitmapTicks,
                out selectObjectTicks,
                out lastWin32Error))
            {
                return false;
            }

            _layerResources = created;
            resources = created;
            return true;
        }

        private void DisposeLayerResources()
        {
            if (_layerResources != null)
            {
                _layerResources.Dispose();
                _layerResources = null;
            }
        }

        private sealed class LayerBitmapResources : IDisposable
        {
            private readonly Bitmap _bitmap;
            private IntPtr _hBitmap;
            private IntPtr _oldBitmap;
            private bool _disposed;

            private LayerBitmapResources(Bitmap bitmap, IntPtr memoryDc, IntPtr hBitmap, IntPtr oldBitmap)
            {
                _bitmap = bitmap;
                MemoryDc = memoryDc;
                _hBitmap = hBitmap;
                _oldBitmap = oldBitmap;
                Size = bitmap.Size;
            }

            public IntPtr MemoryDc { get; private set; }

            public Size Size { get; private set; }

            public static bool TryCreate(
                Bitmap bitmap,
                IntPtr screenDc,
                bool telemetryEnabled,
                out LayerBitmapResources resources,
                out long createCompatibleDcTicks,
                out long getHbitmapTicks,
                out long selectObjectTicks,
                out int lastWin32Error)
            {
                resources = null;
                createCompatibleDcTicks = 0;
                getHbitmapTicks = 0;
                selectObjectTicks = 0;
                lastWin32Error = 0;
                long phaseStartedTicks;
                IntPtr memoryDc = IntPtr.Zero;
                IntPtr hBitmap = IntPtr.Zero;
                IntPtr oldBitmap = IntPtr.Zero;

                try
                {
                    phaseStartedTicks = telemetryEnabled ? Stopwatch.GetTimestamp() : 0;
                    memoryDc = CreateCompatibleDC(screenDc);
                    if (telemetryEnabled)
                    {
                        createCompatibleDcTicks = Stopwatch.GetTimestamp() - phaseStartedTicks;
                    }

                    if (memoryDc == IntPtr.Zero)
                    {
                        lastWin32Error = Marshal.GetLastWin32Error();
                        return false;
                    }

                    phaseStartedTicks = telemetryEnabled ? Stopwatch.GetTimestamp() : 0;
                    try
                    {
                        hBitmap = bitmap.GetHbitmap(Color.FromArgb(0));
                    }
                    catch (Win32Exception ex)
                    {
                        lastWin32Error = ex.NativeErrorCode;
                        return false;
                    }
                    catch (ExternalException ex)
                    {
                        lastWin32Error = ex.ErrorCode;
                        return false;
                    }

                    if (telemetryEnabled)
                    {
                        getHbitmapTicks = Stopwatch.GetTimestamp() - phaseStartedTicks;
                    }

                    if (hBitmap == IntPtr.Zero)
                    {
                        lastWin32Error = Marshal.GetLastWin32Error();
                        return false;
                    }

                    phaseStartedTicks = telemetryEnabled ? Stopwatch.GetTimestamp() : 0;
                    oldBitmap = SelectObject(memoryDc, hBitmap);
                    if (telemetryEnabled)
                    {
                        selectObjectTicks = Stopwatch.GetTimestamp() - phaseStartedTicks;
                    }

                    if (oldBitmap == IntPtr.Zero)
                    {
                        lastWin32Error = Marshal.GetLastWin32Error();
                        return false;
                    }

                    resources = new LayerBitmapResources(bitmap, memoryDc, hBitmap, oldBitmap);
                    memoryDc = IntPtr.Zero;
                    hBitmap = IntPtr.Zero;
                    oldBitmap = IntPtr.Zero;
                    return true;
                }
                finally
                {
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
                }
            }

            public bool Matches(Bitmap bitmap)
            {
                return object.ReferenceEquals(_bitmap, bitmap);
            }

            public void Dispose()
            {
                if (_disposed)
                {
                    return;
                }

                if (_oldBitmap != IntPtr.Zero && MemoryDc != IntPtr.Zero)
                {
                    SelectObject(MemoryDc, _oldBitmap);
                    _oldBitmap = IntPtr.Zero;
                }

                if (_hBitmap != IntPtr.Zero)
                {
                    DeleteObject(_hBitmap);
                    _hBitmap = IntPtr.Zero;
                }

                if (MemoryDc != IntPtr.Zero)
                {
                    DeleteDC(MemoryDc);
                    MemoryDc = IntPtr.Zero;
                }

                _disposed = true;
            }
        }
    }
}
