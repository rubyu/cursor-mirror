using System;
using System.Collections.Generic;
using System.Drawing;
using System.Runtime.InteropServices;
using CursorMirror;

namespace CursorMirror.Tests
{
    internal sealed class FakeWindowsHookNativeMethods : IWindowsHookNativeMethods
    {
        public int SetHookCallCount;
        public int UnhookCallCount;
        public int CallNextCallCount;
        public IntPtr HookHandleToReturn = new IntPtr(100);
        public IntPtr ModuleHandleToReturn = new IntPtr(200);
        public IntPtr NextResult = new IntPtr(300);
        public bool UnhookResult = true;
        public NativeHookCallback Callback;

        public IntPtr SetWindowsHookEx(int idHook, NativeHookCallback callback, IntPtr hInstance, int threadId)
        {
            SetHookCallCount++;
            Callback = callback;
            return HookHandleToReturn;
        }

        public bool UnhookWindowsHookEx(IntPtr hook)
        {
            UnhookCallCount++;
            return UnhookResult;
        }

        public IntPtr CallNextHookEx(IntPtr hook, int nCode, IntPtr wParam, IntPtr lParam)
        {
            CallNextCallCount++;
            return NextResult;
        }

        public IntPtr GetModuleHandle(string name)
        {
            return ModuleHandleToReturn;
        }
    }

    internal sealed class FakeCursorNativeMethods : ICursorNativeMethods
    {
        public bool GetCursorInfoResult = true;
        public bool GetIconInfoResult = true;
        public bool DrawIconExResult = true;
        public IntPtr CursorHandle = new IntPtr(10);
        public IntPtr CopiedIconHandle = new IntPtr(20);
        public IntPtr ColorBitmapHandle = new IntPtr(30);
        public IntPtr MaskBitmapHandle = new IntPtr(40);
        public int BitmapWidth = 32;
        public int BitmapHeight = 32;
        public int HotSpotX = 3;
        public int HotSpotY = 4;
        public int CopyIconCallCount;
        public int GetIconInfoCallCount;
        public int DrawIconExCallCount;
        public int DestroyIconCallCount;
        public int DeleteObjectCallCount;
        public IntPtr LastCopyIconInput;

        public bool GetCursorInfo(ref NativeCursorInfo cursorInfo)
        {
            if (!GetCursorInfoResult)
            {
                return false;
            }

            cursorInfo.flags = 1;
            cursorInfo.hCursor = CursorHandle;
            return true;
        }

        public IntPtr CopyIcon(IntPtr iconHandle)
        {
            CopyIconCallCount++;
            LastCopyIconInput = iconHandle;
            return CopiedIconHandle;
        }

        public bool GetIconInfo(IntPtr iconHandle, out NativeIconInfo iconInfo)
        {
            GetIconInfoCallCount++;
            iconInfo = new NativeIconInfo();
            iconInfo.xHotspot = HotSpotX;
            iconInfo.yHotspot = HotSpotY;
            iconInfo.hbmColor = ColorBitmapHandle;
            iconInfo.hbmMask = MaskBitmapHandle;
            return GetIconInfoResult;
        }

        public bool DrawIconEx(IntPtr hdc, int xLeft, int yTop, IntPtr iconHandle, int width, int height, int stepIfAniCur, IntPtr flickerFreeBrush, int flags)
        {
            DrawIconExCallCount++;
            return DrawIconExResult;
        }

        public bool DestroyIcon(IntPtr iconHandle)
        {
            DestroyIconCallCount++;
            return true;
        }

        public bool DeleteObject(IntPtr objectHandle)
        {
            DeleteObjectCallCount++;
            return true;
        }

        public int GetObject(IntPtr objectHandle, int bufferSize, out NativeBitmapInfo bitmapInfo)
        {
            bitmapInfo = new NativeBitmapInfo();
            bitmapInfo.bmWidth = BitmapWidth;
            bitmapInfo.bmHeight = BitmapHeight;
            bitmapInfo.bmBitsPixel = 32;
            return Marshal.SizeOf(typeof(NativeBitmapInfo));
        }
    }

    internal sealed class FakeCursorImageProvider : ICursorImageProvider
    {
        private readonly Queue<object> _results = new Queue<object>();
        public int CaptureCallCount;

        public void EnqueueCapture(CursorCapture capture)
        {
            _results.Enqueue(capture);
        }

        public void EnqueueFailure()
        {
            _results.Enqueue(null);
        }

        public void EnqueueException(Exception exception)
        {
            _results.Enqueue(exception);
        }

        public bool TryCapture(out CursorCapture capture)
        {
            CaptureCallCount++;
            if (_results.Count == 0)
            {
                capture = null;
                return false;
            }

            object result = _results.Dequeue();
            Exception exception = result as Exception;
            if (exception != null)
            {
                throw exception;
            }

            capture = result as CursorCapture;
            return capture != null;
        }
    }

    internal sealed class FakeOverlayPresenter : IOverlayPresenter
    {
        public int ShowCount;
        public int MoveCount;
        public int HideCount;
        public int DisposeCount;
        public Point LastLocation;
        public Size LastBitmapSize;

        public void ShowCursor(Bitmap bitmap, Point location)
        {
            ShowCount++;
            LastLocation = location;
            LastBitmapSize = bitmap.Size;
        }

        public void Move(Point location)
        {
            MoveCount++;
            LastLocation = location;
        }

        public void HideOverlay()
        {
            HideCount++;
        }

        public void Dispose()
        {
            DisposeCount++;
        }
    }

    internal sealed class RecordingDispatcher : IUiDispatcher
    {
        private readonly Queue<Action> _actions = new Queue<Action>();

        public bool InvokeRequired
        {
            get { return true; }
        }

        public int PendingCount
        {
            get { return _actions.Count; }
        }

        public void BeginInvoke(Action action)
        {
            _actions.Enqueue(action);
        }

        public void RunNext()
        {
            _actions.Dequeue()();
        }
    }
}
