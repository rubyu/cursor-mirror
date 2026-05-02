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
            suite.Add("COT-MOU-13", PredictionDisabledExactPositioning);
            suite.Add("COT-MOU-18", PredictionResetOnHide);
            suite.Add("COT-MOU-19", PredictionThenHotSpotPlacement);
            suite.Add("COT-MOU-20", PollingMovesOverlayWithoutCapture);
            suite.Add("COT-MOU-21", PollingDwmNextVBlankPrediction);
            suite.Add("COT-MOU-22", PollingNoDwmFallsBackToExactPosition);
            suite.Add("COT-MOU-28", HookImageRefreshSkipsSameCursorHandle);
            suite.Add("COT-MOU-29", PollingIgnoresStaleSamples);
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

        // Prediction disabled exact positioning [COT-MOU-13]
        private static void PredictionDisabledExactPositioning()
        {
            FakeCursorImageProvider provider = new FakeCursorImageProvider();
            FakeOverlayPresenter overlay = new FakeOverlayPresenter();
            FakeClock clock = new FakeClock();
            CursorMirrorSettings settings = CursorMirrorSettings.Default();
            settings.PredictionEnabled = false;
            provider.EnqueueCapture(new CursorCapture(new IntPtr(1), new Bitmap(16, 16), new Point(2, 3)));
            provider.EnqueueCapture(new CursorCapture(new IntPtr(2), new Bitmap(16, 16), new Point(2, 3)));
            CursorMirrorController controller = new CursorMirrorController(provider, overlay, new ImmediateDispatcher(), settings, clock);

            clock.Now = 0;
            controller.UpdateAt(new Point(10, 10));
            clock.Now = 10;
            controller.UpdateAt(new Point(20, 10));

            TestAssert.Equal(new Point(18, 7), overlay.LastLocation, "disabled prediction uses exact position");
            controller.Dispose();
        }

        // Prediction reset paths [COT-MOU-18]
        private static void PredictionResetOnHide()
        {
            FakeCursorImageProvider provider = new FakeCursorImageProvider();
            FakeOverlayPresenter overlay = new FakeOverlayPresenter();
            FakeClock clock = new FakeClock();
            CursorMirrorSettings settings = CursorMirrorSettings.Default();
            provider.EnqueueCapture(new CursorCapture(new IntPtr(1), new Bitmap(16, 16), new Point(0, 0)));
            provider.EnqueueCapture(new CursorCapture(new IntPtr(2), new Bitmap(16, 16), new Point(0, 0)));
            provider.EnqueueCapture(new CursorCapture(new IntPtr(3), new Bitmap(16, 16), new Point(0, 0)));
            CursorMirrorController controller = new CursorMirrorController(provider, overlay, new ImmediateDispatcher(), settings, clock);

            clock.Now = 0;
            controller.UpdateAt(new Point(0, 0));
            clock.Now = 10;
            controller.UpdateAt(new Point(10, 0));
            TestAssert.Equal(new Point(18, 0), overlay.LastLocation, "prediction before hide");

            controller.Hide();
            clock.Now = 20;
            controller.UpdateAt(new Point(20, 0));

            TestAssert.Equal(new Point(20, 0), overlay.LastLocation, "hide reset must clear velocity");
            controller.Dispose();
        }

        // Prediction then hot spot placement [COT-MOU-19]
        private static void PredictionThenHotSpotPlacement()
        {
            FakeCursorImageProvider provider = new FakeCursorImageProvider();
            FakeOverlayPresenter overlay = new FakeOverlayPresenter();
            FakeClock clock = new FakeClock();
            CursorMirrorSettings settings = CursorMirrorSettings.Default();
            provider.EnqueueCapture(new CursorCapture(new IntPtr(1), new Bitmap(16, 16), new Point(2, 3)));
            provider.EnqueueCapture(new CursorCapture(new IntPtr(2), new Bitmap(16, 16), new Point(2, 3)));
            CursorMirrorController controller = new CursorMirrorController(provider, overlay, new ImmediateDispatcher(), settings, clock);

            clock.Now = 0;
            controller.UpdateAt(new Point(10, 10));
            clock.Now = 10;
            controller.UpdateAt(new Point(20, 10));

            TestAssert.Equal(new Point(26, 7), overlay.LastLocation, "predicted pointer then hot spot");
            controller.Dispose();
        }

        // Polling moves overlay without cursor capture [COT-MOU-20]
        private static void PollingMovesOverlayWithoutCapture()
        {
            FakeCursorImageProvider provider = new FakeCursorImageProvider();
            FakeOverlayPresenter overlay = new FakeOverlayPresenter();
            FakeClock clock = new FakeClock();
            FakeCursorPoller poller = new FakeCursorPoller();
            CursorMirrorSettings settings = CursorMirrorSettings.Default();
            settings.PredictionEnabled = false;
            provider.EnqueueCapture(new CursorCapture(new IntPtr(1), new Bitmap(16, 16), new Point(2, 3)));
            CursorMirrorController controller = new CursorMirrorController(provider, overlay, new ImmediateDispatcher(), settings, clock, poller);

            controller.UpdateAt(new Point(10, 10));
            poller.EnqueueSample(PollSample(new Point(20, 10), 100, false, 0, 0));
            clock.Now = 16;
            controller.Tick();

            TestAssert.Equal(1, provider.CaptureCallCount, "poll tick must not capture cursor image");
            TestAssert.Equal(1, overlay.ShowCount, "initial image show count");
            TestAssert.Equal(1, overlay.MoveCount, "poll tick move count");
            TestAssert.Equal(new Point(18, 7), overlay.LastLocation, "poll tick exact placement");
            controller.Dispose();
        }

        // Polling DWM next-vblank prediction [COT-MOU-21]
        private static void PollingDwmNextVBlankPrediction()
        {
            FakeCursorImageProvider provider = new FakeCursorImageProvider();
            FakeOverlayPresenter overlay = new FakeOverlayPresenter();
            FakeClock clock = new FakeClock();
            FakeCursorPoller poller = new FakeCursorPoller();
            CursorMirrorSettings settings = CursorMirrorSettings.Default();
            provider.EnqueueCapture(new CursorCapture(new IntPtr(1), new Bitmap(16, 16), new Point(0, 0)));
            CursorMirrorController controller = new CursorMirrorController(provider, overlay, new ImmediateDispatcher(), settings, clock, poller);

            controller.UpdateAt(new Point(0, 0));
            poller.EnqueueSample(PollSample(new Point(0, 0), 100, true, 100, 100));
            poller.EnqueueSample(PollSample(new Point(10, 0), 110, true, 100, 100));
            clock.Now = 10;
            controller.Tick();
            clock.Now = 20;
            controller.Tick();

            TestAssert.Equal(new Point(78, 0), overlay.LastLocation, "DWM next-vblank predicted placement");
            TestAssert.Equal(1L, controller.PredictionCounters.LateDwmHorizon, "late DWM horizon counter");
            controller.Dispose();
        }

        // Polling without DWM falls back to exact position [COT-MOU-22]
        private static void PollingNoDwmFallsBackToExactPosition()
        {
            FakeCursorImageProvider provider = new FakeCursorImageProvider();
            FakeOverlayPresenter overlay = new FakeOverlayPresenter();
            FakeClock clock = new FakeClock();
            FakeCursorPoller poller = new FakeCursorPoller();
            CursorMirrorSettings settings = CursorMirrorSettings.Default();
            provider.EnqueueCapture(new CursorCapture(new IntPtr(1), new Bitmap(16, 16), new Point(0, 0)));
            CursorMirrorController controller = new CursorMirrorController(provider, overlay, new ImmediateDispatcher(), settings, clock, poller);

            controller.UpdateAt(new Point(0, 0));
            poller.EnqueueSample(PollSample(new Point(0, 0), 100, false, 0, 0));
            poller.EnqueueSample(PollSample(new Point(10, 0), 110, false, 0, 0));
            clock.Now = 10;
            controller.Tick();
            clock.Now = 20;
            controller.Tick();

            TestAssert.Equal(new Point(10, 0), overlay.LastLocation, "missing DWM timing exact placement");
            TestAssert.Equal(1L, controller.PredictionCounters.InvalidDwmHorizon, "invalid DWM horizon counter");
            TestAssert.Equal(1L, controller.PredictionCounters.FallbackToHold, "fallback counter");
            controller.Dispose();
        }

        // Hook image refresh skips unchanged cursor handles [COT-MOU-28]
        private static void HookImageRefreshSkipsSameCursorHandle()
        {
            FakeCursorImageProvider provider = new FakeCursorImageProvider();
            FakeOverlayPresenter overlay = new FakeOverlayPresenter();
            FakeClock clock = new FakeClock();
            provider.EnqueueCapture(new CursorCapture(new IntPtr(1), new Bitmap(16, 16), new Point(0, 0)));
            CursorMirrorController controller = new CursorMirrorController(provider, overlay, new ImmediateDispatcher(), CursorMirrorSettings.Default(), clock);

            clock.Now = 0;
            controller.UpdateAt(new Point(10, 10));
            clock.Now = 10;
            LowLevelMouseHook.MSLLHOOKSTRUCT data = new LowLevelMouseHook.MSLLHOOKSTRUCT();
            data.pt.x = 20;
            data.pt.y = 20;
            controller.HandleMouseEvent(LowLevelMouseHook.MouseEvent.WM_MOUSEMOVE, data);

            TestAssert.Equal(1, provider.CaptureCallCount, "unchanged cursor handle should not recapture inside refresh interval");
            TestAssert.Equal(1, overlay.ShowCount, "unchanged cursor handle should not redraw image");
            controller.Dispose();
        }

        // Polling ignores stale samples [COT-MOU-29]
        private static void PollingIgnoresStaleSamples()
        {
            FakeCursorImageProvider provider = new FakeCursorImageProvider();
            FakeOverlayPresenter overlay = new FakeOverlayPresenter();
            FakeClock clock = new FakeClock();
            FakeCursorPoller poller = new FakeCursorPoller();
            CursorMirrorSettings settings = CursorMirrorSettings.Default();
            settings.PredictionEnabled = false;
            provider.EnqueueCapture(new CursorCapture(new IntPtr(1), new Bitmap(16, 16), new Point(0, 0)));
            CursorMirrorController controller = new CursorMirrorController(provider, overlay, new ImmediateDispatcher(), settings, clock, poller);

            controller.UpdateAt(new Point(0, 0));
            poller.EnqueueSample(PollSample(new Point(10, 0), 100, false, 0, 0));
            poller.EnqueueSample(PollSample(new Point(20, 0), 90, false, 0, 0));
            clock.Now = 10;
            controller.Tick();
            clock.Now = 20;
            controller.Tick();

            TestAssert.Equal(new Point(10, 0), overlay.LastLocation, "stale poll sample must not move overlay");
            TestAssert.Equal(1L, controller.PredictionCounters.StalePollSamples, "stale sample counter");
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

        private static CursorPollSample PollSample(Point position, long timestampTicks, bool hasDwm, long vblankTicks, long refreshPeriodTicks)
        {
            CursorPollSample sample = new CursorPollSample();
            sample.Position = position;
            sample.TimestampTicks = timestampTicks;
            sample.StopwatchFrequency = 1000;
            sample.DwmTimingAvailable = hasDwm;
            sample.DwmVBlankTicks = vblankTicks;
            sample.DwmRefreshPeriodTicks = refreshPeriodTicks;
            return sample;
        }
    }
}
