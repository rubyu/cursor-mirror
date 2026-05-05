using System;
using System.ComponentModel;
using System.Drawing;
using System.Runtime.InteropServices;

namespace CursorMirror
{
    public sealed class RealCursorDriver
    {
        public static readonly IntPtr CalibratorInjectionExtraInfo = new IntPtr(unchecked((int)0x434D4343));
        public static readonly IntPtr DemoInjectionExtraInfo = new IntPtr(unchecked((int)0x434D444D));
        public static readonly IntPtr MotionLabInjectionExtraInfo = new IntPtr(unchecked((int)0x434D4D4C));

        private const int InputMouse = 0;
        private const int MouseEventMove = 0x0001;
        private const int MouseEventAbsolute = 0x8000;
        private const int MouseEventVirtualDesk = 0x4000;
        private const int SmXVirtualScreen = 76;
        private const int SmYVirtualScreen = 77;
        private const int SmCxVirtualScreen = 78;
        private const int SmCyVirtualScreen = 79;

        private readonly IntPtr _injectionExtraInfo;

        public RealCursorDriver(IntPtr injectionExtraInfo)
        {
            _injectionExtraInfo = injectionExtraInfo;
        }

        public IntPtr InjectionExtraInfo
        {
            get { return _injectionExtraInfo; }
        }

        public bool TryGetCursorPosition(out Point position)
        {
            NativePoint point;
            if (!GetCursorPosNative(out point))
            {
                position = Point.Empty;
                return false;
            }

            position = new Point(point.x, point.y);
            return true;
        }

        public void MoveTo(Point screenPosition)
        {
            Rectangle virtualScreen = GetVirtualScreen();
            INPUT input = new INPUT();
            input.type = InputMouse;
            input.mi.dx = ToAbsolute(screenPosition.X, virtualScreen.Left, virtualScreen.Width);
            input.mi.dy = ToAbsolute(screenPosition.Y, virtualScreen.Top, virtualScreen.Height);
            input.mi.dwFlags = MouseEventMove | MouseEventAbsolute | MouseEventVirtualDesk;
            input.mi.dwExtraInfo = _injectionExtraInfo;

            INPUT[] inputs = new INPUT[] { input };
            uint sent = SendInputNative(1, inputs, Marshal.SizeOf(typeof(INPUT)));
            if (sent != 1)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }
        }

        private static Rectangle GetVirtualScreen()
        {
            return new Rectangle(
                GetSystemMetricsNative(SmXVirtualScreen),
                GetSystemMetricsNative(SmYVirtualScreen),
                Math.Max(1, GetSystemMetricsNative(SmCxVirtualScreen)),
                Math.Max(1, GetSystemMetricsNative(SmCyVirtualScreen)));
        }

        private static int ToAbsolute(int value, int origin, int length)
        {
            double normalized = ((value - origin) * 65535.0) / Math.Max(1, length - 1);
            return (int)Math.Round(Math.Max(0, Math.Min(65535, normalized)));
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct INPUT
        {
            public int type;
            public MOUSEINPUT mi;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MOUSEINPUT
        {
            public int dx;
            public int dy;
            public uint mouseData;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [DllImport("user32.dll", EntryPoint = "SendInput", SetLastError = true)]
        private static extern uint SendInputNative(uint numberOfInputs, INPUT[] inputs, int sizeOfInputStructure);

        [DllImport("user32.dll", EntryPoint = "GetCursorPos", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetCursorPosNative(out NativePoint point);

        [DllImport("user32.dll", EntryPoint = "GetSystemMetrics")]
        private static extern int GetSystemMetricsNative(int index);
    }
}
