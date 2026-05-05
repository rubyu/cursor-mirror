using System.Drawing;
using CursorMirror;

namespace CursorMirror.Tests
{
    internal static class MovementOpacityControllerTests
    {
        public static void AddTo(TestSuite suite)
        {
            suite.Add("COT-MOU-5", DefaultEnabled);
            suite.Add("COT-MOU-6", DisabledKeepsNormalOpacity);
            suite.Add("COT-MOU-7", MovementEnterTransition);
            suite.Add("COT-MOU-8", MovementContinuation);
            suite.Add("COT-MOU-9", IdleExitTransition);
            suite.Add("COT-MOU-10", LinearEasing);
            suite.Add("COT-MOU-11", ZeroDurationTransition);
            suite.Add("COT-MOU-12", OpacityDoesNotAffectPlacement);
            suite.Add("COT-MOU-26", IdleFadeAfterStop);
            suite.Add("COT-MOU-27", MovementRestoresOpacityFromIdleFade);
            suite.Add("COT-MOU-57", IdleFadeUsesDedicatedDuration);
        }

        // Movement translucency default enabled [COT-MOU-5]
        private static void DefaultEnabled()
        {
            CursorMirrorSettings settings = CursorMirrorSettings.Default();

            TestAssert.True(settings.MovementTranslucencyEnabled, "movement translucency default");
        }

        // Movement translucency disabled [COT-MOU-6]
        private static void DisabledKeepsNormalOpacity()
        {
            CursorMirrorSettings settings = TestSettings();
            settings.MovementTranslucencyEnabled = false;
            MovementOpacityController controller = new MovementOpacityController(settings);

            controller.RecordMovement(0);

            TestAssert.Equal(100, controller.GetOpacityPercent(0), "disabled opacity at movement");
            TestAssert.Equal(100, controller.GetOpacityPercent(1000), "disabled opacity after time");
        }

        // Movement enter transition [COT-MOU-7]
        private static void MovementEnterTransition()
        {
            MovementOpacityController controller = new MovementOpacityController(TestSettings());

            controller.RecordMovement(0);

            TestAssert.Equal(100, controller.GetOpacityPercent(0), "enter start opacity");
            TestAssert.Equal(75, controller.GetOpacityPercent(50), "enter half opacity");
            TestAssert.Equal(50, controller.GetOpacityPercent(100), "enter target opacity");
        }

        // Movement continuation [COT-MOU-8]
        private static void MovementContinuation()
        {
            MovementOpacityController controller = new MovementOpacityController(TestSettings());

            controller.RecordMovement(0);
            controller.RecordMovement(80);

            TestAssert.Equal(50, controller.GetOpacityPercent(179), "continued movement keeps moving opacity");
            TestAssert.Equal(75, controller.GetOpacityPercent(230), "exit starts after refreshed idle delay");
        }

        // Idle exit transition [COT-MOU-9]
        private static void IdleExitTransition()
        {
            MovementOpacityController controller = new MovementOpacityController(TestSettings());

            controller.RecordMovement(0);

            TestAssert.Equal(50, controller.GetOpacityPercent(99), "before idle exit");
            TestAssert.Equal(50, controller.GetOpacityPercent(100), "exit start opacity");
            TestAssert.Equal(75, controller.GetOpacityPercent(150), "exit half opacity");
            TestAssert.Equal(100, controller.GetOpacityPercent(200), "exit target opacity");
        }

        // Linear easing [COT-MOU-10]
        private static void LinearEasing()
        {
            CursorMirrorSettings settings = TestSettings();
            settings.MovingOpacityPercent = 40;
            settings.FadeDurationMilliseconds = 120;
            settings.IdleDelayMilliseconds = 200;
            MovementOpacityController controller = new MovementOpacityController(settings);

            controller.RecordMovement(0);

            TestAssert.Equal(85, controller.GetOpacityPercent(30), "linear enter first quarter");
            TestAssert.Equal(70, controller.GetOpacityPercent(60), "linear enter half");
            TestAssert.Equal(55, controller.GetOpacityPercent(90), "linear enter third quarter");
            TestAssert.Equal(55, controller.GetOpacityPercent(230), "linear exit first quarter");
            TestAssert.Equal(70, controller.GetOpacityPercent(260), "linear exit half");
            TestAssert.Equal(85, controller.GetOpacityPercent(290), "linear exit third quarter");
        }

        // Zero-duration opacity transition [COT-MOU-11]
        private static void ZeroDurationTransition()
        {
            CursorMirrorSettings settings = TestSettings();
            settings.FadeDurationMilliseconds = 0;
            MovementOpacityController controller = new MovementOpacityController(settings);

            controller.RecordMovement(0);

            TestAssert.Equal(50, controller.GetOpacityPercent(0), "zero-duration enter");
            TestAssert.Equal(100, controller.GetOpacityPercent(100), "zero-duration exit");
        }

        // Opacity does not affect placement [COT-MOU-12]
        private static void OpacityDoesNotAffectPlacement()
        {
            FakeCursorImageProvider provider = new FakeCursorImageProvider();
            FakeOverlayPresenter overlay = new FakeOverlayPresenter();
            FakeClock clock = new FakeClock();
            CursorMirrorSettings settings = TestSettings();
            CursorCapture capture = new CursorCapture(new System.IntPtr(1), new Bitmap(16, 16), new Point(3, 4));
            provider.EnqueueCapture(capture);
            CursorMirrorController controller = new CursorMirrorController(provider, overlay, new ImmediateDispatcher(), settings, clock);

            controller.UpdateAt(new Point(30, 40));
            clock.Now = 50;
            controller.Tick();

            TestAssert.Equal(new Point(27, 36), overlay.LastLocation, "overlay placement after opacity change");
            TestAssert.Equal(1, overlay.ShowCount, "opacity tick must not redraw through capture path");
            TestAssert.True(overlay.SetOpacityCount >= 2, "opacity must be applied through overlay boundary");
            controller.Dispose();
        }

        // Idle fade after stopped pointer [COT-MOU-26]
        private static void IdleFadeAfterStop()
        {
            CursorMirrorSettings settings = TestSettings();
            settings.IdleFadeEnabled = true;
            settings.IdleFadeDurationMilliseconds = 100;
            settings.IdleFadeDelayMilliseconds = 3000;
            settings.IdleOpacityPercent = 0;
            MovementOpacityController controller = new MovementOpacityController(settings);

            controller.RecordMovement(0);

            TestAssert.Equal(100, controller.GetOpacityPercent(2999), "before idle fade");
            TestAssert.Equal(100, controller.GetOpacityPercent(3000), "idle fade start opacity");
            TestAssert.Equal(50, controller.GetOpacityPercent(3050), "idle fade half opacity");
            TestAssert.Equal(0, controller.GetOpacityPercent(3100), "idle fade target opacity");
        }

        // Movement restores opacity from idle fade [COT-MOU-27]
        private static void MovementRestoresOpacityFromIdleFade()
        {
            CursorMirrorSettings settings = TestSettings();
            settings.IdleFadeEnabled = true;
            settings.IdleFadeDurationMilliseconds = 100;
            settings.IdleFadeDelayMilliseconds = 3000;
            settings.IdleOpacityPercent = 0;
            MovementOpacityController controller = new MovementOpacityController(settings);

            controller.RecordMovement(0);
            TestAssert.Equal(0, controller.GetOpacityPercent(3100), "idle fade target before movement");

            controller.RecordMovement(3200);

            TestAssert.Equal(0, controller.GetOpacityPercent(3200), "restore start opacity");
            TestAssert.Equal(25, controller.GetOpacityPercent(3250), "restore half opacity");
            TestAssert.Equal(50, controller.GetOpacityPercent(3300), "restore moving opacity");
        }

        // Idle fade uses a dedicated duration [COT-MOU-57]
        private static void IdleFadeUsesDedicatedDuration()
        {
            CursorMirrorSettings settings = TestSettings();
            settings.FadeDurationMilliseconds = 100;
            settings.IdleFadeEnabled = true;
            settings.IdleFadeDurationMilliseconds = 200;
            settings.IdleFadeDelayMilliseconds = 3000;
            settings.IdleOpacityPercent = 0;
            MovementOpacityController controller = new MovementOpacityController(settings);

            controller.RecordMovement(0);

            TestAssert.Equal(50, controller.GetOpacityPercent(3100), "idle fade uses dedicated midpoint");
            TestAssert.Equal(0, controller.GetOpacityPercent(3200), "idle fade uses dedicated target time");
        }

        private static CursorMirrorSettings TestSettings()
        {
            CursorMirrorSettings settings = CursorMirrorSettings.Default();
            settings.MovingOpacityPercent = 50;
            settings.FadeDurationMilliseconds = 100;
            settings.IdleDelayMilliseconds = 100;
            settings.IdleFadeEnabled = false;
            return settings;
        }
    }
}
