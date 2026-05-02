using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace CursorMirror.Demo
{
    public sealed class DemoSceneControl : Control
    {
        private const int TimerIntervalMilliseconds = 8;
        private readonly Stopwatch _stopwatch = new Stopwatch();
        private readonly Timer _timer;
        private DemoPointerSpeed _speed;
        private DemoPointerStream _stream;
        private DemoCursorDriver _cursorDriver;
        private DemoFreeModeController _modeController;
        private LowLevelMouseHook _mouseHook;
        private OverlayWindow _overlayWindow;
        private CursorMirrorController _mirrorController;
        private Rectangle _movementBoundsClient;
        private Rectangle _movementBoundsScreen;
        private long _autoStartMilliseconds;
        private int _sentMoveCount;
        private bool _mirrorCursorEnabled;
        private bool _running;

        public DemoSceneControl()
        {
            DoubleBuffered = true;
            BackColor = Color.White;
            ForeColor = Color.FromArgb(24, 28, 36);
            TabStop = true;
            SetStyle(ControlStyles.ResizeRedraw, true);

            _timer = new Timer();
            _timer.Interval = TimerIntervalMilliseconds;
            _timer.Tick += delegate { TickDemo(); };
        }

        public void StartDemo(DemoPointerSpeed speed, CursorMirrorSettings settings, bool mirrorCursorEnabled)
        {
            if (settings == null)
            {
                throw new ArgumentNullException("settings");
            }

            StopDemo();
            _speed = speed;
            _mirrorCursorEnabled = mirrorCursorEnabled;
            _cursorDriver = new DemoCursorDriver();
            _modeController = new DemoFreeModeController();
            if (mirrorCursorEnabled)
            {
                _overlayWindow = new OverlayWindow();
                _mirrorController = new CursorMirrorController(
                    new CursorImageProvider(),
                    _overlayWindow,
                    new ControlDispatcher(_overlayWindow),
                    settings,
                    new SystemClock(),
                    new CursorPoller());
            }

            _mouseHook = new LowLevelMouseHook(HandleMouseEvent);
            _mouseHook.SetHook();
            _stopwatch.Restart();
            _running = true;
            _sentMoveCount = 0;
            RestartAutoPath(0);
            MoveCursorForAutoMode(0);
            _timer.Start();
            Focus();
        }

        public void StopDemo()
        {
            _timer.Stop();
            _running = false;
            _stopwatch.Reset();

            if (_mouseHook != null)
            {
                try
                {
                    if (_mouseHook.IsActivated)
                    {
                        _mouseHook.Unhook();
                    }
                }
                catch (Win32Exception)
                {
                }
                finally
                {
                    _mouseHook.Dispose();
                    _mouseHook = null;
                }
            }

            _stream = null;
            _cursorDriver = null;
            _modeController = null;
            _mirrorCursorEnabled = false;

            if (_mirrorController != null)
            {
                _mirrorController.Dispose();
                _mirrorController = null;
            }
            else if (_overlayWindow != null)
            {
                _overlayWindow.Dispose();
            }

            _overlayWindow = null;
            Invalidate();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                StopDemo();
                _timer.Dispose();
            }

            base.Dispose(disposing);
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            UpdateMovementBounds();
            if (_running && _modeController != null && _modeController.IsAuto)
            {
                RestartAutoPath(CurrentMilliseconds());
            }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            Graphics graphics = e.Graphics;
            graphics.SmoothingMode = SmoothingMode.AntiAlias;
            DrawTrack(graphics);
            DrawStatus(graphics);
        }

        private HookResult HandleMouseEvent(LowLevelMouseHook.MouseEvent mouseEvent, LowLevelMouseHook.MSLLHOOKSTRUCT data)
        {
            if (_mirrorController != null)
            {
                _mirrorController.HandleMouseEvent(mouseEvent, data);
            }

            bool isDemoInjected = data.dwExtraInfo == DemoCursorDriver.InjectionExtraInfo;
            if (isDemoInjected)
            {
                return HookResult.Transfer;
            }

            if (_modeController != null && IsPointerControlEvent(mouseEvent))
            {
                _modeController.RecordExternalInput(CurrentMilliseconds());
            }

            return HookResult.Transfer;
        }

        private void TickDemo()
        {
            if (!_running || _cursorDriver == null || _modeController == null)
            {
                return;
            }

            long now = CurrentMilliseconds();
            if (_modeController.Tick(now))
            {
                RestartAutoPath(now);
            }

            if (_modeController.IsAuto)
            {
                MoveCursorForAutoMode(now);
            }

            if (_mirrorController != null)
            {
                _mirrorController.Tick();
            }

            Invalidate();
        }

        private void MoveCursorForAutoMode(long nowMilliseconds)
        {
            if (_stream == null)
            {
                RestartAutoPath(nowMilliseconds);
            }

            double pathMilliseconds = Math.Max(0, nowMilliseconds - _autoStartMilliseconds);
            DemoPointerSample sample = _stream.GetSample(pathMilliseconds);
            _cursorDriver.MoveTo(sample.Position);
            _sentMoveCount++;
        }

        private void RestartAutoPath(long nowMilliseconds)
        {
            UpdateMovementBounds();
            _stream = new DemoPointerStream(_movementBoundsScreen, _speed);
            _autoStartMilliseconds = nowMilliseconds;
            _modeController.StartAuto();
        }

        private void UpdateMovementBounds()
        {
            int width = Math.Max(1, ClientSize.Width);
            int height = Math.Max(1, ClientSize.Height);
            int margin = Math.Max(80, width / 10);
            int trackHeight = Math.Max(120, height / 3);
            int top = Math.Max(60, (height - trackHeight) / 2);
            _movementBoundsClient = new Rectangle(margin, top, Math.Max(1, width - (margin * 2)), trackHeight);

            Point screenTopLeft = PointToScreen(_movementBoundsClient.Location);
            _movementBoundsScreen = new Rectangle(screenTopLeft, _movementBoundsClient.Size);
        }

        private void DrawTrack(Graphics graphics)
        {
            Rectangle bounds = _movementBoundsClient;
            if (bounds.Width <= 0 || bounds.Height <= 0)
            {
                UpdateMovementBounds();
                bounds = _movementBoundsClient;
            }

            int centerY = bounds.Top + (bounds.Height / 2);
            using (Pen linePen = new Pen(Color.FromArgb(190, 20, 100, 190), 3))
            using (Pen guidePen = new Pen(Color.FromArgb(100, 120, 130, 145), 1))
            using (Brush endpointBrush = new SolidBrush(Color.FromArgb(230, 255, 183, 77)))
            {
                guidePen.DashStyle = DashStyle.Dot;
                graphics.DrawRectangle(guidePen, bounds);
                graphics.DrawLine(linePen, bounds.Left, centerY, bounds.Right, centerY);
                graphics.FillEllipse(endpointBrush, bounds.Left - 7, centerY - 7, 14, 14);
                graphics.FillEllipse(endpointBrush, bounds.Right - 7, centerY - 7, 14, 14);
            }
        }

        private void DrawStatus(Graphics graphics)
        {
            string status = BuildStatusText();
            using (Font font = new Font(Font.FontFamily, 9.5f))
            {
                SizeF measured = graphics.MeasureString(status, font);
                int padding = 12;
                RectangleF panel = new RectangleF(
                    Math.Max(12, ClientSize.Width - measured.Width - (padding * 2) - 20),
                    Math.Max(12, ClientSize.Height - measured.Height - (padding * 2) - 20),
                    measured.Width + (padding * 2),
                    measured.Height + (padding * 2));

                using (Brush panelBrush = new SolidBrush(Color.FromArgb(235, 244, 246, 250)))
                using (Brush textBrush = new SolidBrush(ForeColor))
                {
                    graphics.FillRectangle(panelBrush, panel);
                    graphics.DrawRectangle(Pens.LightGray, panel.X, panel.Y, panel.Width, panel.Height);
                    graphics.DrawString(status, font, textBrush, panel.Left + padding, panel.Top + padding);
                }
            }
        }

        private string BuildStatusText()
        {
            if (_modeController == null)
            {
                return string.Empty;
            }

            long now = CurrentMilliseconds();
            string mode = _modeController.IsAuto ? LocalizedStrings.DemoAutoModeLabel : LocalizedStrings.DemoFreeModeLabel;
            string resumeText = _modeController.IsAuto
                ? LocalizedStrings.DemoResumeActiveLabel
                : LocalizedStrings.DemoResumeCountdown(_modeController.RemainingMilliseconds(now));
            string mirrorText = LocalizedStrings.DemoMirrorCursorStatus(
                _mirrorCursorEnabled ? LocalizedStrings.DemoEnabledLabel : LocalizedStrings.DemoDisabledLabel);

            return mirrorText + "\r\n\r\n" + LocalizedStrings.DemoStatus(
                mode,
                SpeedLabel(_speed),
                resumeText,
                _sentMoveCount) + "\r\n" + LocalizedStrings.DemoAnyKeyHint;
        }

        private long CurrentMilliseconds()
        {
            return _stopwatch.IsRunning ? _stopwatch.ElapsedMilliseconds : 0;
        }

        private static bool IsPointerControlEvent(LowLevelMouseHook.MouseEvent mouseEvent)
        {
            switch (mouseEvent)
            {
                case LowLevelMouseHook.MouseEvent.WM_MOUSEMOVE:
                case LowLevelMouseHook.MouseEvent.WM_LBUTTONDOWN:
                case LowLevelMouseHook.MouseEvent.WM_LBUTTONUP:
                case LowLevelMouseHook.MouseEvent.WM_RBUTTONDOWN:
                case LowLevelMouseHook.MouseEvent.WM_RBUTTONUP:
                case LowLevelMouseHook.MouseEvent.WM_MBUTTONDOWN:
                case LowLevelMouseHook.MouseEvent.WM_MBUTTONUP:
                case LowLevelMouseHook.MouseEvent.WM_MOUSEWHEEL:
                case LowLevelMouseHook.MouseEvent.WM_XBUTTONDOWN:
                case LowLevelMouseHook.MouseEvent.WM_XBUTTONUP:
                case LowLevelMouseHook.MouseEvent.WM_MOUSEHWHEEL:
                    return true;
                default:
                    return false;
            }
        }

        private static string SpeedLabel(DemoPointerSpeed speed)
        {
            switch (speed)
            {
                case DemoPointerSpeed.Slow:
                    return LocalizedStrings.DemoSpeedSlow;
                case DemoPointerSpeed.Fast:
                    return LocalizedStrings.DemoSpeedFast;
                default:
                    return LocalizedStrings.DemoSpeedNormal;
            }
        }
    }
}
