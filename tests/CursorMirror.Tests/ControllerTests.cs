using System;
using System.Drawing;
using CursorMirror;

namespace CursorMirror.Tests
{
    internal static class ControllerTests
    {
        public static void AddTo(TestSuite suite)
        {
            suite.Add("COT-MOU-2", HotSpotAlignmentCalculation);
            suite.Add("COT-MDU-1", NegativeCoordinates);
            suite.Add("COT-MOU-3", LargeCursorSize);
            suite.Add("COT-MRU-1", HookCallbackExceptionContainment);
            suite.Add("COT-MDU-3", DispatcherMarshalsToUiThread);
        }

        // Hot spot alignment calculation [COT-MOU-2]
        private static void HotSpotAlignmentCalculation()
        {
            Point location = OverlayPlacement.FromPointerAndHotSpot(new Point(100, 80), new Point(7, 9));

            TestAssert.Equal(new Point(93, 71), location, "overlay location");
        }

        // Negative coordinates [COT-MDU-1]
        private static void NegativeCoordinates()
        {
            Point location = OverlayPlacement.FromPointerAndHotSpot(new Point(-20, -30), new Point(5, 6));

            TestAssert.Equal(new Point(-25, -36), location, "negative overlay location");
        }

        // Large cursor size [COT-MOU-3]
        private static void LargeCursorSize()
        {
            FakeCursorImageProvider provider = new FakeCursorImageProvider();
            FakeOverlayPresenter overlay = new FakeOverlayPresenter();
            CursorCapture capture = new CursorCapture(new IntPtr(1), new Bitmap(96, 64), new Point(10, 12));
            provider.EnqueueCapture(capture);
            CursorMirrorController controller = new CursorMirrorController(provider, overlay, new ImmediateDispatcher());

            controller.UpdateAt(new Point(30, 40));

            TestAssert.Equal(1, overlay.ShowCount, "overlay show count");
            TestAssert.Equal(new Size(96, 64), overlay.LastBitmapSize, "overlay must receive actual cursor image size");
            TestAssert.Equal(new Point(20, 28), overlay.LastLocation, "overlay location");
            TestAssert.True(capture.Bitmap == null, "capture bitmap must be disposed after update");
            controller.Dispose();
        }

        // Hook callback exception containment [COT-MRU-1]
        private static void HookCallbackExceptionContainment()
        {
            FakeCursorImageProvider provider = new FakeCursorImageProvider();
            provider.EnqueueException(new InvalidOperationException("boom"));
            FakeOverlayPresenter overlay = new FakeOverlayPresenter();
            CursorMirrorController controller = new CursorMirrorController(provider, overlay, new ImmediateDispatcher());
            LowLevelMouseHook.MSLLHOOKSTRUCT data = new LowLevelMouseHook.MSLLHOOKSTRUCT();
            data.pt.x = 1;
            data.pt.y = 2;

            HookResult result = controller.HandleMouseEvent(LowLevelMouseHook.MouseEvent.WM_MOUSEMOVE, data);

            TestAssert.Equal(HookResult.Transfer, result, "callback must transfer even when update fails");
            TestAssert.Equal(0, overlay.ShowCount, "overlay must not update on failure");
            controller.Dispose();
        }

        // DPI coordinate-space consistency [COT-MDU-3]
        private static void DispatcherMarshalsToUiThread()
        {
            FakeCursorImageProvider provider = new FakeCursorImageProvider();
            FakeOverlayPresenter overlay = new FakeOverlayPresenter();
            RecordingDispatcher dispatcher = new RecordingDispatcher();
            provider.EnqueueCapture(new CursorCapture(new IntPtr(2), new Bitmap(16, 16), new Point(1, 1)));
            CursorMirrorController controller = new CursorMirrorController(provider, overlay, dispatcher);
            LowLevelMouseHook.MSLLHOOKSTRUCT data = new LowLevelMouseHook.MSLLHOOKSTRUCT();
            data.pt.x = 9;
            data.pt.y = 10;

            controller.HandleMouseEvent(LowLevelMouseHook.MouseEvent.WM_MOUSEMOVE, data);

            TestAssert.Equal(1, dispatcher.PendingCount, "update must be queued to dispatcher");
            TestAssert.Equal(0, overlay.ShowCount, "overlay must not update before dispatcher runs");
            dispatcher.RunNext();
            TestAssert.Equal(1, overlay.ShowCount, "overlay must update after dispatcher runs");
            TestAssert.Equal(new Point(8, 9), overlay.LastLocation, "marshaled overlay location");
            controller.Dispose();
        }
    }
}
