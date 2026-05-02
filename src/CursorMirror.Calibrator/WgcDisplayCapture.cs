using System;
using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Threading;
using System.Threading.Tasks;
using Windows.Foundation;
using Windows.Graphics;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;
using Windows.Graphics.DirectX.Direct3D11;
using Windows.Graphics.Imaging;

namespace CursorMirror.Calibrator
{
    internal sealed class WgcDisplayCapture : IDisposable
    {
        private const int D3D_DRIVER_TYPE_HARDWARE = 1;
        private const uint D3D11_CREATE_DEVICE_BGRA_SUPPORT = 0x20;
        private const uint D3D11_SDK_VERSION = 7;
        private static readonly Guid IDXGIDeviceGuid = new Guid("54ec77fa-1377-44e6-8c32-88fd5f44c84c");
        private static readonly Guid IGraphicsCaptureItemGuid = new Guid("79c3f95b-31f7-4ec2-a464-632ef5d30760");

        private readonly Rectangle _displayBounds;
        private IDirect3DDevice _device;
        private GraphicsCaptureItem _item;
        private Direct3D11CaptureFramePool _framePool;
        private GraphicsCaptureSession _session;
        private Timer _pollTimer;
        private int _polling;
        private int _frameIndex;
        private bool _disposed;

        public WgcDisplayCapture(Rectangle displayBounds)
        {
            _displayBounds = displayBounds;
        }

        public event EventHandler<CalibrationFrameAnalysis> FrameCaptured;

        public static bool IsSupported
        {
            get { return GraphicsCaptureSession.IsSupported(); }
        }

        public void Start()
        {
            ThrowIfDisposed();
            if (_session != null)
            {
                throw new InvalidOperationException("Capture has already started.");
            }

            _device = CreateDirect3DDevice();
            _item = GraphicsCaptureItemInterop.CreateForPrimaryMonitor(_displayBounds);
            _framePool = Direct3D11CaptureFramePool.CreateFreeThreaded(
                _device,
                DirectXPixelFormat.B8G8R8A8UIntNormalized,
                2,
                _item.Size);
            _session = _framePool.CreateCaptureSession(_item);
            _session.IsCursorCaptureEnabled = true;
            _session.StartCapture();
            _pollTimer = new Timer(PollFrame, null, 0, 16);
        }

        private void PollFrame(object state)
        {
            if (Interlocked.Exchange(ref _polling, 1) != 0)
            {
                return;
            }

            try
            {
                Direct3D11CaptureFramePool framePool = _framePool;
                if (framePool == null)
                {
                    return;
                }

                using (Direct3D11CaptureFrame frame = framePool.TryGetNextFrame())
                {
                    if (frame == null)
                    {
                        return;
                    }

                    CalibrationFrameAnalysis analysis = AnalyzeFrame(frame);
                    EventHandler<CalibrationFrameAnalysis> handler = FrameCaptured;
                    if (handler != null)
                    {
                        handler(this, analysis);
                    }
                }
            }
            catch
            {
            }
            finally
            {
                Interlocked.Exchange(ref _polling, 0);
            }
        }

        private CalibrationFrameAnalysis AnalyzeFrame(Direct3D11CaptureFrame frame)
        {
            SoftwareBitmap bitmap = null;
            SoftwareBitmap converted = null;
            try
            {
                Task<SoftwareBitmap> task = SoftwareBitmap.CreateCopyFromSurfaceAsync(frame.Surface).AsTask();
                bitmap = task.Result;
                if (bitmap.BitmapPixelFormat != BitmapPixelFormat.Bgra8)
                {
                    converted = SoftwareBitmap.Convert(bitmap, BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied);
                }

                SoftwareBitmap source = converted ?? bitmap;
                byte[] pixels;
                int stride;
                CopyBgraPixels(source, out pixels, out stride);
                return CalibrationFrameAnalyzer.AnalyzeBgra(
                    _frameIndex++,
                    Stopwatch.GetTimestamp(),
                    pixels,
                    source.PixelWidth,
                    source.PixelHeight,
                    stride,
                    CalibrationFrameAnalyzer.DefaultDarkThreshold);
            }
            finally
            {
                if (converted != null)
                {
                    converted.Dispose();
                }

                if (bitmap != null)
                {
                    bitmap.Dispose();
                }
            }
        }

        private static void CopyBgraPixels(SoftwareBitmap bitmap, out byte[] pixels, out int stride)
        {
            using (BitmapBuffer buffer = bitmap.LockBuffer(BitmapBufferAccessMode.Read))
            using (IMemoryBufferReference reference = buffer.CreateReference())
            {
                BitmapPlaneDescription description = buffer.GetPlaneDescription(0);
                IntPtr data;
                uint capacity;
                ((IMemoryBufferByteAccess)reference).GetBuffer(out data, out capacity);
                stride = description.Stride;
                int byteCount = stride * bitmap.PixelHeight;
                pixels = new byte[byteCount];
                Marshal.Copy(new IntPtr(data.ToInt64() + description.StartIndex), pixels, 0, byteCount);
            }
        }

        private static IDirect3DDevice CreateDirect3DDevice()
        {
            IntPtr d3dDevice;
            IntPtr deviceContext;
            int featureLevel;
            int hr = D3D11CreateDevice(
                IntPtr.Zero,
                D3D_DRIVER_TYPE_HARDWARE,
                IntPtr.Zero,
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                IntPtr.Zero,
                0,
                D3D11_SDK_VERSION,
                out d3dDevice,
                out featureLevel,
                out deviceContext);
            ThrowIfFailed(hr, "D3D11CreateDevice failed.");

            IntPtr dxgiDevice = IntPtr.Zero;
            IntPtr inspectable = IntPtr.Zero;
            try
            {
                Guid dxgiDeviceGuid = IDXGIDeviceGuid;
                hr = Marshal.QueryInterface(d3dDevice, ref dxgiDeviceGuid, out dxgiDevice);
                ThrowIfFailed(hr, "IDXGIDevice query failed.");

                hr = CreateDirect3D11DeviceFromDXGIDevice(dxgiDevice, out inspectable);
                ThrowIfFailed(hr, "CreateDirect3D11DeviceFromDXGIDevice failed.");

                return (IDirect3DDevice)Marshal.GetObjectForIUnknown(inspectable);
            }
            finally
            {
                if (inspectable != IntPtr.Zero)
                {
                    Marshal.Release(inspectable);
                }

                if (dxgiDevice != IntPtr.Zero)
                {
                    Marshal.Release(dxgiDevice);
                }

                if (deviceContext != IntPtr.Zero)
                {
                    Marshal.Release(deviceContext);
                }

                if (d3dDevice != IntPtr.Zero)
                {
                    Marshal.Release(d3dDevice);
                }
            }
        }

        private static void ThrowIfFailed(int hr, string message)
        {
            if (hr < 0)
            {
                Marshal.ThrowExceptionForHR(hr);
                throw new InvalidOperationException(message);
            }
        }

        public void Dispose()
        {
            Dispose(true);
            GC.SuppressFinalize(this);
        }

        private void Dispose(bool disposing)
        {
            if (!_disposed)
            {
                if (disposing)
                {
                    if (_session != null)
                    {
                        _session.Dispose();
                        _session = null;
                    }

                    if (_pollTimer != null)
                    {
                        _pollTimer.Dispose();
                        _pollTimer = null;
                    }

                    if (_framePool != null)
                    {
                        _framePool.Dispose();
                        _framePool = null;
                    }

                    _item = null;
                    _device = null;
                }

                _disposed = true;
            }
        }

        private void ThrowIfDisposed()
        {
            if (_disposed)
            {
                throw new ObjectDisposedException(GetType().Name);
            }
        }

        [DllImport("d3d11.dll", ExactSpelling = true)]
        private static extern int D3D11CreateDevice(
            IntPtr adapter,
            int driverType,
            IntPtr software,
            uint flags,
            IntPtr featureLevels,
            uint featureLevelCount,
            uint sdkVersion,
            out IntPtr device,
            out int featureLevel,
            out IntPtr immediateContext);

        [DllImport("d3d11.dll", ExactSpelling = true)]
        private static extern int CreateDirect3D11DeviceFromDXGIDevice(IntPtr dxgiDevice, out IntPtr graphicsDevice);

        [ComImport]
        [Guid("5B0D3235-4DBA-4D44-865E-8F1D0E4FD04D")]
        [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IMemoryBufferByteAccess
        {
            void GetBuffer(out IntPtr buffer, out uint capacity);
        }

        private static class GraphicsCaptureItemInterop
        {
            public static GraphicsCaptureItem CreateForPrimaryMonitor(Rectangle displayBounds)
            {
                IntPtr monitor = MonitorFromPoint(
                    new NativePoint(displayBounds.Left + (displayBounds.Width / 2), displayBounds.Top + (displayBounds.Height / 2)),
                    2);
                object factory = WindowsRuntimeMarshal.GetActivationFactory(typeof(GraphicsCaptureItem));
                IGraphicsCaptureItemInterop interop = (IGraphicsCaptureItemInterop)factory;
                Guid graphicsCaptureItemGuid = IGraphicsCaptureItemGuid;
                IntPtr itemPointer = interop.CreateForMonitor(monitor, ref graphicsCaptureItemGuid);
                try
                {
                    return (GraphicsCaptureItem)Marshal.GetObjectForIUnknown(itemPointer);
                }
                finally
                {
                    Marshal.Release(itemPointer);
                }
            }

            [DllImport("user32.dll")]
            private static extern IntPtr MonitorFromPoint(NativePoint point, uint flags);

            [StructLayout(LayoutKind.Sequential)]
            private struct NativePoint
            {
                public int X;
                public int Y;

                public NativePoint(int x, int y)
                {
                    X = x;
                    Y = y;
                }
            }

            [ComImport]
            [Guid("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356")]
            [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
            private interface IGraphicsCaptureItemInterop
            {
                IntPtr CreateForWindow(IntPtr window, ref Guid iid);
                IntPtr CreateForMonitor(IntPtr monitor, ref Guid iid);
            }
        }
    }
}
