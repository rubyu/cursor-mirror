using System;
using System.ComponentModel;
using System.Drawing;
using System.Runtime.InteropServices;

namespace CursorMirror.Calibrator
{
    internal sealed class CalibratorCursorDriver
    {
        public static readonly IntPtr InjectionExtraInfo = new IntPtr(unchecked((int)0x434D4343));

        private const int INPUT_MOUSE = 0;
        private const int MOUSEEVENTF_MOVE = 0x0001;
        private const int MOUSEEVENTF_ABSOLUTE = 0x8000;
        private const int MOUSEEVENTF_VIRTUALDESK = 0x4000;
        private const int SM_XVIRTUALSCREEN = 76;
        private const int SM_YVIRTUALSCREEN = 77;
        private const int SM_CXVIRTUALSCREEN = 78;
        private const int SM_CYVIRTUALSCREEN = 79;

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

        [DllImport("user32.dll", SetLastError = true)]
        private static extern uint SendInput(uint numberOfInputs, INPUT[] inputs, int sizeOfInputStructure);

        [DllImport("user32.dll")]
        private static extern int GetSystemMetrics(int index);

        public void MoveTo(Point screenPosition)
        {
            Rectangle virtualScreen = GetVirtualScreen();
            INPUT input = new INPUT();
            input.type = INPUT_MOUSE;
            input.mi.dx = ToAbsolute(screenPosition.X, virtualScreen.Left, virtualScreen.Width);
            input.mi.dy = ToAbsolute(screenPosition.Y, virtualScreen.Top, virtualScreen.Height);
            input.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
            input.mi.dwExtraInfo = InjectionExtraInfo;

            INPUT[] inputs = new INPUT[] { input };
            uint sent = SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
            if (sent != 1)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }
        }

        private static Rectangle GetVirtualScreen()
        {
            return new Rectangle(
                GetSystemMetrics(SM_XVIRTUALSCREEN),
                GetSystemMetrics(SM_YVIRTUALSCREEN),
                Math.Max(1, GetSystemMetrics(SM_CXVIRTUALSCREEN)),
                Math.Max(1, GetSystemMetrics(SM_CYVIRTUALSCREEN)));
        }

        private static int ToAbsolute(int value, int origin, int length)
        {
            double normalized = ((value - origin) * 65535.0) / Math.Max(1, length - 1);
            return (int)Math.Round(Math.Max(0, Math.Min(65535, normalized)));
        }
    }
}
