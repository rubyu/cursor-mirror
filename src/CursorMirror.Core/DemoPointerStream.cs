using System;
using System.Drawing;

namespace CursorMirror
{
    public sealed class DemoPointerStream
    {
        public const long StopwatchFrequency = 1000000L;
        public const long DwmRefreshPeriodTicks = 16668L;

        private static readonly double[] PollJitterMilliseconds = new double[]
        {
            0.00,
            -0.35,
            0.42,
            1.70,
            -0.18,
            0.15,
            3.95,
            -0.52
        };

        private static readonly double[] HookJitterMilliseconds = new double[]
        {
            0.00,
            0.18,
            -0.25,
            0.42,
            -0.12
        };

        private readonly Rectangle _movementBounds;
        private readonly DemoPointerSpeed _speed;
        private double _nextPollMilliseconds;
        private double _nextHookMilliseconds;
        private int _pollJitterIndex;
        private int _hookJitterIndex;

        public DemoPointerStream(Rectangle movementBounds, DemoPointerSpeed speed)
        {
            if (movementBounds.Width <= 0 || movementBounds.Height <= 0)
            {
                throw new ArgumentException("Movement bounds must have positive size.", "movementBounds");
            }

            _movementBounds = movementBounds;
            _speed = speed;
        }

        public DemoPointerSample GetSample(double elapsedMilliseconds)
        {
            double safeElapsed = Math.Max(0, elapsedMilliseconds);
            Timing timing = SelectTiming(_speed);
            MotionState state = GetMotionState(safeElapsed, timing);
            Point position = GetPosition(state.Progress, state.MovingRight);
            bool shouldPoll = ConsumeDuePoll(safeElapsed);
            bool shouldHook = ConsumeDueHook(safeElapsed, state.IsMoving);
            long timestampTicks = ToTicks(safeElapsed);
            long vBlankTicks = (timestampTicks / DwmRefreshPeriodTicks) * DwmRefreshPeriodTicks;

            return new DemoPointerSample(
                position,
                shouldPoll,
                shouldHook,
                state.IsMoving,
                state.Phase,
                timestampTicks,
                StopwatchFrequency,
                vBlankTicks,
                DwmRefreshPeriodTicks);
        }

        private bool ConsumeDuePoll(double elapsedMilliseconds)
        {
            if (elapsedMilliseconds < _nextPollMilliseconds)
            {
                return false;
            }

            do
            {
                _nextPollMilliseconds += NextPollIntervalMilliseconds();
            }
            while (_nextPollMilliseconds <= elapsedMilliseconds);

            return true;
        }

        private bool ConsumeDueHook(double elapsedMilliseconds, bool isMoving)
        {
            if (!isMoving)
            {
                if (_nextHookMilliseconds <= elapsedMilliseconds)
                {
                    _nextHookMilliseconds = elapsedMilliseconds + NextHookIntervalMilliseconds();
                }

                return false;
            }

            if (elapsedMilliseconds < _nextHookMilliseconds)
            {
                return false;
            }

            do
            {
                _nextHookMilliseconds += NextHookIntervalMilliseconds();
            }
            while (_nextHookMilliseconds <= elapsedMilliseconds);

            return true;
        }

        private double NextPollIntervalMilliseconds()
        {
            double jitter = PollJitterMilliseconds[_pollJitterIndex % PollJitterMilliseconds.Length];
            _pollJitterIndex++;
            return Math.Max(8, 16 + jitter);
        }

        private double NextHookIntervalMilliseconds()
        {
            double jitter = HookJitterMilliseconds[_hookJitterIndex % HookJitterMilliseconds.Length];
            _hookJitterIndex++;
            return Math.Max(4, 8 + jitter);
        }

        private Point GetPosition(double progress, bool movingRight)
        {
            double start = _movementBounds.Left;
            double end = _movementBounds.Right;
            double x = movingRight ? Lerp(start, end, progress) : Lerp(end, start, progress);
            double y = DemoCursorAlignment.StartPoint(_movementBounds).Y;
            return new Point((int)Math.Round(x), (int)Math.Round(y));
        }

        private static MotionState GetMotionState(double elapsedMilliseconds, Timing timing)
        {
            double cycleMilliseconds = (timing.MoveMilliseconds + timing.HoldMilliseconds) * 2;
            double cyclePosition = elapsedMilliseconds % cycleMilliseconds;

            if (cyclePosition < timing.MoveMilliseconds)
            {
                return new MotionState(
                    true,
                    true,
                    SmoothStep(cyclePosition / timing.MoveMilliseconds),
                    "moving-right");
            }

            cyclePosition -= timing.MoveMilliseconds;
            if (cyclePosition < timing.HoldMilliseconds)
            {
                return new MotionState(
                    false,
                    true,
                    1,
                    "hold-right");
            }

            cyclePosition -= timing.HoldMilliseconds;
            if (cyclePosition < timing.MoveMilliseconds)
            {
                return new MotionState(
                    true,
                    false,
                    SmoothStep(cyclePosition / timing.MoveMilliseconds),
                    "moving-left");
            }

            return new MotionState(
                false,
                false,
                1,
                "hold-left");
        }

        private static Timing SelectTiming(DemoPointerSpeed speed)
        {
            switch (speed)
            {
                case DemoPointerSpeed.Slow:
                    return new Timing(2600, 520);
                case DemoPointerSpeed.Fast:
                    return new Timing(900, 220);
                default:
                    return new Timing(1500, 340);
            }
        }

        private static double SmoothStep(double value)
        {
            double x = Math.Max(0, Math.Min(1, value));
            return x * x * (3 - (2 * x));
        }

        private static double Lerp(double start, double end, double progress)
        {
            return start + ((end - start) * progress);
        }

        private static long ToTicks(double elapsedMilliseconds)
        {
            return (long)Math.Round(elapsedMilliseconds * StopwatchFrequency / 1000.0);
        }

        private struct Timing
        {
            public readonly double MoveMilliseconds;
            public readonly double HoldMilliseconds;

            public Timing(double moveMilliseconds, double holdMilliseconds)
            {
                MoveMilliseconds = moveMilliseconds;
                HoldMilliseconds = holdMilliseconds;
            }
        }

        private struct MotionState
        {
            public readonly bool IsMoving;
            public readonly bool MovingRight;
            public readonly double Progress;
            public readonly string Phase;

            public MotionState(bool isMoving, bool movingRight, double progress, string phase)
            {
                IsMoving = isMoving;
                MovingRight = movingRight;
                Progress = progress;
                Phase = phase;
            }
        }
    }
}
