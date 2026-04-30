using System;
using System.Runtime.InteropServices;

namespace CursorMirror
{
    public sealed class LowLevelMouseHook : WindowsHook
    {
        public delegate HookResult MouseCallback(MouseEvent mouseEvent, MSLLHOOKSTRUCT data);

        public enum MouseEvent
        {
            WM_MOUSEMOVE = 0x0200,
            WM_LBUTTONDOWN = 0x0201,
            WM_LBUTTONUP = 0x0202,
            WM_RBUTTONDOWN = 0x0204,
            WM_RBUTTONUP = 0x0205,
            WM_MBUTTONDOWN = 0x0207,
            WM_MBUTTONUP = 0x0208,
            WM_MOUSEWHEEL = 0x020A,
            WM_XBUTTONDOWN = 0x020B,
            WM_XBUTTONUP = 0x020C,
            WM_MOUSEHWHEEL = 0x020E
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT
        {
            public int x;
            public int y;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct MSLLHOOKSTRUCT
        {
            public POINT pt;
            public uint mouseData;
            public uint flags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        public LowLevelMouseHook(MouseCallback userCallback)
            : this(userCallback, new WindowsHookNativeMethods())
        {
        }

        public LowLevelMouseHook(MouseCallback userCallback, IWindowsHookNativeMethods nativeMethods)
            : base(
                HookType.WH_MOUSE_LL,
                delegate(IntPtr wParam, IntPtr lParam)
                {
                    MouseEvent mouseEvent = (MouseEvent)wParam.ToInt32();
                    MSLLHOOKSTRUCT data = new MSLLHOOKSTRUCT();
                    if (lParam != IntPtr.Zero)
                    {
                        data = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));
                    }

                    return userCallback(mouseEvent, data);
                },
                nativeMethods)
        {
            if (userCallback == null)
            {
                throw new ArgumentNullException("userCallback");
            }
        }
    }
}
