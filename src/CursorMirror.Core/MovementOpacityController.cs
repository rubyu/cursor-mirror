using System;

namespace CursorMirror
{
    public sealed class MovementOpacityController
    {
        private CursorMirrorSettings _settings;
        private int _transitionStartOpacityPercent;
        private int _transitionTargetOpacityPercent;
        private int _transitionDurationMilliseconds;
        private long _transitionStartMilliseconds;
        private long _lastMovementMilliseconds;
        private bool _hasMovement;
        private bool _exitStarted;
        private bool _idleFadeStarted;

        public MovementOpacityController(CursorMirrorSettings settings)
        {
            ApplySettings(settings);
            Reset();
        }

        public CursorMirrorSettings Settings
        {
            get { return _settings.Clone(); }
        }

        public void ApplySettings(CursorMirrorSettings settings)
        {
            if (settings == null)
            {
                throw new ArgumentNullException("settings");
            }

            _settings = settings.Normalize();
        }

        public void Reset()
        {
            _transitionStartOpacityPercent = 100;
            _transitionTargetOpacityPercent = 100;
            _transitionDurationMilliseconds = 0;
            _transitionStartMilliseconds = 0;
            _lastMovementMilliseconds = 0;
            _hasMovement = false;
            _exitStarted = false;
            _idleFadeStarted = false;
        }

        public void RecordMovement(long nowMilliseconds)
        {
            int current = GetOpacityPercent(nowMilliseconds);
            _lastMovementMilliseconds = nowMilliseconds;
            _hasMovement = true;
            _exitStarted = false;
            _idleFadeStarted = false;

            if (!_settings.MovementTranslucencyEnabled)
            {
                StartTransition(current, 100, nowMilliseconds, _settings.FadeDurationMilliseconds);
                return;
            }

            if (_transitionTargetOpacityPercent != _settings.MovingOpacityPercent)
            {
                StartTransition(current, _settings.MovingOpacityPercent, nowMilliseconds, _settings.FadeDurationMilliseconds);
            }
        }

        public int GetOpacityPercent(long nowMilliseconds)
        {
            if (!_hasMovement)
            {
                return 100;
            }

            if (_settings.MovementTranslucencyEnabled && !_exitStarted && !_idleFadeStarted)
            {
                long idleStart = _lastMovementMilliseconds + _settings.IdleDelayMilliseconds;
                if (nowMilliseconds >= idleStart)
                {
                    int exitStartOpacity = CalculateOpacityPercent(idleStart);
                    StartTransition(exitStartOpacity, 100, idleStart, _settings.FadeDurationMilliseconds);
                    _exitStarted = true;
                }
            }

            if (_settings.IdleFadeEnabled && !_idleFadeStarted)
            {
                long idleFadeStart = _lastMovementMilliseconds + _settings.IdleFadeDelayMilliseconds;
                if (nowMilliseconds >= idleFadeStart)
                {
                    int idleFadeStartOpacity = CalculateOpacityPercent(idleFadeStart);
                    StartTransition(idleFadeStartOpacity, _settings.IdleOpacityPercent, idleFadeStart, _settings.IdleFadeDurationMilliseconds);
                    _idleFadeStarted = true;
                }
            }

            return CalculateOpacityPercent(nowMilliseconds);
        }

        public byte GetOpacityByte(long nowMilliseconds)
        {
            int percent = GetOpacityPercent(nowMilliseconds);
            return (byte)Math.Round((percent * 255.0) / 100.0);
        }

        private void StartTransition(int startOpacityPercent, int targetOpacityPercent, long nowMilliseconds, int durationMilliseconds)
        {
            _transitionStartOpacityPercent = ClampPercent(startOpacityPercent);
            _transitionTargetOpacityPercent = ClampPercent(targetOpacityPercent);
            _transitionDurationMilliseconds = Math.Max(0, durationMilliseconds);
            _transitionStartMilliseconds = nowMilliseconds;
        }

        private int CalculateOpacityPercent(long nowMilliseconds)
        {
            int duration = _transitionDurationMilliseconds;
            if (duration <= 0)
            {
                return _transitionTargetOpacityPercent;
            }

            long elapsed = nowMilliseconds - _transitionStartMilliseconds;
            if (elapsed <= 0)
            {
                return _transitionStartOpacityPercent;
            }

            if (elapsed >= duration)
            {
                return _transitionTargetOpacityPercent;
            }

            double progress = elapsed / (double)duration;
            double value = _transitionStartOpacityPercent + ((_transitionTargetOpacityPercent - _transitionStartOpacityPercent) * progress);
            return ClampPercent((int)Math.Round(value));
        }

        private static int ClampPercent(int value)
        {
            return Math.Max(0, Math.Min(100, value));
        }
    }
}
