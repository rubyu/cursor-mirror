using System;
using System.Diagnostics;
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
            suite.Add("COT-MOU-36", PredictionGainSettingControlsProjection);
            suite.Add("COT-MOU-37", PredictionGainSettingControlsDwmProjection);
            suite.Add("COT-MOU-38", DwmPredictionHorizonCapControlsProjection);
            suite.Add("COT-MOU-39", DwmAdaptiveGainControlsFastLinearProjection);
            suite.Add("COT-MOU-40", DwmAdaptiveGainCooldownHoldsBaseGainAfterReversal);
            suite.Add("COT-MOU-41", DwmAdaptiveGainOscillationLatchHoldsBaseGain);
            suite.Add("COT-MOU-42", DwmAdaptiveGainFastLinearOverrideBypassesOscillationLatch);
            suite.Add("COT-MOU-43", DwmLeastSquaresPredictionFitsLinearMotion);
            suite.Add("COT-MOU-45", ScheduledDwmTargetControlsPrediction);
            suite.Add("COT-MOU-46", NearScheduledDwmTargetUsesNextVBlank);
            suite.Add("COT-MOU-47", OverlayUpdateTimingCountersDeadlineMiss);
            suite.Add("COT-MOU-48", DwmPredictionTargetOffsetControlsProjection);
            suite.Add("COT-MOU-49", ConstantVelocityHighSpeedLinearMotionUsesWiderCap);
            suite.Add("COT-MOU-53", DwmSmoothPredictorPredictionIsSelectable);
            suite.Add("COT-MOU-54", DwmSmoothPredictorStaticAndStopGuardsSnapToExactPosition);
            suite.Add("COT-MOU-58", ConstantVelocityHighSpeedSwitchUsesLongWindowAtLowerSpeed);
            suite.Add("COT-MOU-55", PollingSkipsOverlayMoveWhenLocationIsUnchanged);
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
            settings.DwmPredictionModel = CursorMirrorSettings.DwmPredictionModelConstantVelocity;
            settings.DwmPredictionHorizonCapMilliseconds = 0;
            settings.DwmPredictionTargetOffsetMilliseconds = 0;
            provider.EnqueueCapture(new CursorCapture(new IntPtr(1), new Bitmap(16, 16), new Point(0, 0)));
            CursorMirrorController controller = new CursorMirrorController(provider, overlay, new ImmediateDispatcher(), settings, clock, poller);

            controller.UpdateAt(new Point(0, 0));
            poller.EnqueueSample(PollSample(new Point(0, 0), 100, true, 100, 100));
            poller.EnqueueSample(PollSample(new Point(1, 0), 110, true, 100, 100));
            clock.Now = 10;
            controller.Tick();
            clock.Now = 20;
            controller.Tick();

            TestAssert.Equal(new Point(10, 0), overlay.LastLocation, "DWM next-vblank predicted placement");
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

        // Prediction gain setting controls projection [COT-MOU-36]
        private static void PredictionGainSettingControlsProjection()
        {
            FakeCursorImageProvider provider = new FakeCursorImageProvider();
            FakeOverlayPresenter overlay = new FakeOverlayPresenter();
            FakeClock clock = new FakeClock();
            CursorMirrorSettings settings = CursorMirrorSettings.Default();
            settings.PredictionGainPercent = 75;
            provider.EnqueueCapture(new CursorCapture(new IntPtr(1), new Bitmap(16, 16), new Point(2, 3)));
            provider.EnqueueCapture(new CursorCapture(new IntPtr(2), new Bitmap(16, 16), new Point(2, 3)));
            CursorMirrorController controller = new CursorMirrorController(provider, overlay, new ImmediateDispatcher(), settings, clock);

            clock.Now = 0;
            controller.UpdateAt(new Point(10, 10));
            clock.Now = 10;
            controller.UpdateAt(new Point(20, 10));

            TestAssert.Equal(new Point(24, 7), overlay.LastLocation, "75 percent gain scales the fixed-horizon projection");
            controller.Dispose();
        }

        // Prediction gain setting controls DWM projection [COT-MOU-37]
        private static void PredictionGainSettingControlsDwmProjection()
        {
            FakeCursorImageProvider provider = new FakeCursorImageProvider();
            FakeOverlayPresenter overlay = new FakeOverlayPresenter();
            FakeClock clock = new FakeClock();
            FakeCursorPoller poller = new FakeCursorPoller();
            CursorMirrorSettings settings = CursorMirrorSettings.Default();
            settings.DwmPredictionModel = CursorMirrorSettings.DwmPredictionModelConstantVelocity;
            settings.PredictionGainPercent = 75;
            settings.DwmPredictionHorizonCapMilliseconds = 8;
            provider.EnqueueCapture(new CursorCapture(new IntPtr(1), new Bitmap(16, 16), new Point(0, 0)));
            CursorMirrorController controller = new CursorMirrorController(provider, overlay, new ImmediateDispatcher(), settings, clock, poller);

            controller.UpdateAt(new Point(0, 0));
            poller.EnqueueSample(PollSample(new Point(0, 0), 100, true, 100, 100));
            poller.EnqueueSample(PollSample(new Point(10, 0), 110, true, 100, 100));
            clock.Now = 10;
            controller.Tick();
            clock.Now = 20;
            controller.Tick();

            TestAssert.Equal(new Point(16, 0), overlay.LastLocation, "75 percent gain scales the DWM horizon projection");
            controller.Dispose();
        }

        // DWM prediction horizon cap controls projection [COT-MOU-38]
        private static void DwmPredictionHorizonCapControlsProjection()
        {
            FakeCursorImageProvider provider = new FakeCursorImageProvider();
            FakeOverlayPresenter overlay = new FakeOverlayPresenter();
            FakeClock clock = new FakeClock();
            FakeCursorPoller poller = new FakeCursorPoller();
            CursorMirrorSettings settings = CursorMirrorSettings.Default();
            settings.DwmPredictionModel = CursorMirrorSettings.DwmPredictionModelConstantVelocity;
            settings.DwmPredictionHorizonCapMilliseconds = 8;
            provider.EnqueueCapture(new CursorCapture(new IntPtr(1), new Bitmap(16, 16), new Point(0, 0)));
            CursorMirrorController controller = new CursorMirrorController(provider, overlay, new ImmediateDispatcher(), settings, clock, poller);

            controller.UpdateAt(new Point(0, 0));
            poller.EnqueueSample(PollSample(new Point(0, 0), 100, true, 100, 100));
            poller.EnqueueSample(PollSample(new Point(10, 0), 110, true, 100, 100));
            clock.Now = 10;
            controller.Tick();
            controller.Tick();

            TestAssert.Equal(new Point(18, 0), overlay.LastLocation, "DWM horizon cap limits projection");
            controller.Dispose();
        }

        // DWM adaptive gain controls fast linear projection [COT-MOU-39]
        private static void DwmAdaptiveGainControlsFastLinearProjection()
        {
            FakeCursorImageProvider provider = new FakeCursorImageProvider();
            FakeOverlayPresenter overlay = new FakeOverlayPresenter();
            FakeClock clock = new FakeClock();
            FakeCursorPoller poller = new FakeCursorPoller();
            CursorMirrorSettings settings = CursorMirrorSettings.Default();
            settings.DwmPredictionModel = CursorMirrorSettings.DwmPredictionModelConstantVelocity;
            settings.DwmAdaptiveGainEnabled = true;
            settings.DwmAdaptiveGainPercent = 75;
            settings.DwmAdaptiveMinimumSpeedPixelsPerSecond = 1000;
            settings.DwmAdaptiveMaximumAccelerationPixelsPerSecondSquared = 100;
            provider.EnqueueCapture(new CursorCapture(new IntPtr(1), new Bitmap(16, 16), new Point(0, 0)));
            CursorMirrorController controller = new CursorMirrorController(provider, overlay, new ImmediateDispatcher(), settings, clock, poller);

            controller.UpdateAt(new Point(0, 0));
            poller.EnqueueSample(PollSample(new Point(0, 0), 100, true, 110, 16));
            poller.EnqueueSample(PollSample(new Point(12, 0), 110, true, 120, 16));
            poller.EnqueueSample(PollSample(new Point(24, 0), 120, true, 130, 16));
            clock.Now = 10;
            controller.Tick();
            controller.Tick();
            controller.Tick();

            TestAssert.Equal(new Point(33, 0), overlay.LastLocation, "adaptive DWM gain applies to fast linear motion");
            controller.Dispose();
        }

        // DWM adaptive gain reversal cooldown [COT-MOU-40]
        private static void DwmAdaptiveGainCooldownHoldsBaseGainAfterReversal()
        {
            FakeCursorImageProvider provider = new FakeCursorImageProvider();
            FakeOverlayPresenter overlay = new FakeOverlayPresenter();
            FakeClock clock = new FakeClock();
            FakeCursorPoller poller = new FakeCursorPoller();
            CursorMirrorSettings settings = CursorMirrorSettings.Default();
            settings.DwmPredictionModel = CursorMirrorSettings.DwmPredictionModelConstantVelocity;
            settings.DwmPredictionHorizonCapMilliseconds = 0;
            settings.DwmPredictionTargetOffsetMilliseconds = 0;
            settings.DwmAdaptiveGainEnabled = true;
            settings.DwmAdaptiveGainPercent = 75;
            settings.DwmAdaptiveMinimumSpeedPixelsPerSecond = 1000;
            settings.DwmAdaptiveMaximumAccelerationPixelsPerSecondSquared = 1000000;
            settings.DwmAdaptiveReversalCooldownSamples = 2;
            provider.EnqueueCapture(new CursorCapture(new IntPtr(1), new Bitmap(16, 16), new Point(0, 0)));
            CursorMirrorController controller = new CursorMirrorController(provider, overlay, new ImmediateDispatcher(), settings, clock, poller);

            controller.UpdateAt(new Point(0, 0));
            poller.EnqueueSample(PollSample(new Point(0, 0), 100, true, 110, 16));
            poller.EnqueueSample(PollSample(new Point(10, 0), 110, true, 120, 16));
            poller.EnqueueSample(PollSample(new Point(20, 0), 120, true, 130, 16));
            poller.EnqueueSample(PollSample(new Point(10, 0), 130, true, 140, 16));
            poller.EnqueueSample(PollSample(new Point(0, 0), 140, true, 150, 16));
            clock.Now = 10;
            controller.Tick();
            controller.Tick();
            controller.Tick();
            controller.Tick();
            controller.Tick();

            TestAssert.Equal(new Point(-10, 0), overlay.LastLocation, "cooldown keeps base gain immediately after reversal");
            controller.Dispose();
        }

        // DWM adaptive gain oscillation latch [COT-MOU-41]
        private static void DwmAdaptiveGainOscillationLatchHoldsBaseGain()
        {
            FakeCursorImageProvider provider = new FakeCursorImageProvider();
            FakeOverlayPresenter overlay = new FakeOverlayPresenter();
            FakeClock clock = new FakeClock();
            FakeCursorPoller poller = new FakeCursorPoller();
            CursorMirrorSettings settings = CursorMirrorSettings.Default();
            settings.DwmPredictionModel = CursorMirrorSettings.DwmPredictionModelConstantVelocity;
            settings.DwmAdaptiveGainEnabled = true;
            settings.DwmAdaptiveGainPercent = 75;
            settings.DwmAdaptiveMinimumSpeedPixelsPerSecond = 1000;
            settings.DwmAdaptiveMaximumAccelerationPixelsPerSecondSquared = 1000000;
            settings.DwmAdaptiveOscillationWindowSamples = 6;
            settings.DwmAdaptiveOscillationMinimumReversals = 2;
            settings.DwmAdaptiveOscillationMaximumSpanPixels = 100;
            settings.DwmAdaptiveOscillationMaximumEfficiencyPercent = 60;
            settings.DwmAdaptiveOscillationLatchMilliseconds = 300;
            provider.EnqueueCapture(new CursorCapture(new IntPtr(1), new Bitmap(16, 16), new Point(0, 0)));
            CursorMirrorController controller = new CursorMirrorController(provider, overlay, new ImmediateDispatcher(), settings, clock, poller);

            controller.UpdateAt(new Point(0, 0));
            poller.EnqueueSample(PollSample(new Point(0, 0), 100, true, 110, 16));
            poller.EnqueueSample(PollSample(new Point(10, 0), 110, true, 120, 16));
            poller.EnqueueSample(PollSample(new Point(20, 0), 120, true, 130, 16));
            poller.EnqueueSample(PollSample(new Point(10, 0), 130, true, 140, 16));
            poller.EnqueueSample(PollSample(new Point(20, 0), 140, true, 150, 16));
            poller.EnqueueSample(PollSample(new Point(10, 0), 150, true, 160, 16));
            poller.EnqueueSample(PollSample(new Point(0, 0), 160, true, 170, 16));
            clock.Now = 10;
            controller.Tick();
            controller.Tick();
            controller.Tick();
            controller.Tick();
            controller.Tick();
            controller.Tick();
            controller.Tick();

            TestAssert.Equal(new Point(-10, 0), overlay.LastLocation, "oscillation latch keeps base gain after repeated reversals");
            controller.Dispose();
        }

        // DWM adaptive gain fast linear override [COT-MOU-42]
        private static void DwmAdaptiveGainFastLinearOverrideBypassesOscillationLatch()
        {
            FakeCursorImageProvider provider = new FakeCursorImageProvider();
            FakeOverlayPresenter overlay = new FakeOverlayPresenter();
            FakeClock clock = new FakeClock();
            FakeCursorPoller poller = new FakeCursorPoller();
            CursorMirrorSettings settings = CursorMirrorSettings.Default();
            settings.DwmPredictionModel = CursorMirrorSettings.DwmPredictionModelConstantVelocity;
            settings.DwmAdaptiveGainEnabled = true;
            settings.DwmAdaptiveGainPercent = 50;
            settings.DwmAdaptiveMinimumSpeedPixelsPerSecond = 1000;
            settings.DwmAdaptiveMaximumAccelerationPixelsPerSecondSquared = 1000000;
            settings.DwmAdaptiveOscillationWindowSamples = 32;
            settings.DwmAdaptiveOscillationMinimumReversals = 2;
            settings.DwmAdaptiveOscillationMaximumSpanPixels = 100;
            settings.DwmAdaptiveOscillationMaximumEfficiencyPercent = 60;
            settings.DwmAdaptiveOscillationLatchMilliseconds = 300;
            provider.EnqueueCapture(new CursorCapture(new IntPtr(1), new Bitmap(16, 16), new Point(0, 0)));
            CursorMirrorController controller = new CursorMirrorController(provider, overlay, new ImmediateDispatcher(), settings, clock, poller);

            controller.UpdateAt(new Point(0, 0));
            int[] oscillation = new[] { 0, 20, 40, 20, 40, 20, 0 };
            long timestamp = 100;
            for (int i = 0; i < oscillation.Length; i++)
            {
                poller.EnqueueSample(PollSample(new Point(oscillation[i], 0), timestamp, true, timestamp + 10, 16));
                timestamp += 10;
            }

            for (int i = 1; i <= 24; i++)
            {
                poller.EnqueueSample(PollSample(new Point(i * 24, 0), timestamp, true, timestamp + 10, 16));
                timestamp += 10;
            }

            clock.Now = 10;
            for (int i = 0; i < oscillation.Length + 24; i++)
            {
                controller.Tick();
            }

            TestAssert.Equal(new Point(588, 0), overlay.LastLocation, "fast linear override must bypass an active oscillation latch");
            controller.Dispose();
        }

        // DWM least-squares prediction [COT-MOU-43]
        private static void DwmLeastSquaresPredictionFitsLinearMotion()
        {
            FakeCursorImageProvider provider = new FakeCursorImageProvider();
            FakeOverlayPresenter overlay = new FakeOverlayPresenter();
            FakeClock clock = new FakeClock();
            FakeCursorPoller poller = new FakeCursorPoller();
            CursorMirrorSettings settings = CursorMirrorSettings.Default();
            settings.DwmPredictionModel = CursorMirrorSettings.DwmPredictionModelLeastSquares;
            settings.DwmPredictionHorizonCapMilliseconds = 0;
            settings.DwmPredictionTargetOffsetMilliseconds = 0;
            provider.EnqueueCapture(new CursorCapture(new IntPtr(1), new Bitmap(16, 16), new Point(0, 0)));
            CursorMirrorController controller = new CursorMirrorController(provider, overlay, new ImmediateDispatcher(), settings, clock, poller);

            controller.UpdateAt(new Point(0, 0));
            poller.EnqueueSample(PollSample(new Point(0, 0), 100, true, 110, 16));
            poller.EnqueueSample(PollSample(new Point(10, 0), 110, true, 120, 16));
            poller.EnqueueSample(PollSample(new Point(20, 0), 120, true, 130, 16));
            poller.EnqueueSample(PollSample(new Point(30, 0), 130, true, 140, 16));
            poller.EnqueueSample(PollSample(new Point(40, 0), 140, true, 150, 16));
            poller.EnqueueSample(PollSample(new Point(50, 0), 150, true, 160, 16));
            clock.Now = 10;
            controller.Tick();
            controller.Tick();
            controller.Tick();
            controller.Tick();
            controller.Tick();
            controller.Tick();

            TestAssert.Equal(new Point(58, 0), overlay.LastLocation, "least-squares model predicts linear motion with its default horizon cap");
            controller.Dispose();
        }

        // Scheduled DWM target controls prediction horizon [COT-MOU-45]
        private static void ScheduledDwmTargetControlsPrediction()
        {
            FakeCursorImageProvider provider = new FakeCursorImageProvider();
            FakeOverlayPresenter overlay = new FakeOverlayPresenter();
            FakeClock clock = new FakeClock();
            FakeCursorPoller poller = new FakeCursorPoller();
            CursorMirrorSettings settings = CursorMirrorSettings.Default();
            settings.DwmPredictionModel = CursorMirrorSettings.DwmPredictionModelConstantVelocity;
            settings.DwmPredictionTargetOffsetMilliseconds = 0;
            provider.EnqueueCapture(new CursorCapture(new IntPtr(1), new Bitmap(16, 16), new Point(0, 0)));
            CursorMirrorController controller = new CursorMirrorController(provider, overlay, new ImmediateDispatcher(), settings, clock, poller);
            long frequency = Stopwatch.Frequency;
            long oneMillisecond = frequency / 1000;
            long start = Stopwatch.GetTimestamp() + (frequency / 2);
            long refreshPeriod = 16 * oneMillisecond;
            long unrelatedSampleVBlank = start + (100 * oneMillisecond);

            controller.UpdateAt(new Point(0, 0));
            poller.EnqueueSample(PollSample(new Point(0, 0), start, frequency, true, unrelatedSampleVBlank, refreshPeriod));
            poller.EnqueueSample(PollSample(new Point(10, 0), start + (10 * oneMillisecond), frequency, true, unrelatedSampleVBlank, refreshPeriod));
            controller.Tick(start + (16 * oneMillisecond), refreshPeriod);
            controller.Tick(start + (18 * oneMillisecond), refreshPeriod);

            TestAssert.Equal(new Point(18, 0), overlay.LastLocation, "scheduled target vblank must define the prediction horizon");
            TestAssert.Equal(1L, controller.PredictionCounters.ScheduledDwmTargetUsed, "scheduled target counter");
            controller.Dispose();
        }

        // Near scheduled DWM target shifts prediction to the next vblank [COT-MOU-46]
        private static void NearScheduledDwmTargetUsesNextVBlank()
        {
            FakeCursorImageProvider provider = new FakeCursorImageProvider();
            FakeOverlayPresenter overlay = new FakeOverlayPresenter();
            FakeClock clock = new FakeClock();
            FakeCursorPoller poller = new FakeCursorPoller();
            CursorMirrorSettings settings = CursorMirrorSettings.Default();
            settings.DwmPredictionModel = CursorMirrorSettings.DwmPredictionModelConstantVelocity;
            settings.DwmPredictionHorizonCapMilliseconds = 0;
            settings.DwmPredictionTargetOffsetMilliseconds = 0;
            provider.EnqueueCapture(new CursorCapture(new IntPtr(1), new Bitmap(16, 16), new Point(0, 0)));
            CursorMirrorController controller = new CursorMirrorController(provider, overlay, new ImmediateDispatcher(), settings, clock, poller);
            long frequency = Stopwatch.Frequency;
            long oneMillisecond = frequency / 1000;
            long targetVBlank = Stopwatch.GetTimestamp() + MicrosecondsToTicks(100, frequency);
            long refreshPeriod = 16 * oneMillisecond;
            long firstTimestamp = targetVBlank - (12 * oneMillisecond);
            long secondTimestamp = targetVBlank - (2 * oneMillisecond);

            controller.UpdateAt(new Point(0, 0));
            poller.EnqueueSample(PollSample(new Point(0, 0), firstTimestamp, frequency, true, targetVBlank, refreshPeriod));
            poller.EnqueueSample(PollSample(new Point(10, 0), secondTimestamp, frequency, true, targetVBlank, refreshPeriod));
            controller.Tick(0, 0);
            controller.Tick(targetVBlank, refreshPeriod);

            TestAssert.True(overlay.LastLocation.X > 20, "near-deadline target should move the prediction to a later vblank");
            TestAssert.Equal(1L, controller.PredictionCounters.ScheduledDwmTargetAdjustedToNextVBlank, "target adjustment counter");
            controller.Dispose();
        }

        // Overlay update timing counters deadline miss [COT-MOU-47]
        private static void OverlayUpdateTimingCountersDeadlineMiss()
        {
            FakeCursorImageProvider provider = new FakeCursorImageProvider();
            FakeOverlayPresenter overlay = new FakeOverlayPresenter();
            FakeClock clock = new FakeClock();
            FakeCursorPoller poller = new FakeCursorPoller();
            CursorMirrorSettings settings = CursorMirrorSettings.Default();
            settings.PredictionEnabled = false;
            provider.EnqueueCapture(new CursorCapture(new IntPtr(1), new Bitmap(16, 16), new Point(0, 0)));
            CursorMirrorController controller = new CursorMirrorController(provider, overlay, new ImmediateDispatcher(), settings, clock, poller);
            long frequency = Stopwatch.Frequency;
            long targetVBlank = Stopwatch.GetTimestamp() - 1;

            controller.UpdateAt(new Point(0, 0));
            poller.EnqueueSample(PollSample(new Point(5, 0), targetVBlank - (frequency / 100), frequency, false, 0, 0));
            controller.Tick(targetVBlank, 0);

            TestAssert.Equal(new Point(5, 0), overlay.LastLocation, "prediction-disabled scheduled tick still moves overlay");
            TestAssert.Equal(1L, controller.PredictionCounters.OverlayUpdateCompletedAfterTargetVBlank, "missed overlay deadline counter");
            controller.Dispose();
        }

        // DWM prediction target offset controls projection horizon [COT-MOU-48]
        private static void DwmPredictionTargetOffsetControlsProjection()
        {
            FakeCursorImageProvider provider = new FakeCursorImageProvider();
            FakeOverlayPresenter overlay = new FakeOverlayPresenter();
            FakeClock clock = new FakeClock();
            FakeCursorPoller poller = new FakeCursorPoller();
            CursorMirrorSettings settings = CursorMirrorSettings.Default();
            settings.DwmPredictionModel = CursorMirrorSettings.DwmPredictionModelConstantVelocity;
            settings.DwmPredictionTargetOffsetMilliseconds = 4;
            provider.EnqueueCapture(new CursorCapture(new IntPtr(1), new Bitmap(16, 16), new Point(0, 0)));
            CursorMirrorController controller = new CursorMirrorController(provider, overlay, new ImmediateDispatcher(), settings, clock, poller);
            long frequency = Stopwatch.Frequency;
            long oneMillisecond = frequency / 1000;
            long start = Stopwatch.GetTimestamp() + (frequency / 2);
            long refreshPeriod = 16 * oneMillisecond;

            controller.UpdateAt(new Point(0, 0));
            poller.EnqueueSample(PollSample(new Point(0, 0), start, frequency, true, start + (16 * oneMillisecond), refreshPeriod));
            poller.EnqueueSample(PollSample(new Point(10, 0), start + (10 * oneMillisecond), frequency, true, start + (16 * oneMillisecond), refreshPeriod));
            controller.Tick(start + (16 * oneMillisecond), refreshPeriod);
            controller.Tick(start + (16 * oneMillisecond), refreshPeriod);

            TestAssert.Equal(new Point(20, 0), overlay.LastLocation, "target offset extends the DWM prediction horizon");
            controller.Dispose();
        }

        // ConstantVelocity high-speed linear motion uses wider cap [COT-MOU-49]
        private static void ConstantVelocityHighSpeedLinearMotionUsesWiderCap()
        {
            FakeCursorImageProvider provider = new FakeCursorImageProvider();
            FakeOverlayPresenter overlay = new FakeOverlayPresenter();
            FakeClock clock = new FakeClock();
            FakeCursorPoller poller = new FakeCursorPoller();
            CursorMirrorSettings settings = CursorMirrorSettings.Default();
            settings.DwmPredictionModel = CursorMirrorSettings.DwmPredictionModelConstantVelocity;
            provider.EnqueueCapture(new CursorCapture(new IntPtr(1), new Bitmap(16, 16), new Point(0, 0)));
            CursorMirrorController controller = new CursorMirrorController(provider, overlay, new ImmediateDispatcher(), settings, clock, poller);

            controller.UpdateAt(new Point(0, 0));
            long timestamp = 100;
            for (int i = 0; i <= 6; i++)
            {
                poller.EnqueueSample(PollSample(new Point(i * 30, 0), timestamp, true, timestamp + 10, 16));
                timestamp += 10;
            }

            clock.Now = 10;
            for (int i = 0; i <= 6; i++)
            {
                controller.Tick();
            }

            TestAssert.Equal(new Point(204, 0), overlay.LastLocation, "high-speed one-directional motion should use the wider ConstantVelocity cap");
            controller.Dispose();
        }

        // DWM SmoothPredictor prediction [COT-MOU-53]
        private static void DwmSmoothPredictorPredictionIsSelectable()
        {
            CursorMirrorSettings settings = CursorMirrorSettings.Default();
            settings.DwmPredictionModel = CursorMirrorSettings.DwmPredictionModelSmoothPredictor;
            settings.DwmPredictionHorizonCapMilliseconds = 0;
            settings.DwmPredictionTargetOffsetMilliseconds = 0;
            DwmAwareCursorPositionPredictor predictor = new DwmAwareCursorPositionPredictor(100);
            predictor.ApplySettings(settings);
            CursorPredictionCounters counters = new CursorPredictionCounters();
            Point predicted = Point.Empty;

            for (int i = 0; i <= 15; i++)
            {
                long timestamp = 100 + (i * 10);
                CursorPollSample sample = PollSample(new Point(i * 3, 0), timestamp, true, timestamp + 16, 16);
                predicted = predictor.PredictRounded(sample, counters, timestamp + 16, 16);
            }

            TestAssert.Equal(new Point(45, 1), predicted, "SmoothPredictor should be selectable and produce its fixed-weight prediction");
        }

        // DWM SmoothPredictor guards [COT-MOU-54]
        private static void DwmSmoothPredictorStaticAndStopGuardsSnapToExactPosition()
        {
            CursorMirrorSettings settings = CursorMirrorSettings.Default();
            settings.DwmPredictionModel = CursorMirrorSettings.DwmPredictionModelSmoothPredictor;
            settings.DwmPredictionHorizonCapMilliseconds = 0;
            settings.DwmPredictionTargetOffsetMilliseconds = 0;
            DwmAwareCursorPositionPredictor predictor = new DwmAwareCursorPositionPredictor(100);
            predictor.ApplySettings(settings);
            CursorPredictionCounters counters = new CursorPredictionCounters();
            Point predicted = Point.Empty;

            for (int i = 0; i <= 15; i++)
            {
                long timestamp = 100 + (i * 10);
                CursorPollSample sample = PollSample(new Point(40, 20), timestamp, true, timestamp + 16, 16);
                predicted = predictor.PredictRounded(sample, counters, timestamp + 16, 16);
            }

            TestAssert.Equal(new Point(40, 20), predicted, "SmoothPredictor static guard must snap to exact position");

            predictor.Reset();
            for (int i = 0; i <= 15; i++)
            {
                long timestamp = 100 + (i * 10);
                CursorPollSample sample = PollSample(new Point(i * 30, 0), timestamp, true, timestamp + 16, 16);
                predicted = predictor.PredictRounded(sample, counters, timestamp + 16, 16);
            }

            CursorPollSample stopSample = PollSample(new Point(450, 0), 260, true, 276, 16);
            predicted = predictor.PredictRounded(stopSample, counters, 276, 16);

            TestAssert.Equal(new Point(450, 0), predicted, "SmoothPredictor stop latch must snap to exact position after an abrupt stop");
        }

        // ConstantVelocityHighSpeedSwitch lower-speed motion uses the longer CV window [COT-MOU-58]
        private static void ConstantVelocityHighSpeedSwitchUsesLongWindowAtLowerSpeed()
        {
            CursorMirrorSettings settings = CursorMirrorSettings.Default();
            settings.DwmPredictionModel = CursorMirrorSettings.DwmPredictionModelConstantVelocityHighSpeedSwitch;
            settings.DwmPredictionHorizonCapMilliseconds = 0;
            settings.DwmPredictionTargetOffsetMilliseconds = 0;
            DwmAwareCursorPositionPredictor predictor = new DwmAwareCursorPositionPredictor(100);
            predictor.ApplySettings(settings);
            CursorPredictionCounters counters = new CursorPredictionCounters();
            Point predicted = Point.Empty;

            for (int i = 0; i <= 11; i++)
            {
                long timestamp = 100 + (i * 10);
                CursorPollSample sample = PollSample(new Point(i * 2, 0), timestamp, true, timestamp + 16, 16);
                predicted = predictor.PredictRounded(sample, counters, timestamp + 16, 16);
            }

            CursorPollSample deceleratingSample = PollSample(new Point(23, 0), 220, true, 236, 16);
            predicted = predictor.PredictRounded(deceleratingSample, counters, 236, 16);

            TestAssert.Equal(new Point(26, 0), predicted, "lower-speed switch model should use the longer ConstantVelocity window");
        }

        // Same-location polling should not call the layered-window move path [COT-MOU-55]
        private static void PollingSkipsOverlayMoveWhenLocationIsUnchanged()
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
            poller.EnqueueSample(PollSample(new Point(10, 10), 100, false, 0, 0));
            clock.Now = 16;
            controller.Tick();

            TestAssert.Equal(0, overlay.MoveCount, "same overlay location must skip move");

            poller.EnqueueSample(PollSample(new Point(11, 10), 110, false, 0, 0));
            clock.Now = 32;
            controller.Tick();

            TestAssert.Equal(1, overlay.MoveCount, "changed overlay location must move");
            TestAssert.Equal(new Point(9, 7), overlay.LastLocation, "changed overlay location");
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
            return PollSample(position, timestampTicks, 1000, hasDwm, vblankTicks, refreshPeriodTicks);
        }

        private static CursorPollSample PollSample(Point position, long timestampTicks, long stopwatchFrequency, bool hasDwm, long vblankTicks, long refreshPeriodTicks)
        {
            CursorPollSample sample = new CursorPollSample();
            sample.Position = position;
            sample.TimestampTicks = timestampTicks;
            sample.StopwatchFrequency = stopwatchFrequency;
            sample.DwmTimingAvailable = hasDwm;
            sample.DwmVBlankTicks = vblankTicks;
            sample.DwmRefreshPeriodTicks = refreshPeriodTicks;
            return sample;
        }

        private static long MicrosecondsToTicks(int microseconds, long stopwatchFrequency)
        {
            return (long)Math.Round(microseconds * (double)stopwatchFrequency / 1000000.0);
        }
    }
}
