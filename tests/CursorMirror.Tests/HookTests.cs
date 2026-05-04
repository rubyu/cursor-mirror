using System;
using System.Runtime.InteropServices;
using CursorMirror;

namespace CursorMirror.Tests
{
    internal static class HookTests
    {
        public static void AddTo(TestSuite suite)
        {
            suite.Add("COT-MHU-1", InactiveAndActivate);
            suite.Add("COT-MHU-2", DoubleActivateRejected);
            suite.Add("COT-MHU-3", UnhookAndDoubleUnhook);
            suite.Add("COT-MHU-4", DisposeUnhooks);
            suite.Add("COT-MHU-5", MouseMovePassThrough);
            suite.Add("COT-MHU-6", NonMovePassThrough);
            suite.Add("COT-MHU-7", DisposeSuppressesUnhookFailure);
        }

        // Hook inactive and activate [COT-MHU-1]
        private static void InactiveAndActivate()
        {
            FakeWindowsHookNativeMethods nativeMethods = new FakeWindowsHookNativeMethods();
            LowLevelMouseHook hook = new LowLevelMouseHook(delegate { return HookResult.Transfer; }, nativeMethods);

            TestAssert.False(hook.IsActivated, "new hook must be inactive");
            hook.SetHook();

            TestAssert.True(hook.IsActivated, "hook must be active after SetHook");
            TestAssert.Equal(1, nativeMethods.SetHookCallCount, "SetWindowsHookEx call count");
            hook.Dispose();
        }

        // Double activate rejected [COT-MHU-2]
        private static void DoubleActivateRejected()
        {
            FakeWindowsHookNativeMethods nativeMethods = new FakeWindowsHookNativeMethods();
            LowLevelMouseHook hook = new LowLevelMouseHook(delegate { return HookResult.Transfer; }, nativeMethods);
            hook.SetHook();

            TestAssert.Throws<InvalidOperationException>(delegate { hook.SetHook(); }, "double SetHook must fail");
            TestAssert.Equal(1, nativeMethods.SetHookCallCount, "second SetHook must not install another hook");
            hook.Dispose();
        }

        // Unhook and double unhook [COT-MHU-3]
        private static void UnhookAndDoubleUnhook()
        {
            FakeWindowsHookNativeMethods nativeMethods = new FakeWindowsHookNativeMethods();
            LowLevelMouseHook hook = new LowLevelMouseHook(delegate { return HookResult.Transfer; }, nativeMethods);
            hook.SetHook();
            hook.Unhook();

            TestAssert.False(hook.IsActivated, "hook must be inactive after Unhook");
            TestAssert.Equal(1, nativeMethods.UnhookCallCount, "UnhookWindowsHookEx call count");
            TestAssert.Throws<InvalidOperationException>(delegate { hook.Unhook(); }, "double Unhook must fail");
            hook.Dispose();
        }

        // Dispose unhooks [COT-MHU-4]
        private static void DisposeUnhooks()
        {
            FakeWindowsHookNativeMethods nativeMethods = new FakeWindowsHookNativeMethods();
            LowLevelMouseHook hook = new LowLevelMouseHook(delegate { return HookResult.Transfer; }, nativeMethods);
            hook.SetHook();
            hook.Dispose();

            TestAssert.False(hook.IsActivated, "disposed hook must be inactive");
            TestAssert.Equal(1, nativeMethods.UnhookCallCount, "Dispose must unhook once");
        }

        // Dispose suppresses unhook failure [COT-MHU-7]
        private static void DisposeSuppressesUnhookFailure()
        {
            FakeWindowsHookNativeMethods nativeMethods = new FakeWindowsHookNativeMethods();
            nativeMethods.UnhookResult = false;
            LowLevelMouseHook hook = new LowLevelMouseHook(delegate { return HookResult.Transfer; }, nativeMethods);
            hook.SetHook();
            hook.Dispose();

            TestAssert.False(hook.IsActivated, "disposed hook must be inactive after unhook failure");
            TestAssert.Equal(1, nativeMethods.UnhookCallCount, "Dispose must attempt unhook once");
        }

        // Mouse move pass-through [COT-MHU-5]
        private static void MouseMovePassThrough()
        {
            FakeWindowsHookNativeMethods nativeMethods = new FakeWindowsHookNativeMethods();
            LowLevelMouseHook.MouseEvent actualEvent = 0;
            LowLevelMouseHook.MSLLHOOKSTRUCT actualData = new LowLevelMouseHook.MSLLHOOKSTRUCT();
            LowLevelMouseHook hook = new LowLevelMouseHook(
                delegate(LowLevelMouseHook.MouseEvent mouseEvent, LowLevelMouseHook.MSLLHOOKSTRUCT data)
                {
                    actualEvent = mouseEvent;
                    actualData = data;
                    return HookResult.Transfer;
                },
                nativeMethods);

            hook.SetHook();
            LowLevelMouseHook.MSLLHOOKSTRUCT dataToSend = new LowLevelMouseHook.MSLLHOOKSTRUCT();
            dataToSend.pt.x = 12;
            dataToSend.pt.y = -7;

            IntPtr dataPointer = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(LowLevelMouseHook.MSLLHOOKSTRUCT)));
            try
            {
                Marshal.StructureToPtr(dataToSend, dataPointer, false);
                IntPtr result = nativeMethods.Callback(WindowsHook.HC_ACTION, new IntPtr((int)LowLevelMouseHook.MouseEvent.WM_MOUSEMOVE), dataPointer);

                TestAssert.Equal(nativeMethods.NextResult, result, "mouse move callback must return CallNextHookEx result");
                TestAssert.Equal(1, nativeMethods.CallNextCallCount, "mouse move callback must call next hook");
                TestAssert.Equal(LowLevelMouseHook.MouseEvent.WM_MOUSEMOVE, actualEvent, "mouse event");
                TestAssert.Equal(12, actualData.pt.x, "mouse x");
                TestAssert.Equal(-7, actualData.pt.y, "mouse y");
            }
            finally
            {
                Marshal.FreeHGlobal(dataPointer);
                hook.Dispose();
            }
        }

        // Non-move pass-through [COT-MHU-6]
        private static void NonMovePassThrough()
        {
            FakeCursorImageProvider provider = new FakeCursorImageProvider();
            FakeOverlayPresenter overlay = new FakeOverlayPresenter();
            CursorMirrorController controller = new CursorMirrorController(provider, overlay, new ImmediateDispatcher());
            LowLevelMouseHook.MSLLHOOKSTRUCT data = new LowLevelMouseHook.MSLLHOOKSTRUCT();

            HookResult result = controller.HandleMouseEvent(LowLevelMouseHook.MouseEvent.WM_LBUTTONDOWN, data);

            TestAssert.Equal(HookResult.Transfer, result, "non-move event must transfer");
            TestAssert.Equal(0, provider.CaptureCallCount, "non-move event must not capture cursor");
            controller.Dispose();
        }
    }
}
